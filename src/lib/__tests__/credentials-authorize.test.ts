import { describe, expect, it, vi } from "vitest";

import {
  authorizeCredentialsAttempt,
  DUMMY_PASSWORD_HASH,
} from "@/lib/server/credentials-authorize";
import type { AuthRateLimitReservation } from "@/lib/server/auth-rate-limit";

const user = {
  id: "user-1",
  email: "friend@example.com",
  displayName: "Friend",
  passwordHash: "stored-hash",
};

const reservation: AuthRateLimitReservation = {
  buckets: [],
};

function createDependencies(overrides?: {
  allowed?: boolean;
  foundUser?: typeof user | null;
  passwordMatches?: boolean;
}) {
  return {
    limiter: {
      reserve: vi.fn().mockResolvedValue({
        allowed: overrides?.allowed ?? true,
        reservation,
      }),
      succeed: vi.fn().mockResolvedValue(undefined),
    },
    findUserByEmail: vi
      .fn()
      .mockResolvedValue(
        overrides && "foundUser" in overrides ? overrides.foundUser : user,
      ),
    verifyPassword: vi
      .fn()
      .mockResolvedValue(overrides?.passwordMatches ?? true),
    syncLegacyAccess: vi.fn().mockResolvedValue(undefined),
  };
}

const attempt = {
  credentials: {
    email: " Friend@Example.com ",
    password: "password123",
  },
  source: "203.0.113.10",
};

describe("credentials authorization throttling", () => {
  it("reserves before account lookup or password verification", async () => {
    const dependencies = createDependencies({ allowed: false });

    await expect(
      authorizeCredentialsAttempt(attempt, dependencies),
    ).resolves.toBeNull();

    expect(dependencies.limiter.reserve).toHaveBeenCalledWith({
      action: "login",
      identity: "friend@example.com",
      source: "203.0.113.10",
    });
    expect(dependencies.findUserByEmail).not.toHaveBeenCalled();
    expect(dependencies.verifyPassword).not.toHaveBeenCalled();
  });

  it("verifies both existing and missing users exactly once", async () => {
    const existingDependencies = createDependencies({ passwordMatches: false });
    const missingDependencies = createDependencies({
      foundUser: null,
      passwordMatches: false,
    });

    await authorizeCredentialsAttempt(attempt, existingDependencies);
    await authorizeCredentialsAttempt(attempt, missingDependencies);

    expect(existingDependencies.verifyPassword).toHaveBeenCalledOnce();
    expect(existingDependencies.verifyPassword).toHaveBeenCalledWith(
      "password123",
      "stored-hash",
    );
    expect(missingDependencies.verifyPassword).toHaveBeenCalledOnce();
    expect(missingDependencies.verifyPassword).toHaveBeenCalledWith(
      "password123",
      DUMMY_PASSWORD_HASH,
    );
    expect(DUMMY_PASSWORD_HASH).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
  });

  it("does not release failed reservations", async () => {
    const dependencies = createDependencies({ passwordMatches: false });

    await expect(
      authorizeCredentialsAttempt(attempt, dependencies),
    ).resolves.toBeNull();

    expect(dependencies.limiter.succeed).not.toHaveBeenCalled();
  });

  it("releases the successful reservation and returns the user", async () => {
    const dependencies = createDependencies();

    await expect(
      authorizeCredentialsAttempt(attempt, dependencies),
    ).resolves.toEqual({
      id: "user-1",
      email: "friend@example.com",
      name: "Friend",
    });

    expect(dependencies.syncLegacyAccess).toHaveBeenCalledWith({
      id: "user-1",
      email: "friend@example.com",
    });
    expect(dependencies.limiter.succeed).toHaveBeenCalledWith(reservation);
  });

  it("allows no more than five concurrent attempts to enter verification", async () => {
    let reservationCount = 0;
    let verificationCount = 0;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const limiter = {
      reserve: vi.fn(async () => {
        reservationCount += 1;
        return {
          allowed: reservationCount <= 5,
          reservation,
        };
      }),
      succeed: vi.fn().mockResolvedValue(undefined),
    };
    const dependencies = {
      ...createDependencies({ passwordMatches: false }),
      limiter,
      verifyPassword: vi.fn(async () => {
        verificationCount += 1;
        if (verificationCount === 5) {
          releaseBarrier();
        }
        await barrier;
        return false;
      }),
    };

    await Promise.all(
      Array.from({ length: 10 }, () =>
        authorizeCredentialsAttempt(attempt, dependencies),
      ),
    );

    expect(verificationCount).toBe(5);
  });
});
