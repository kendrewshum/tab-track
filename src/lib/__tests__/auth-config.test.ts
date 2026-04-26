import { describe, expect, test } from "vitest";

import { getAuthConfigError } from "@/lib/auth-config";

describe("getAuthConfigError", () => {
  test("reports a missing auth secret", () => {
    expect(
      getAuthConfigError({
        AUTH_SECRET: "",
        APP_INVITE_CODE: "invite-code",
      })
    ).toBe("Authentication is not configured yet. Add AUTH_SECRET in Vercel.");
  });

  test("reports a missing invite code", () => {
    expect(
      getAuthConfigError({
        AUTH_SECRET: "secret",
        APP_INVITE_CODE: "",
      })
    ).toBe("Signup is not configured yet. Add APP_INVITE_CODE in Vercel.");
  });

  test("returns null when auth config is complete", () => {
    expect(
      getAuthConfigError({
        AUTH_SECRET: "secret",
        APP_INVITE_CODE: "invite-code",
      })
    ).toBeNull();
  });
});
