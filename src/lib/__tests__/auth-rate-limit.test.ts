import { describe, expect, it } from "vitest";

import {
  AUTH_ATTEMPT_CLEANUP_POLICY,
  AUTH_RATE_LIMIT_POLICIES,
  buildAuthBucketDescriptors,
  createAuthRateLimiter,
  type AuthAttemptRecord,
  type AuthAttemptStore,
  type AuthBucketDescriptor,
} from "@/lib/server/auth-rate-limit";

class MemoryAttemptStore implements AuthAttemptStore {
  readonly records = new Map<string, AuthAttemptRecord>();
  readonly cleanupCalls: Array<{ now: number; limit: number }> = [];

  async find(bucketKeys: string[]): Promise<AuthAttemptRecord[]> {
    return bucketKeys.flatMap((bucketKey) => {
      const record = this.records.get(bucketKey);
      return record ? [record] : [];
    });
  }

  async reserve(
    buckets: AuthBucketDescriptor[],
    now: number,
  ): Promise<AuthAttemptRecord[]> {
    for (const bucket of buckets) {
      const existing = this.records.get(bucket.bucketKey);
      this.records.set(bucket.bucketKey, {
        bucketKey: bucket.bucketKey,
        failureCount:
          existing && existing.expiresAt > now ? existing.failureCount + 1 : 1,
        windowStartedAt:
          existing && existing.expiresAt > now ? existing.windowStartedAt : now,
        expiresAt:
          existing && existing.expiresAt > now
            ? existing.expiresAt
            : now + bucket.windowMs,
        updatedAt: now,
      });
    }

    return this.find(buckets.map(({ bucketKey }) => bucketKey));
  }

  async completeSuccess(buckets: AuthBucketDescriptor[]): Promise<void> {
    for (const bucket of buckets) {
      if (bucket.kind !== "source") {
        this.records.delete(bucket.bucketKey);
        continue;
      }

      const existing = this.records.get(bucket.bucketKey);
      if (!existing || existing.failureCount <= 1) {
        this.records.delete(bucket.bucketKey);
      } else {
        this.records.set(bucket.bucketKey, {
          ...existing,
          failureCount: existing.failureCount - 1,
        });
      }
    }
  }

  async cleanupExpired(now: number, limit: number): Promise<number> {
    this.cleanupCalls.push({ now, limit });
    const expiredKeys = [...this.records.values()]
      .filter(({ expiresAt }) => expiresAt <= now)
      .slice(0, limit)
      .map(({ bucketKey }) => bucketKey);
    expiredKeys.forEach((bucketKey) => this.records.delete(bucketKey));
    return expiredKeys.length;
  }
}

const attempt = {
  action: "login" as const,
  identity: " Friend@Example.com ",
  source: "203.0.113.10",
};

describe("authentication rate-limit buckets", () => {
  it("derives stable opaque descriptors with source, identity, and pair policies", () => {
    const first = buildAuthBucketDescriptors({
      ...attempt,
      secret: "test-secret",
    });
    const second = buildAuthBucketDescriptors({
      ...attempt,
      secret: "test-secret",
    });

    expect(first).toEqual(second);
    expect(first.map(({ kind, limit }) => ({ kind, limit }))).toEqual([
      { kind: "source", limit: 30 },
      { kind: "identity", limit: 5 },
      { kind: "source-identity", limit: 5 },
    ]);
    expect(first.every(({ bucketKey }) => /^[a-f0-9]{64}$/.test(bucketKey))).toBe(
      true,
    );
    expect(JSON.stringify(first)).not.toContain("203.0.113.10");
    expect(JSON.stringify(first)).not.toContain("friend@example.com");
  });

  it("uses the identity policy when no trusted source is available", () => {
    const descriptors = buildAuthBucketDescriptors({
      action: "login",
      identity: "friend@example.com",
      source: null,
      secret: "test-secret",
    });

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]).toMatchObject({
      kind: "identity",
      ...AUTH_RATE_LIMIT_POLICIES.identity,
    });
  });

  it("isolates actions and normalized identities", () => {
    const login = buildAuthBucketDescriptors({
      ...attempt,
      secret: "test-secret",
    });
    const normalized = buildAuthBucketDescriptors({
      ...attempt,
      identity: "friend@example.com",
      secret: "test-secret",
    });
    const signup = buildAuthBucketDescriptors({
      ...attempt,
      action: "signup",
      secret: "test-secret",
    });

    expect(login).toEqual(normalized);
    expect(signup).not.toEqual(login);
  });

  it("isolates claim attempts with HMAC-only descriptors", () => {
    const claim = buildAuthBucketDescriptors({
      ...attempt,
      action: "claim",
      secret: "test-secret",
    });
    const login = buildAuthBucketDescriptors({
      ...attempt,
      action: "login",
      secret: "test-secret",
    });
    const signup = buildAuthBucketDescriptors({
      ...attempt,
      action: "signup",
      secret: "test-secret",
    });

    expect(claim).not.toEqual(login);
    expect(claim).not.toEqual(signup);
    expect(
      claim.every(({ bucketKey }) => /^[a-f0-9]{64}$/.test(bucketKey)),
    ).toBe(true);
    expect(JSON.stringify(claim)).not.toContain("203.0.113.10");
    expect(JSON.stringify(claim)).not.toContain("friend@example.com");
  });
});

describe("authentication rate-limit reservation", () => {
  it("configures cleanup to outpace the maximum bucket creation rate", () => {
    const maximumBucketsCreatedPerReservation = 3;
    const expectedRowsCleanedPerReservation =
      AUTH_ATTEMPT_CLEANUP_POLICY.probability *
      AUTH_ATTEMPT_CLEANUP_POLICY.batchLimit;

    expect(expectedRowsCleanedPerReservation).toBeGreaterThan(
      maximumBucketsCreatedPerReservation,
    );
  });

  it("atomically reserves before deciding and blocks only above the limit", async () => {
    const store = new MemoryAttemptStore();
    const limiter = createAuthRateLimiter({
      store,
      secret: "test-secret",
      now: () => 1_000,
    });

    for (let count = 1; count <= 5; count += 1) {
      await expect(limiter.reserve(attempt)).resolves.toMatchObject({
        allowed: true,
      });
    }

    await expect(limiter.reserve(attempt)).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: 900,
    });
  });

  it("does not lock a shared source after five aggregate failures", async () => {
    const store = new MemoryAttemptStore();
    const limiter = createAuthRateLimiter({
      store,
      secret: "test-secret",
      now: () => 1_000,
    });

    for (let index = 0; index < 5; index += 1) {
      await limiter.reserve({
        ...attempt,
        identity: `friend-${index}@example.com`,
      });
    }

    await expect(
      limiter.reserve({ ...attempt, identity: "sixth@example.com" }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it("blocks one identity across rotating trusted sources", async () => {
    const store = new MemoryAttemptStore();
    const limiter = createAuthRateLimiter({
      store,
      secret: "test-secret",
      now: () => 1_000,
    });

    for (let index = 0; index < 5; index += 1) {
      await expect(
        limiter.reserve({ ...attempt, source: `203.0.113.${index}` }),
      ).resolves.toMatchObject({ allowed: true });
    }

    await expect(
      limiter.reserve({ ...attempt, source: "198.51.100.1" }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("does not create scoped buckets after the aggregate source is blocked", async () => {
    const store = new MemoryAttemptStore();
    const limiter = createAuthRateLimiter({
      store,
      secret: "test-secret",
      now: () => 1_000,
      shouldCleanup: () => false,
    });

    for (let index = 0; index < AUTH_RATE_LIMIT_POLICIES.source.limit; index += 1) {
      await limiter.reserve({
        ...attempt,
        identity: `friend-${index}@example.com`,
      });
    }
    const recordCountBeforeBlockedAttempt = store.records.size;
    const blockedAttempt = {
      ...attempt,
      identity: "new-target@example.com",
    };

    await expect(limiter.reserve(blockedAttempt)).resolves.toMatchObject({
      allowed: false,
    });

    const blockedDescriptors = buildAuthBucketDescriptors({
      ...blockedAttempt,
      secret: "test-secret",
    });
    expect(store.records.size).toBe(recordCountBeforeBlockedAttempt);
    expect(
      blockedDescriptors
        .filter(({ kind }) => kind !== "source")
        .some(({ bucketKey }) => store.records.has(bucketKey)),
    ).toBe(false);
  });

  it("success clears the pair and undoes only its aggregate-source reservation", async () => {
    const store = new MemoryAttemptStore();
    const limiter = createAuthRateLimiter({
      store,
      secret: "test-secret",
      now: () => 1_000,
    });

    await limiter.reserve({ ...attempt, identity: "other@example.com" });
    const successfulReservation = await limiter.reserve(attempt);
    await limiter.succeed(successfulReservation.reservation);

    const descriptors = buildAuthBucketDescriptors({
      ...attempt,
      secret: "test-secret",
    });
    const sourceRecord = store.records.get(descriptors[0].bucketKey);
    const identityRecord = store.records.get(descriptors[1].bucketKey);
    const pairRecord = store.records.get(descriptors[2].bucketKey);

    expect(sourceRecord?.failureCount).toBe(1);
    expect(identityRecord).toBeUndefined();
    expect(pairRecord).toBeUndefined();
  });

  it("logically resets expired reservations without global cleanup", async () => {
    let now = 1_000;
    const store = new MemoryAttemptStore();
    const limiter = createAuthRateLimiter({
      store,
      secret: "test-secret",
      now: () => now,
    });

    for (let count = 0; count < 6; count += 1) {
      await limiter.reserve(attempt);
    }
    now += AUTH_RATE_LIMIT_POLICIES["source-identity"].windowMs;

    await expect(limiter.reserve(attempt)).resolves.toMatchObject({
      allowed: true,
    });
  });

  it("runs bounded cleanup when the injected selector chooses the request", async () => {
    const store = new MemoryAttemptStore();
    const limiter = createAuthRateLimiter({
      store,
      secret: "test-secret",
      now: () => 61_000,
      shouldCleanup: () => true,
    });

    await limiter.reserve(attempt);

    expect(store.cleanupCalls).toEqual([{ now: 61_000, limit: 100 }]);
  });

  it("does not run cleanup on every reservation", async () => {
    const store = new MemoryAttemptStore();
    const limiter = createAuthRateLimiter({
      store,
      secret: "test-secret",
      now: () => 61_000,
      shouldCleanup: () => false,
    });

    await limiter.reserve(attempt);

    expect(store.cleanupCalls).toEqual([]);
  });
});
