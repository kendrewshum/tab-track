import { defineConfig, devices } from "@playwright/test";
import path from "path";

const testDbPath = path.resolve(__dirname, "e2e-test.db");

// E2E tests run against a dedicated SQLite file that is wiped and recreated
// before every test run (see e2e/global-setup.ts). Tests run sequentially
// (workers: 1) because SQLite cannot safely handle concurrent writes.

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }], ["line"]],
  globalSetup: "./e2e/global-setup.ts",

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
    // Start Next.js on port 3001 so it doesn't conflict with the dev server.
    // TURSO_DATABASE_URL points at the dedicated test DB created by global-setup.
    command: "npm run dev -- -p 3001",
    url: "http://localhost:3001",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      TURSO_DATABASE_URL: `file:${testDbPath}`,
    },
  },
});
