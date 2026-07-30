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
  authorizeAlternativeInvite?: (email: string) => Promise<boolean>;
}) {
  const dependencies = {
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

  return overrides?.authorizeAlternativeInvite
    ? {
        ...dependencies,
        authorizeAlternativeInvite: vi.fn(
          overrides.authorizeAlternativeInvite,
        ),
      }
    : dependencies;
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

  it("authorizes an alternative invitation after reserving and before account creation", async () => {
    const events: string[] = [];
    const dependencies = createDependencies({
      authorizeAlternativeInvite: async (email) => {
        events.push(`authorize:${email}`);
        return true;
      },
    });
    dependencies.limiter.reserve.mockImplementation(async () => {
      events.push("reserve");
      return { allowed: true, reservation };
    });
    dependencies.createUser.mockImplementation(async () => {
      events.push("create");
    });

    await expect(
      createSignupAccountAttempt(
        {
          ...input,
          inviteCode: "",
          expectedInviteCode: undefined,
        },
        dependencies,
      ),
    ).resolves.toMatchObject({ success: true });

    expect(events).toEqual([
      "reserve",
      "authorize:friend@example.com",
      "create",
    ]);
  });

  it("does not authorize an invitation when the limiter blocks signup", async () => {
    const dependencies = createDependencies({
      allowed: false,
      authorizeAlternativeInvite: async () => true,
    });

    await expect(
      createSignupAccountAttempt(
        {
          ...input,
          inviteCode: "",
          expectedInviteCode: undefined,
        },
        dependencies,
      ),
    ).resolves.toEqual({
      success: false,
      message: SIGNUP_UNAVAILABLE_MESSAGE,
    });

    expect(dependencies.authorizeAlternativeInvite).not.toHaveBeenCalled();
  });

  it("does not query invitation authorization for a malformed email", async () => {
    const dependencies = createDependencies({
      authorizeAlternativeInvite: async () => true,
    });

    await expect(
      createSignupAccountAttempt(
        {
          ...input,
          email: "not-an-email",
          inviteCode: "",
          expectedInviteCode: undefined,
        },
        dependencies,
      ),
    ).resolves.toEqual({
      success: false,
      message: "Enter a valid email address.",
    });

    expect(dependencies.authorizeAlternativeInvite).not.toHaveBeenCalled();
  });

  it("treats invitation authorization failures as unauthorized and keeps the reservation", async () => {
    const dependencies = createDependencies({
      authorizeAlternativeInvite: async () => {
        throw new Error("database URL and invitation details");
      },
    });

    await expect(
      createSignupAccountAttempt(
        {
          ...input,
          inviteCode: "",
          expectedInviteCode: undefined,
        },
        dependencies,
      ),
    ).resolves.toEqual({
      success: false,
      message: "That invite code is not valid.",
    });

    expect(dependencies.findUserByEmail).not.toHaveBeenCalled();
    expect(dependencies.createUser).not.toHaveBeenCalled();
    expect(dependencies.limiter.succeed).not.toHaveBeenCalled();
  });
});
