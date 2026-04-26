import { describe, expect, test } from "vitest";

import { validateSignupInput } from "@/lib/signup";

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
});
