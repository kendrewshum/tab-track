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
  client.close();
}
