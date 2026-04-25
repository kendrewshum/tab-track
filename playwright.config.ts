import { defineConfig, devices } from "@playwright/test";
import path from "path";

const testDbPath = path.resolve(__dirname, "e2e-test.db");

// E2E tests run against a dedicated SQLite file that is wiped and recreated
// before every test run (see e2e/setup-db.mjs). Tests run sequentially
// (workers: 1) because SQLite cannot safely handle concurrent writes.

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }], ["line"]],

  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "Desktop Chrome",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "iPhone 14",
      use: { ...devices["iPhone 14"] },
    },
  ],

  webServer: {
    // setup-db.mjs wipes and recreates the test DB, then the dev server
    // starts. Running setup first guarantees the DB schema exists before
    // @libsql/client initialises its connection on the first request.
    command: "node e2e/setup-db.mjs && npm run start -- -p 3001",
    url: "http://localhost:3001/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      TURSO_DATABASE_URL: `file:${testDbPath}`,
    },
  },
});
