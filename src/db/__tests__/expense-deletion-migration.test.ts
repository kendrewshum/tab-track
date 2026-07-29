import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, describe, expect, it } from "vitest";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("expense deletion metadata migration", () => {
  it("adds nullable deletion columns and preserves the deleting user with SET NULL", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "tab-track-deleted-expenses-"));
    const client = createClient({ url: `file:${path.join(tempDir, "test.db")}` });
    cleanups.push(() => {
      client.close();
      rmSync(tempDir, { force: true, recursive: true });
    });

    await migrate(drizzle(client), {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });

    const columns = await client.execute('PRAGMA table_info("expenses")');
    const deletedAt = columns.rows.find((row) => row.name === "deleted_at");
    const deletedByUserId = columns.rows.find(
      (row) => row.name === "deleted_by_user_id"
    );

    expect(deletedAt).toMatchObject({ notnull: 0 });
    expect(deletedByUserId).toMatchObject({ notnull: 0 });

    const foreignKeys = await client.execute('PRAGMA foreign_key_list("expenses")');
    expect(foreignKeys.rows).toContainEqual(
      expect.objectContaining({
        from: "deleted_by_user_id",
        table: "users",
        to: "id",
        on_delete: "SET NULL",
      })
    );
  });
});
