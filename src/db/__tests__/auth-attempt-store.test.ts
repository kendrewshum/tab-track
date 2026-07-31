import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, describe, expect, it } from "vitest";

import * as schema from "../schema";
import { createAuthAttemptStore } from "@/lib/server/auth-attempt-store";
import type { AuthBucketDescriptor } from "@/lib/server/auth-rate-limit";

function createTestDatabase() {
  const tempDir = mkdtempSync(path.join(tmpdir(), "tab-track-auth-store-"));
  const client = createClient({ url: `file:${path.join(tempDir, "test.db")}` });
  const db = drizzle(client, { schema });

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

function bucket(
  bucketKey: string,
  kind: AuthBucketDescriptor["kind"] = "identity",
): AuthBucketDescriptor {
  return { bucketKey, kind, limit: 5, windowMs: 60_000 };
}

describe("auth attempt store", () => {
  it("atomically reserves all buckets and returns post-increment counts", async () => {
    const { cleanup, db } = createTestDatabase();
    cleanups.push(cleanup);
    await migrate(db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    const store = createAuthAttemptStore(db);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        store.reserve([bucket("source", "source"), bucket("pair", "source-identity")], 1_000),
      ),
    );

    expect(results.flatMap((records) => records).every(Boolean)).toBe(true);
    await expect(store.find(["source", "pair"])).resolves.toEqual([
      expect.objectContaining({ bucketKey: "pair", failureCount: 10 }),
      expect.objectContaining({ bucketKey: "source", failureCount: 10 }),
    ]);
  });

  it("restarts an expired bucket instead of extending its old count", async () => {
    const { cleanup, db } = createTestDatabase();
    cleanups.push(cleanup);
    await migrate(db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    const store = createAuthAttemptStore(db);
    await store.reserve([bucket("opaque-bucket")], 1_000);
    await store.reserve([bucket("opaque-bucket")], 61_000);

    await expect(store.find(["opaque-bucket"])).resolves.toEqual([
      {
        bucketKey: "opaque-bucket",
        failureCount: 1,
        windowStartedAt: 61_000,
        expiresAt: 121_000,
        updatedAt: 61_000,
      },
    ]);
  });

  it("success preserves prior source failures while clearing the identity bucket", async () => {
    const { cleanup, db } = createTestDatabase();
    cleanups.push(cleanup);
    await migrate(db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    const store = createAuthAttemptStore(db);
    const source = bucket("source", "source");
    const pair = bucket("pair", "source-identity");
    await store.reserve([source], 1_000);
    await store.reserve([source, pair], 1_000);

    await store.completeSuccess([source, pair]);

    await expect(store.find(["source", "pair"])).resolves.toEqual([
      expect.objectContaining({ bucketKey: "source", failureCount: 1 }),
    ]);
  });

  it("bounded cleanup deletes no more than the requested expired rows", async () => {
    const { cleanup, db } = createTestDatabase();
    cleanups.push(cleanup);
    await migrate(db, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
    });
    const store = createAuthAttemptStore(db);
    await store.reserve(
      [bucket("expired-1"), bucket("expired-2"), bucket("expired-3")],
      1_000,
    );
    await store.reserve([bucket("active")], 100_000);

    await expect(store.cleanupExpired(61_000, 2)).resolves.toBe(2);
    expect((await store.find(["expired-1", "expired-2", "expired-3"]))).toHaveLength(1);
    await expect(store.find(["active"])).resolves.toHaveLength(1);
  });
});
