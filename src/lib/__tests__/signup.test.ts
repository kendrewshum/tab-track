import { describe, expect, test } from "vitest";

import {
  validateSignupInput,
  validateSignupProfile,
} from "@/lib/signup";

describe("validateSignupProfile", () => {
  test("normalizes a valid account profile independently of invitation authorization", () => {
    expect(
      validateSignupProfile({
        email: "  FRIEND@example.com ",
        displayName: "  Friend Name ",
        password: "password123",
      }),
    ).toEqual({
      success: true,
      data: {
        email: "friend@example.com",
        displayName: "Friend Name",
        password: "password123",
      },
    });
  });

  test.each([
    "friend@",
    "@example.com",
    "friend@example",
    "a@@b",
    "friend @example.com",
    "friend@ example.com",
  ])("rejects malformed email %j", (email) => {
    expect(
      validateSignupProfile({
        email,
        displayName: "Friend",
        password: "password123",
      }),
    ).toEqual({
      success: false,
      message: "Enter a valid email address.",
    });
  });
});

describe("validateSignupInput", () => {
  test("normalizes valid signup input when the invite code matches", () => {
    const result = validateSignupInput(
      {
        email: "  FRIEND@example.com ",
        displayName: "  Friend Name ",
        password: "password123",
        inviteCode: "join-the-trip",
      },
      "join-the-trip"
    );

    expect(result).toEqual({
      success: true,
      data: {
        email: "friend@example.com",
        displayName: "Friend Name",
        password: "password123",
      },
    });
  });

  test("rejects signup when the invite code is wrong", () => {
    const result = validateSignupInput(
      {
        email: "friend@example.com",
        displayName: "Friend Name",
        password: "password123",
        inviteCode: "wrong-code",
      },
      "join-the-trip"
    );

    expect(result).toEqual({
      success: false,
      message: "That invite code is not valid.",
    });
  });

  test("rejects signup when the password is too short", () => {
    const result = validateSignupInput(
      {
        email: "friend@example.com",
        displayName: "Friend Name",
        password: "short",
        inviteCode: "join-the-trip",
      },
      "join-the-trip"
    );

    expect(result).toEqual({
      success: false,
      message: "Password must be at least 8 characters.",
    });
  });

  test("allows an explicitly authorized alternative invitation without an app invite code", () => {
    const result = validateSignupInput(
      {
        email: "  FRIEND@example.com ",
        displayName: "  Friend Name ",
        password: "password123",
        inviteCode: "",
      },
      undefined,
      { alternativeInviteAuthorized: true },
    );

    expect(result).toEqual({
      success: true,
      data: {
        email: "friend@example.com",
        displayName: "Friend Name",
        password: "password123",
      },
    });
  });

  test("keeps the alternative invitation bypass disabled by default", () => {
    const result = validateSignupInput(
      {
        email: "friend@example.com",
        displayName: "Friend Name",
        password: "password123",
        inviteCode: "",
      },
      undefined,
    );

    expect(result).toEqual({
      success: false,
      message: "That invite code is not valid.",
    });
  });
});
