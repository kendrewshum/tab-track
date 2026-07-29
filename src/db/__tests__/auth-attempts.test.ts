import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, describe, expect, it } from "vitest";

type TestDatabase = {
  cleanup: () => void;
  client: ReturnType<typeof createClient>;
  db: ReturnType<typeof drizzle>;
};

function createTestDatabase(): TestDatabase {
  const tempDir = mkdtempSync(path.join(tmpdir(), "tab-track-auth-attempts-"));
  const dbPath = path.join(tempDir, "test.db");
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client);

  return {
    client,
    db,
    cleanup() {
      client.close();
      rmSync(tempDir, { force: true, recursive: true });
    },
  };
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("authAttempts migration", () => {
  it("creates the persistent rate-limit columns", async () => {
    const { cleanup, client, db } = createTestDatabase();
    cleanups.push(cleanup);
    await migrate(db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });

    const result = await client.execute("PRAGMA table_info(auth_attempts)");

    expect(result.rows.map((row) => row.name)).toEqual([
      "bucket_key",
      "failure_count",
      "window_started_at",
      "expires_at",
      "updated_at",
    ]);
  });

  it("uses the bucket key as the primary key", async () => {
    const { cleanup, client, db } = createTestDatabase();
    cleanups.push(cleanup);
    await migrate(db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });

    const statement = {
      sql: `
        INSERT INTO auth_attempts (
          bucket_key,
          failure_count,
          window_started_at,
          expires_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `,
      args: ["bucket-key", 1, 100, 200, 100],
    };

    await client.execute(statement);

    await expect(client.execute(statement)).rejects.toThrow(/unique|primary/i);
  });

  it("indexes expiration for bounded cleanup", async () => {
    const { cleanup, client, db } = createTestDatabase();
    cleanups.push(cleanup);
    await migrate(db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });

    const result = await client.execute("PRAGMA index_list(auth_attempts)");

    expect(result.rows.map((row) => row.name)).toContain(
      "auth_attempts_expires_at_idx",
    );
  });
});
