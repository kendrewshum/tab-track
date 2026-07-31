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

describe("group access management migration", () => {
  it("adds a nullable cancellation actor with SET NULL", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "tab-track-group-access-"));
    const client = createClient({ url: `file:${path.join(tempDir, "test.db")}` });
    cleanups.push(() => {
      client.close();
      rmSync(tempDir, { force: true, recursive: true });
    });

    await migrate(drizzle(client), {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });

    const columns = await client.execute('PRAGMA table_info("group_invitations")');
    const cancelledByUserId = columns.rows.find(
      (row) => row.name === "cancelled_by_user_id",
    );
    expect(cancelledByUserId).toMatchObject({ notnull: 0 });

    const foreignKeys = await client.execute(
      'PRAGMA foreign_key_list("group_invitations")',
    );
    expect(foreignKeys.rows).toContainEqual(
      expect.objectContaining({
        from: "cancelled_by_user_id",
        table: "users",
        to: "id",
        on_delete: "SET NULL",
      }),
    );
  });
});
