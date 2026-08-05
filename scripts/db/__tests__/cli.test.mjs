import { afterEach, describe, expect, it, vi } from "vitest";
import { LEDGER_TABLE, readMigrations } from "../state.mjs";
import { run, shouldRun, verifyFinalState } from "../cli.mjs";

// classifyDatabaseState closes over the real buildExpectedFingerprint at
// module definition time, so overriding the export below only affects
// cli.mjs's own import of it (used by verifyFinalState) - it cannot change
// what classifyDatabaseState decides. That lets this test force a
// post-migration verification failure without disturbing every other test's
// classify/migrate flow.
vi.mock("../state.mjs", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, buildExpectedFingerprint: vi.fn(actual.buildExpectedFingerprint) };
});
import { buildExpectedFingerprint } from "../state.mjs";
import {
  closeFixtureClients,
  LATEST_MILLIS,
  ledgeredDatabase as makeLedgeredDatabase,
  productionDatabase as makeProductionDatabase,
} from "./fixtures.mjs";

afterEach(closeFixtureClients);

const ledgeredDatabase = () => makeLedgeredDatabase(readMigrations());
const productionDatabase = () => makeProductionDatabase(readMigrations());

async function tableExists(client, name) {
  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    args: [name],
  });
  return result.rows.length > 0;
}

describe("shouldRun", () => {
  it("skips outside Vercel production", () => {
    expect(shouldRun({ VERCEL_ENV: "preview" }).run).toBe(false);
    expect(shouldRun({ VERCEL_ENV: "development" }).run).toBe(false);
    expect(shouldRun({}).run).toBe(false);
  });

  it("runs on a production deploy", () => {
    expect(shouldRun({ VERCEL_ENV: "production" }).run).toBe(true);
  });
});

describe("run", () => {
  const env = { VERCEL_ENV: "production" };

  it("skips and succeeds outside production without connecting", async () => {
    const logs = [];
    const code = await run({
      env: { VERCEL_ENV: "preview" },
      createClientFn: () => {
        throw new Error("must not connect when skipping");
      },
      log: (line) => logs.push(line),
    });

    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("skipped");
  });

  it("migrates a ledgered database up to the latest migration and verifies it", async () => {
    const client = await ledgeredDatabase();
    const logs = [];

    const code = await run({ env, createClientFn: () => client, log: (l) => logs.push(l) });

    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("complete and verified");
    expect(await tableExists(client, "auth_attempts")).toBe(true);
    const ledger = await client.execute(
      `SELECT created_at FROM ${LEDGER_TABLE} ORDER BY created_at DESC LIMIT 1`,
    );
    expect(Number(ledger.rows[0].created_at)).toBe(LATEST_MILLIS);
  });

  it("is safe to run twice", async () => {
    const client = await ledgeredDatabase();
    const first = await run({ env, createClientFn: () => client, log: () => {} });
    const logs = [];
    const second = await run({ env, createClientFn: () => client, log: (l) => logs.push(l) });

    expect(first).toBe(0);
    expect(second).toBe(0);
    expect(logs.join("\n")).toContain("already up to date");
  });

  it("refuses a ledgerless database and writes nothing", async () => {
    // The legacy db:push case. A deploy must never adopt a baseline on its own:
    // the schema alone cannot prove which migration level the database is at.
    const client = await productionDatabase();
    const logs = [];

    const code = await run({ env, createClientFn: () => client, log: (l) => logs.push(l) });

    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("no migration ledger");
    expect(await tableExists(client, LEDGER_TABLE)).toBe(false);
    expect(await tableExists(client, "auth_attempts")).toBe(false);
  });

  it("refuses and fails the build on an unexpected schema", async () => {
    const client = await ledgeredDatabase();
    await client.execute("CREATE TABLE `surprise` (`id` text)");
    const logs = [];

    const code = await run({ env, createClientFn: () => client, log: (l) => logs.push(l) });

    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("surprise");
    expect(await tableExists(client, "auth_attempts")).toBe(false);
  });

  it("fails without leaking the connection credential when the client cannot be constructed", async () => {
    const logs = [];
    const badUrl = "libsql://fake.example.com?authToken=SUPERSECRETVALUE";

    const code = await run({
      env,
      createClientFn: () => {
        const err = new Error(`The URL '${badUrl}' is not in a valid format`);
        err.code = "URL_INVALID";
        throw err;
      },
      log: (l) => logs.push(l),
    });

    const joined = logs.join("\n");
    expect(code).toBe(1);
    expect(joined).not.toContain("SUPERSECRETVALUE");
    expect(joined).not.toContain(badUrl);
  });

  it("fails the build when final verification finds problems", async () => {
    const client = await ledgeredDatabase();
    const logs = [];
    const realImpl = buildExpectedFingerprint.getMockImplementation();
    // Only the single call made by verifyFinalState (after migrate()) sees
    // this corrupted fingerprint; classifyDatabaseState's own decision is
    // made from the real, unmocked implementation (see comment above).
    buildExpectedFingerprint.mockImplementationOnce(async (...args) => {
      const fingerprint = await realImpl(...args);
      return { ...fingerprint, bogus_table: { columns: {}, foreignKeys: [], indexes: {} } };
    });

    const code = await run({ env, createClientFn: () => client, log: (l) => logs.push(l) });

    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("FAILED verification");
  });
});

describe("verifyFinalState", () => {
  it("reports a database that never reached the latest migration", async () => {
    const client = await ledgeredDatabase();
    expect(await verifyFinalState(client, readMigrations())).not.toEqual([]);
  });
});
