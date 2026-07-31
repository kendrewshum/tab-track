import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASELINE_MILLIS, LEDGER_TABLE, readMigrations } from "../state.mjs";
import { adoptBaseline, run, shouldRun, verifyFinalState } from "../cli.mjs";

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

const clients = [];
afterEach(() => {
  while (clients.length > 0) clients.pop()?.close();
});

async function productionDatabase(throughMillis = BASELINE_MILLIS) {
  const client = createClient({ url: ":memory:" });
  clients.push(client);
  for (const migration of readMigrations()) {
    if (migration.folderMillis > throughMillis) break;
    for (const statement of migration.sql) {
      await client.execute(
        statement.includes("ADD `created_by_user_id`")
          ? `${statement.replace(/;?\s*$/, "")} ON DELETE set null`
          : statement,
      );
    }
  }
  return client;
}

describe("shouldRun", () => {
  it("skips outside Vercel production", () => {
    expect(shouldRun({ VERCEL_ENV: "preview", DB_ADOPT_BASELINE: "0003" }).run).toBe(false);
    expect(shouldRun({ DB_ADOPT_BASELINE: "0003" }).run).toBe(false);
  });

  it("skips without the explicit opt-in", () => {
    expect(shouldRun({ VERCEL_ENV: "production" }).run).toBe(false);
    expect(shouldRun({ VERCEL_ENV: "production", DB_ADOPT_BASELINE: "yes" }).run).toBe(false);
  });

  it("runs only when both gates are satisfied", () => {
    expect(shouldRun({ VERCEL_ENV: "production", DB_ADOPT_BASELINE: "0003" }).run).toBe(true);
  });
});

describe("adoptBaseline", () => {
  it("creates the ledger with exactly one baseline row", async () => {
    const client = await productionDatabase();
    const baseline = readMigrations().find((m) => m.folderMillis === BASELINE_MILLIS);

    await adoptBaseline(client, { hash: baseline.hash, createdAt: BASELINE_MILLIS });

    const rows = await client.execute(`SELECT hash, created_at FROM ${LEDGER_TABLE}`);
    expect(rows.rows).toHaveLength(1);
    expect(String(rows.rows[0].hash)).toBe(baseline.hash);
    expect(Number(rows.rows[0].created_at)).toBe(BASELINE_MILLIS);
  });
});

describe("run", () => {
  const gates = { VERCEL_ENV: "production", DB_ADOPT_BASELINE: "0003" };

  it("skips and succeeds when the gates are closed", async () => {
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

  it("adopts, migrates and verifies a production-shaped database", async () => {
    const client = await productionDatabase();
    const logs = [];

    const code = await run({ env: gates, createClientFn: () => client, log: (l) => logs.push(l) });

    expect(code).toBe(0);
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='auth_attempts'",
    );
    expect(tables.rows).toHaveLength(1);
    const ledger = await client.execute(
      `SELECT created_at FROM ${LEDGER_TABLE} ORDER BY created_at DESC LIMIT 1`,
    );
    expect(Number(ledger.rows[0].created_at)).toBe(1785449603211);
  });

  it("is safe to run twice", async () => {
    const client = await productionDatabase();
    const first = await run({ env: gates, createClientFn: () => client, log: () => {} });
    const logs = [];
    const second = await run({ env: gates, createClientFn: () => client, log: (l) => logs.push(l) });

    expect(first).toBe(0);
    expect(second).toBe(0);
    expect(logs.join("\n")).toContain("already up to date");
  });

  it("refuses and fails the build on an unexpected schema", async () => {
    const client = await productionDatabase();
    await client.execute("CREATE TABLE `surprise` (`id` text)");
    const logs = [];

    const code = await run({ env: gates, createClientFn: () => client, log: (l) => logs.push(l) });

    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("surprise");
    // Nothing may be written on refusal.
    const ledger = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
      args: [LEDGER_TABLE],
    });
    expect(ledger.rows).toHaveLength(0);
    const migrated = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
      args: ["auth_attempts"],
    });
    expect(migrated.rows).toHaveLength(0);
  });

  it("fails without leaking the connection credential when the client cannot be constructed", async () => {
    const logs = [];
    const badUrl = "libsql://fake.example.com?authToken=SUPERSECRETVALUE";

    const code = await run({
      env: gates,
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
    const client = await productionDatabase();
    const logs = [];
    const realImpl = buildExpectedFingerprint.getMockImplementation();
    // Only the single call made by verifyFinalState (after migrate()) sees
    // this corrupted fingerprint; classifyDatabaseState's own decision is
    // made from the real, unmocked implementation (see comment above).
    buildExpectedFingerprint.mockImplementationOnce(async (...args) => {
      const fingerprint = await realImpl(...args);
      return { ...fingerprint, bogus_table: { columns: {}, foreignKeys: [], indexes: {} } };
    });

    const code = await run({ env: gates, createClientFn: () => client, log: (l) => logs.push(l) });

    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("FAILED verification");
  });
});

describe("verifyFinalState", () => {
  it("reports a database that never reached 0009", async () => {
    const client = await productionDatabase();
    expect(await verifyFinalState(client, readMigrations())).not.toEqual([]);
  });
});
