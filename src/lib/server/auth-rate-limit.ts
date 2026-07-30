import { createHmac } from "node:crypto";

export type AuthRateLimitAction = "login" | "signup" | "claim";
export type AuthBucketKind = "source" | "identity" | "source-identity";

export type AuthRateLimitAttempt = {
  action: AuthRateLimitAction;
  identity: string;
  source: string | null;
};

export type AuthAttemptRecord = {
  bucketKey: string;
  failureCount: number;
  windowStartedAt: number;
  expiresAt: number;
  updatedAt: number;
};

export type AuthBucketPolicy = {
  limit: number;
  windowMs: number;
};

export type AuthBucketDescriptor = AuthBucketPolicy & {
  bucketKey: string;
  kind: AuthBucketKind;
};

export type AuthRateLimitReservation = {
  buckets: AuthBucketDescriptor[];
};

export type AuthAttemptStore = {
  find(bucketKeys: string[]): Promise<AuthAttemptRecord[]>;
  reserve(
    buckets: AuthBucketDescriptor[],
    now: number,
  ): Promise<AuthAttemptRecord[]>;
  completeSuccess(buckets: AuthBucketDescriptor[]): Promise<void>;
  cleanupExpired(now: number, limit: number): Promise<number>;
};

const FIFTEEN_MINUTES_MS = 15 * 60 * 1_000;

export const AUTH_ATTEMPT_CLEANUP_POLICY = {
  probability: 0.05,
  batchLimit: 100,
} as const;

export const AUTH_RATE_LIMIT_POLICIES: Record<
  AuthBucketKind,
  AuthBucketPolicy
> = {
  identity: { limit: 5, windowMs: FIFTEEN_MINUTES_MS },
  "source-identity": { limit: 5, windowMs: FIFTEEN_MINUTES_MS },
  source: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
};

type BuildAuthBucketDescriptorsInput = AuthRateLimitAttempt & {
  secret: string;
};

function hashBucket(secret: string, material: string): string {
  return createHmac("sha256", secret).update(material).digest("hex");
}

function descriptor(
  secret: string,
  kind: AuthBucketKind,
  material: string,
): AuthBucketDescriptor {
  return {
    bucketKey: hashBucket(secret, material),
    kind,
    ...AUTH_RATE_LIMIT_POLICIES[kind],
  };
}

export function buildAuthBucketDescriptors(
  input: BuildAuthBucketDescriptorsInput,
): AuthBucketDescriptor[] {
  const source = input.source?.trim() ?? "";
  const identity = input.identity.trim().toLowerCase();
  const buckets: AuthBucketDescriptor[] = [];

  if (source) {
    buckets.push(
      descriptor(
        input.secret,
        "source",
        `${input.action}:source:${source}`,
      ),
    );
  }

  if (source && identity) {
    buckets.push(
      descriptor(
        input.secret,
        "source-identity",
        `${input.action}:source-identity:${source}\0${identity}`,
      ),
    );
  } else if (identity) {
    buckets.push(
      descriptor(
        input.secret,
        "identity",
        `${input.action}:identity:${identity}`,
      ),
    );
  }

  return buckets;
}

type CreateAuthRateLimiterInput = {
  store: AuthAttemptStore;
  secret: string;
  now?: () => number;
  shouldCleanup?: () => boolean;
};

export function createAuthRateLimiter({
  store,
  secret,
  now = Date.now,
  shouldCleanup = () =>
    Math.random() < AUTH_ATTEMPT_CLEANUP_POLICY.probability,
}: CreateAuthRateLimiterInput) {
  return {
    async reserve(attempt: AuthRateLimitAttempt): Promise<{
      allowed: boolean;
      reservation: AuthRateLimitReservation;
      retryAfterSeconds?: number;
    }> {
      const reservedAt = now();
      const buckets = buildAuthBucketDescriptors({ ...attempt, secret });
      const reservation = { buckets };
      if (buckets.length === 0) {
        return { allowed: true, reservation };
      }

      const records = await store.reserve(buckets, reservedAt);
      if (shouldCleanup()) {
        await store
          .cleanupExpired(
            reservedAt,
            AUTH_ATTEMPT_CLEANUP_POLICY.batchLimit,
          )
          .catch(() => undefined);
      }
      const descriptorsByKey = new Map(
        buckets.map((bucket) => [bucket.bucketKey, bucket]),
      );
      const blockedRecords = records.filter((record) => {
        const bucket = descriptorsByKey.get(record.bucketKey);
        return bucket && record.failureCount > bucket.limit;
      });

      if (blockedRecords.length === 0) {
        return { allowed: true, reservation };
      }

      const retryAt = Math.max(
        ...blockedRecords.map((record) => record.expiresAt),
      );
      return {
        allowed: false,
        reservation,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((retryAt - reservedAt) / 1_000),
        ),
      };
    },

    async succeed(reservation: AuthRateLimitReservation): Promise<void> {
      if (reservation.buckets.length === 0) {
        return;
      }
      await store.completeSuccess(reservation.buckets);
    },
  };
}
