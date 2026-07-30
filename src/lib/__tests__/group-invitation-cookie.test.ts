import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GROUP_INVITATION_COOKIE_NAME,
  GROUP_INVITATION_COOKIE_TTL_SECONDS,
  getGroupInvitationCookieOptions,
} from "@/lib/server/group-invitation-cookie";

describe("group invitation cookie", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the stable invitation cookie name", () => {
    expect(GROUP_INVITATION_COOKIE_NAME).toBe(
      "tab-track-group-invitation",
    );
  });

  it("caps invitation cookies at thirty minutes", () => {
    expect(GROUP_INVITATION_COOKIE_TTL_SECONDS).toBe(30 * 60);
  });

  it("returns exact non-production options with the caller lifespan", () => {
    vi.stubEnv("NODE_ENV", "test");

    expect(getGroupInvitationCookieOptions(321)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
      maxAge: 321,
    });
  });

  it("marks the cookie secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(getGroupInvitationCookieOptions(1_800)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      maxAge: 1_800,
    });
  });
});
