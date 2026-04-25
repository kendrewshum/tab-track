import { execSync } from "child_process";
import { existsSync, unlinkSync } from "fs";

// Runs once before all E2E tests. Wipes any leftover test database and
// pushes the current schema so every run starts from a clean slate.
export default async function globalSetup() {
  for (const file of ["e2e-test.db", "e2e-test.db-shm", "e2e-test.db-wal"]) {
    if (existsSync(file)) unlinkSync(file);
  }

  execSync("npm run db:push", {
    stdio: "inherit",
    env: { ...process.env, TURSO_DATABASE_URL: "file:e2e-test.db" },
  });
}
