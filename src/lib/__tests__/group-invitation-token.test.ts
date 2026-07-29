import { createHmac } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  generateGroupInvitationToken,
  getGroupInvitationExpiry,
  GROUP_INVITATION_COOKIE_TTL_SECONDS,
  GROUP_INVITATION_TTL_MS,
  hashGroupInvitationToken,
} from "@/lib/group-invitation-token";

describe("generateGroupInvitationToken", () => {
  test("returns an unpadded base64url token that decodes to 32 bytes", () => {
    const token = generateGroupInvitationToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("=");
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });
});

describe("hashGroupInvitationToken", () => {
  test("returns the expected lowercase hexadecimal HMAC-SHA-256", () => {
    const token = "raw-invitation-token";
    const secret = "secret-1";

    const hash = hashGroupInvitationToken(token, secret);

    expect(hash).toBe(createHmac("sha256", secret).update(token).digest("hex"));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
  });

  test("changes when either the token or secret changes", () => {
    const hash = hashGroupInvitationToken("token-1", "secret-1");

    expect(hashGroupInvitationToken("token-2", "secret-1")).not.toBe(hash);
    expect(hashGroupInvitationToken("token-1", "secret-2")).not.toBe(hash);
  });
});

describe("invitation lifetimes", () => {
  test("defines the seven-day invitation and thirty-minute cookie lifetimes", () => {
    expect(GROUP_INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(GROUP_INVITATION_COOKIE_TTL_SECONDS).toBe(30 * 60);
  });

  test("calculates an expiry exactly seven days from now", () => {
    const now = 1_753_795_200_000;

    expect(getGroupInvitationExpiry(now)).toBe(now + 7 * 24 * 60 * 60 * 1000);
  });
});
