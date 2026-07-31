import { afterEach, describe, expect, it, vi } from "vitest";

describe("checkDatabaseReadiness", () => {
  afterEach(() => {
    vi.doUnmock("@/db");
    vi.doUnmock("@/db/schema");
    vi.resetModules();
  });

  it("rejects when database initialization fails", async () => {
    const initializationError = new Error("database initialization failed");
    vi.doMock("@/db", () => {
      throw initializationError;
    });
    vi.doMock("@/db/schema", () => ({ users: {} }));

    const { checkDatabaseReadiness } = await import("./readiness");

    await expect(checkDatabaseReadiness()).rejects.toMatchObject({
      cause: initializationError,
    });
  });

  it("rejects when the database probe query fails", async () => {
    const queryError = new Error("database query failed");
    const limit = vi.fn().mockRejectedValue(queryError);
    const from = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ from }));
    const users = { table: "users" };

    vi.doMock("@/db", () => ({ db: { select } }));
    vi.doMock("@/db/schema", () => ({ users }));

    const { checkDatabaseReadiness } = await import("./readiness");

    await expect(checkDatabaseReadiness()).rejects.toBe(queryError);
    expect(select).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith(users);
    expect(limit).toHaveBeenCalledWith(1);
  });
});
