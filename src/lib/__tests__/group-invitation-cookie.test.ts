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

  it("returns exact insecure development options with the caller lifespan", () => {
    expect(
      getGroupInvitationCookieOptions(
        321,
        "http://localhost:3001/invite/token",
        { NODE_ENV: "development" },
      ),
    ).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
      maxAge: 321,
    });
  });

  it("marks the cookie secure for an HTTPS request", () => {
    expect(
      getGroupInvitationCookieOptions(
        1_800,
        "https://tabtrack.example/invite/token",
        { NODE_ENV: "test" },
      ),
    ).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      maxAge: 1_800,
    });
  });

  it("keeps production HTTP cookies secure without the loopback E2E override", () => {
    expect(
      getGroupInvitationCookieOptions(
        1_800,
        "http://tabtrack.example/invite/token",
        {
          NODE_ENV: "production",
          E2E_ALLOW_INSECURE_GROUP_INVITATION_COOKIE: "1",
        },
      ),
    ).toEqual(
      expect.objectContaining({
        secure: true,
      }),
    );
  });

  it("allows insecure production cookies only for explicit HTTP loopback E2E", () => {
    expect(
      getGroupInvitationCookieOptions(
        1_800,
        "http://localhost:3001/invite/token",
        {
          NODE_ENV: "production",
          E2E_ALLOW_INSECURE_GROUP_INVITATION_COOKIE: "1",
        },
      ),
    ).toEqual(
      expect.objectContaining({
        secure: false,
      }),
    );
  });
});
