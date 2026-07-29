import { describe, expect, it, vi } from "vitest";
import { createReadinessHandler } from "./handler";

describe("GET /api/ready", () => {
  it("returns a non-cacheable ready response when the database check succeeds", async () => {
    const checkDatabase = vi.fn().mockResolvedValue(undefined);
    const response = await createReadinessHandler(checkDatabase)();

    expect(checkDatabase).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ready" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns a sanitized non-cacheable unavailable response when the database check fails", async () => {
    const checkDatabase = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Unable to connect owner@example.com to libsql://private-db.turso.io with token secret-token"
        )
      );
    const response = await createReadinessHandler(checkDatabase)();
    const responseBody = await response.text();

    expect(checkDatabase).toHaveBeenCalledOnce();
    expect(response.status).toBe(503);
    expect(JSON.parse(responseBody)).toEqual({ status: "unavailable" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(responseBody).not.toContain("private-db");
    expect(responseBody).not.toContain("secret-token");
    expect(responseBody).not.toContain("libsql");
    expect(responseBody).not.toContain("owner@example.com");
  });
});
