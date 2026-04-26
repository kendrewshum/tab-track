import { existsSync, unlinkSync } from "fs";
import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

// Runs once before all E2E tests. Wipes any leftover test database and
// applies migrations so every run starts from a clean, fully-migrated slate.
// Using migrate() instead of drizzle-kit push avoids CLI prompts that fail
// silently in non-TTY CI environments.
export default async function globalSetup() {
  const dbPath = path.resolve(process.cwd(), "e2e-test.db");

  for (const file of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (existsSync(file)) unlinkSync(file);
  }

  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  await client.batch([
    {
      sql: `INSERT INTO groups (id, name, created_by_user_id) VALUES (?, ?, ?)`,
      args: ["legacy-austin-2026", "Austin 2026", null],
    },
    {
      sql: `INSERT INTO members (id, group_id, name) VALUES (?, ?, ?)`,
      args: ["legacy-austin-alice", "legacy-austin-2026", "Alice"],
    },
    {
      sql: `INSERT INTO members (id, group_id, name) VALUES (?, ?, ?)`,
      args: ["legacy-austin-bob", "legacy-austin-2026", "Bob"],
    },
    {
      sql: `INSERT INTO expenses (id, group_id, description, amount, paid_by_id, split_type, date) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "legacy-austin-flight",
        "legacy-austin-2026",
        "Flights",
        600,
        "legacy-austin-alice",
        "equal",
        "2026-01-10",
      ],
    },
    {
      sql: `INSERT INTO expense_splits (id, expense_id, member_id, amount) VALUES (?, ?, ?, ?)`,
      args: ["legacy-austin-split-alice", "legacy-austin-flight", "legacy-austin-alice", 300],
    },
    {
      sql: `INSERT INTO expense_splits (id, expense_id, member_id, amount) VALUES (?, ?, ?, ?)`,
      args: ["legacy-austin-split-bob", "legacy-austin-flight", "legacy-austin-bob", 300],
    },
  ]);
  client.close();
}
