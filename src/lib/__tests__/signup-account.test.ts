import { describe, expect, it, vi } from "vitest";

import {
  createSignupAccountAttempt,
  SIGNUP_UNAVAILABLE_MESSAGE,
} from "@/lib/server/signup-account";
import type { AuthRateLimitReservation } from "@/lib/server/auth-rate-limit";

const input = {
  email: " Friend@Example.com ",
  displayName: "Friend",
  password: "password123",
  inviteCode: "correct-invite",
  expectedInviteCode: "correct-invite",
  source: "203.0.113.10",
};

const reservation: AuthRateLimitReservation = { buckets: [] };

function createDependencies(overrides?: {
  allowed?: boolean;
  existingUser?: { id: string } | null;
  createError?: Error;
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
      .mockResolvedValue(overrides?.existingUser ?? null),
    hashPassword: vi.fn().mockResolvedValue("password-hash"),
    createUser: overrides?.createError
      ? vi.fn().mockRejectedValue(overrides.createError)
      : vi.fn().mockResolvedValue(undefined),
  };
}

describe("signup account throttling", () => {
  it("reserves before validation, lookup, password hashing, or creation", async () => {
    const dependencies = createDependencies({ allowed: false });

    await expect(
      createSignupAccountAttempt(
        { ...input, inviteCode: "wrong-invite" },
        dependencies,
      ),
    ).resolves.toEqual({
      success: false,
      message: SIGNUP_UNAVAILABLE_MESSAGE,
    });

    expect(dependencies.limiter.reserve).toHaveBeenCalledWith({
      action: "signup",
      identity: "friend@example.com",
      source: "203.0.113.10",
    });
    expect(dependencies.findUserByEmail).not.toHaveBeenCalled();
    expect(dependencies.hashPassword).not.toHaveBeenCalled();
    expect(dependencies.createUser).not.toHaveBeenCalled();
  });

  it("keeps the reservation for invalid invite attempts", async () => {
    const dependencies = createDependencies();

    await expect(
      createSignupAccountAttempt(
        { ...input, inviteCode: "wrong-invite" },
        dependencies,
      ),
    ).resolves.toMatchObject({ success: false });

    expect(dependencies.limiter.succeed).not.toHaveBeenCalled();
    expect(dependencies.findUserByEmail).not.toHaveBeenCalled();
  });

  it("does not reveal an existing account", async () => {
    const dependencies = createDependencies({
      existingUser: { id: "existing-user" },
    });

    await expect(
      createSignupAccountAttempt(input, dependencies),
    ).resolves.toEqual({
      success: false,
      message: SIGNUP_UNAVAILABLE_MESSAGE,
    });

    expect(dependencies.limiter.succeed).not.toHaveBeenCalled();
    expect(dependencies.hashPassword).not.toHaveBeenCalled();
    expect(dependencies.createUser).not.toHaveBeenCalled();
  });

  it("releases the successful reservation after creating an account", async () => {
    const dependencies = createDependencies();

    await expect(
      createSignupAccountAttempt(input, dependencies),
    ).resolves.toEqual({
      success: true,
      data: {
        email: "friend@example.com",
        displayName: "Friend",
        password: "password123",
      },
    });

    expect(dependencies.hashPassword).toHaveBeenCalledWith("password123");
    expect(dependencies.createUser).toHaveBeenCalledWith({
      email: "friend@example.com",
      displayName: "Friend",
      passwordHash: "password-hash",
    });
    expect(dependencies.limiter.succeed).toHaveBeenCalledWith(reservation);
  });

  it("sanitizes account-creation failures without releasing the reservation", async () => {
    const dependencies = createDependencies({
      createError: new Error("database URL and constraint details"),
    });

    await expect(
      createSignupAccountAttempt(input, dependencies),
    ).resolves.toEqual({
      success: false,
      message: SIGNUP_UNAVAILABLE_MESSAGE,
    });
    expect(dependencies.limiter.succeed).not.toHaveBeenCalled();
  });
});
