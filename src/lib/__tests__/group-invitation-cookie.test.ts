import { describe, expect, it } from "vitest";

import {
  GROUP_INVITATION_COOKIE_NAME,
  GROUP_INVITATION_COOKIE_TTL_SECONDS,
  getGroupInvitationCookieOptions,
} from "@/lib/server/group-invitation-cookie";

describe("group invitation cookie", () => {
  it("uses the stable invitation cookie name", () => {
    expect(GROUP_INVITATION_COOKIE_NAME).toBe(
      "tab-track-group-invitation",
    );
  });

  it("caps invitation cookies at thirty minutes", () => {
    expect(GROUP_INVITATION_COOKIE_TTL_SECONDS).toBe(30 * 60);
  });

  it("returns exact insecure options with the caller lifespan", () => {
    expect(getGroupInvitationCookieOptions(321, false)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
      maxAge: 321,
    });
  });

  it("marks the cookie secure for an HTTPS request", () => {
    expect(getGroupInvitationCookieOptions(1_800, true)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      maxAge: 1_800,
    });
  });
});
