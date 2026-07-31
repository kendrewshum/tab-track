import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, describe, expect, it } from "vitest";

const REQUIRED_INDEXES = {
  group_access_user_id_idx: ["user_id"],
  members_group_user_unique: ["group_id", "user_id"],
  expenses_group_id_date_idx: ["group_id", "date"],
  expense_splits_expense_id_idx: ["expense_id"],
  expense_revisions_expense_id_idx: ["expense_id"],
  settlements_group_id_date_idx: ["group_id", "date"],
  settlements_reversal_of_settlement_id_idx: ["reversal_of_settlement_id"],
} as const;

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("common query indexes", () => {
  it("creates each index with the expected column order", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "tab-track-indexes-"));
    const client = createClient({ url: `file:${path.join(tempDir, "test.db")}` });
    cleanups.push(() => {
      client.close();
      rmSync(tempDir, { force: true, recursive: true });
    });

    await migrate(drizzle(client), {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });

    for (const [indexName, expectedColumns] of Object.entries(REQUIRED_INDEXES)) {
      const result = await client.execute(`PRAGMA index_info("${indexName}")`);
      expect(
        result.rows.map((row) => row.name),
        `${indexName} column order`,
      ).toEqual(expectedColumns);
    }
  });
});
