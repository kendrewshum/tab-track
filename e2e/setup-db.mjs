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
client.close();
