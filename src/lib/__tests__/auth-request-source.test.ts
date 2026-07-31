import { describe, expect, it } from "vitest";

import { resolveTrustedRequestSource } from "@/lib/server/auth-request-source";
import {
  createAuthRateLimiter,
  type AuthAttemptStore,
  type AuthBucketDescriptor,
} from "@/lib/server/auth-rate-limit";

describe("trusted authentication request source", () => {
  it("uses Vercel's spoof-resistant forwarded client address", () => {
    expect(
      resolveTrustedRequestSource({
        isVercel: true,
        vercelForwardedFor: "203.0.113.10",
      }),
    ).toBe("203.0.113.10");
  });

  it("uses only the first normalized forwarded address", () => {
    expect(
      resolveTrustedRequestSource({
        isVercel: true,
        vercelForwardedFor: " 203.0.113.10, 198.51.100.20 ",
      }),
    ).toBe("203.0.113.10");
  });

  it("ignores a forwarded address outside Vercel", () => {
    expect(
      resolveTrustedRequestSource({
        isVercel: false,
        vercelForwardedFor: "203.0.113.10",
      }),
    ).toBeNull();
  });

  it("returns null for a missing or empty address", () => {
    expect(
      resolveTrustedRequestSource({
        isVercel: true,
        vercelForwardedFor: null,
      }),
    ).toBeNull();
    expect(
      resolveTrustedRequestSource({
        isVercel: true,
        vercelForwardedFor: " , ",
      }),
    ).toBeNull();
  });

  it("feeds a trusted source into opaque aggregate and pair reservations", async () => {
    const reservedBuckets: AuthBucketDescriptor[][] = [];
    const store: AuthAttemptStore = {
      find: async () => [],
      reserve: async (buckets, now) => {
        reservedBuckets.push(buckets);
        return buckets.map(({ bucketKey, windowMs }) => ({
          bucketKey,
          failureCount: 1,
          windowStartedAt: now,
          expiresAt: now + windowMs,
          updatedAt: now,
        }));
      },
      completeSuccess: async () => undefined,
      cleanupExpired: async () => 0,
    };
    const source = resolveTrustedRequestSource({
      isVercel: true,
      vercelForwardedFor: "203.0.113.10, 198.51.100.20",
    });
    const limiter = createAuthRateLimiter({
      store,
      secret: "test-secret",
      shouldCleanup: () => false,
    });

    await limiter.reserve({
      action: "login",
      identity: "friend@example.com",
      source,
    });

    expect(reservedBuckets[0].map(({ kind }) => kind)).toEqual([
      "source",
    ]);
    expect(reservedBuckets[1].map(({ kind }) => kind)).toEqual([
      "identity",
      "source-identity",
    ]);
    expect(JSON.stringify(reservedBuckets)).not.toContain("203.0.113.10");
    expect(JSON.stringify(reservedBuckets)).not.toContain("friend@example.com");
  });
});
