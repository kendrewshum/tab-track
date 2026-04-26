// Wipes and recreates the E2E test database before the Next.js server starts.
// Runs as the first step of the webServer command in playwright.config.ts so
// that the DB exists with a valid schema by the time the server initialises
// its @libsql/client connection.
import { existsSync, unlinkSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.resolve(projectRoot, "e2e-test.db");

for (const file of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
  if (existsSync(file)) unlinkSync(file);
}

const client = createClient({ url: `file:${dbPath}` });
const db = drizzle(client);
await migrate(db, { migrationsFolder: path.resolve(projectRoot, "drizzle") });

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
