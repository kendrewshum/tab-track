import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, describe, expect, it } from "vitest";

import { idempotentSubmissions, users } from "../schema";

type TestDatabase = {
  cleanup: () => void;
  db: ReturnType<typeof drizzle<typeof import("../schema")>>;
};

function createTestDatabase(): TestDatabase {
  const tempDir = mkdtempSync(path.join(tmpdir(), "tab-track-idempotency-"));
  const dbPath = path.join(tempDir, "test.db");
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, {
    schema: { idempotentSubmissions, users },
  });

  const cleanup = () => {
    client.close();
    rmSync(tempDir, { force: true, recursive: true });
  };

  return { cleanup, db };
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("idempotentSubmissions", () => {
  it("rejects duplicate submission tokens for the same user and action kind", async () => {
    const { cleanup, db } = createTestDatabase();
    cleanups.push(cleanup);
    await migrate(db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });

    await db.insert(users).values({
      id: "user-1",
      email: "user@example.com",
      displayName: "User One",
      passwordHash: "hash",
    });

    await db.insert(idempotentSubmissions).values({
      id: "submission-1",
      userId: "user-1",
      actionKind: "createExpense",
      submissionToken: "token-123",
      redirectPath: "/groups/group-1",
    });

    await expect(
      db.insert(idempotentSubmissions).values({
        id: "submission-2",
        userId: "user-1",
        actionKind: "createExpense",
        submissionToken: "token-123",
        redirectPath: "/groups/group-1",
      })
    ).rejects.toThrow(/unique/i);
  });

  it("deletes a user's idempotent submissions when the user is removed", async () => {
    const { cleanup, db } = createTestDatabase();
    cleanups.push(cleanup);
    await migrate(db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });

    await db.insert(users).values({
      id: "user-1",
      email: "user@example.com",
      displayName: "User One",
      passwordHash: "hash",
    });

    await db.insert(idempotentSubmissions).values({
      id: "submission-1",
      userId: "user-1",
      actionKind: "createGroup",
      submissionToken: "token-123",
      redirectPath: "/groups/group-1",
    });

    await db.delete(users).where(eq(users.id, "user-1"));

    await expect(db.select().from(idempotentSubmissions)).resolves.toEqual([]);
  });
});
