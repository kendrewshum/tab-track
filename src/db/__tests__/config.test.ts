import { describe, expect, it } from "vitest";

import { getDatabaseConfig } from "../config";

describe("getDatabaseConfig", () => {
  it("uses Turso when the database URL is configured", () => {
    expect(
      getDatabaseConfig({
        TURSO_DATABASE_URL: "libsql://tab-track.turso.io",
        TURSO_AUTH_TOKEN: "secret-token",
        VERCEL: "1",
      })
    ).toEqual({
      url: "libsql://tab-track.turso.io",
      authToken: "secret-token",
    });
  });

  it("uses the local sqlite file outside Vercel when no Turso URL is configured", () => {
    expect(getDatabaseConfig({})).toEqual({
      url: "file:local.db",
      authToken: undefined,
    });
  });

  it("throws a clear error on Vercel when Turso is not configured", () => {
    expect(() => getDatabaseConfig({ VERCEL: "1", VERCEL_ENV: "preview" })).toThrow(
      "Missing TURSO_DATABASE_URL for Vercel preview deployments."
    );
  });
});
