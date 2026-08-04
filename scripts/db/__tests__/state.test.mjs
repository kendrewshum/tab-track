import { afterEach, describe, expect, it } from "vitest";
import { buildFingerprint, diffFingerprints } from "../fingerprint.mjs";
import { buildExpectedFingerprint, readMigrations } from "../state.mjs";
import {
  addLedger,
  BASELINE_MILLIS,
  closeFixtureClients,
  LATEST_MILLIS,
  productionDatabase,
  replay,
} from "./fixtures.mjs";

const GROUPS_FK_PRODUCTION = "created_by_user_id->users.id upd=NO ACTION del=SET NULL";
const GROUPS_FK_REPLAY = "created_by_user_id->users.id upd=NO ACTION del=NO ACTION";

afterEach(closeFixtureClients);

describe("readMigrations", () => {
  it("reads the committed migrations with drizzle's own hashes", () => {
    const migrations = readMigrations();
    const baseline = migrations.find((m) => m.folderMillis === BASELINE_MILLIS);

    // Pinned so a regenerated or edited 0003 cannot silently change the row we
    // write into the production ledger.
    expect(baseline?.hash).toBe(
      "41e17c250387a1851720407c1bc4bd0faf7fb65e1d088261eece1fb3a74bbf95",
    );
    expect(migrations.at(-1)?.folderMillis).toBe(1785449603211);
  });
});

describe("the drizzle/0002 foreign-key drift", () => {
  it("still needs correcting - delete the correction when this fails", async () => {
    const client = await replay(readMigrations(), BASELINE_MILLIS);
    const raw = await buildFingerprint(client);

    // Canary. If 0002 is ever fixed this becomes SET NULL and the correction
    // inside state.mjs must be removed.
    expect(raw.groups.foreignKeys).toEqual([GROUPS_FK_REPLAY]);
  });
});

describe("buildExpectedFingerprint", () => {
  it("describes production at the 0003 baseline", async () => {
    const expected = await buildExpectedFingerprint(readMigrations(), BASELINE_MILLIS);

    expect(Object.keys(expected).sort()).toEqual([
      "expense_revisions",
      "expense_splits",
      "expenses",
      "group_access",
      "groups",
      "idempotent_submissions",
      "members",
      "settlements",
      "users",
    ]);
    expect(expected.groups.foreignKeys).toEqual([GROUPS_FK_PRODUCTION]);
    expect(expected.auth_attempts).toBeUndefined();
  });

  it("matches a database shaped like production rather than like a replay", async () => {
    const migrations = readMigrations();
    // drizzle-kit push kept the ON DELETE SET NULL clause that 0002 dropped.
    const asProduction = (statements) =>
      statements.map((statement) =>
        statement.includes("ADD `created_by_user_id`")
          ? `${statement.replace(/;?\s*$/, "")} ON DELETE set null`
          : statement,
      );

    const production = await replay(migrations, BASELINE_MILLIS, asProduction);
    const expected = await buildExpectedFingerprint(migrations, BASELINE_MILLIS);

    expect(diffFingerprints(expected, await buildFingerprint(production))).toEqual([]);
  });

  it("keeps the correction valid at 0009 and includes auth_attempts", async () => {
    const migrations = readMigrations();
    const expected = await buildExpectedFingerprint(migrations, migrations.at(-1).folderMillis);

    expect(expected.groups.foreignKeys).toEqual([GROUPS_FK_PRODUCTION]);
    expect(expected.auth_attempts).toBeDefined();
    expect(expected.group_invitations).toBeDefined();
  });
});

import { classifyDatabaseState, LEDGER_TABLE } from "../state.mjs";

describe("classifyDatabaseState", () => {
  it("refuses a ledgerless database even when it matches a known level exactly", async () => {
    const migrations = readMigrations();
    const client = await productionDatabase(migrations);

    const result = await classifyDatabaseState({ client, migrations });

    // Matching a level is not proof of being at it: the schema alone cannot
    // establish which migrations a db:push database actually ran. Adopting a
    // baseline stays an operator decision, never a deploy's.
    expect(result.action).toBe("REFUSE");
    expect(result.reason).toContain("no migration ledger");
  });

  it("refuses a ledgered database with an unexpected extra table", async () => {
    const migrations = readMigrations();
    const client = await productionDatabase(migrations);
    const baseline = migrations.find((m) => m.folderMillis === BASELINE_MILLIS);
    await addLedger(client, [[baseline.hash, BASELINE_MILLIS]]);
    await client.execute("CREATE TABLE `surprise` (`id` text)");

    const result = await classifyDatabaseState({ client, migrations });

    expect(result.action).toBe("REFUSE");
    expect(result.diff.join("\n")).toContain("surprise");
  });

  it("refuses a ledgered database with a dropped index", async () => {
    const migrations = readMigrations();
    const client = await productionDatabase(migrations);
    const baseline = migrations.find((m) => m.folderMillis === BASELINE_MILLIS);
    await addLedger(client, [[baseline.hash, BASELINE_MILLIS]]);
    await client.execute("DROP INDEX `users_email_unique`");

    const result = await classifyDatabaseState({ client, migrations });

    expect(result.action).toBe("REFUSE");
    expect(result.diff.join("\n")).toContain("users_email_unique");
  });

  it("refuses a ledgered database still carrying the replay foreign key", async () => {
    const migrations = readMigrations();
    // An unpatched replay - NO ACTION where production has SET NULL.
    const client = await replay(migrations, BASELINE_MILLIS);
    const baseline = migrations.find((m) => m.folderMillis === BASELINE_MILLIS);
    await addLedger(client, [[baseline.hash, BASELINE_MILLIS]]);

    const result = await classifyDatabaseState({ client, migrations });

    expect(result.action).toBe("REFUSE");
    expect(result.diff.join("\n")).toContain("groups foreign keys");
  });

  it("migrates when the ledger sits at the 0003 baseline", async () => {
    const migrations = readMigrations();
    const client = await productionDatabase(migrations);
    const baseline = migrations.find((m) => m.folderMillis === BASELINE_MILLIS);
    await addLedger(client, [[baseline.hash, BASELINE_MILLIS]]);

    const result = await classifyDatabaseState({ client, migrations });

    expect(result).toEqual({ action: "MIGRATE", fromMillis: BASELINE_MILLIS });
  });

  it("resumes from an intermediate level", async () => {
    const migrations = readMigrations();
    const intermediate = migrations.find((m) => m.folderMillis === 1785352305141);
    const client = await productionDatabase(migrations, intermediate.folderMillis);
    await addLedger(client, [[intermediate.hash, intermediate.folderMillis]]);

    const result = await classifyDatabaseState({ client, migrations });

    expect(result).toEqual({ action: "MIGRATE", fromMillis: intermediate.folderMillis });
  });

  it("is a no-op once the ledger reaches 0009", async () => {
    const migrations = readMigrations();
    const client = await productionDatabase(migrations, LATEST_MILLIS);
    await addLedger(client, [[migrations.at(-1).hash, LATEST_MILLIS]]);

    const result = await classifyDatabaseState({ client, migrations });

    expect(result).toEqual({ action: "NOOP", atMillis: LATEST_MILLIS });
  });

  it("refuses an unrecognised ledger timestamp", async () => {
    const migrations = readMigrations();
    const client = await productionDatabase(migrations);
    await addLedger(client, [["deadbeef", 9999999999999]]);

    const result = await classifyDatabaseState({ client, migrations });

    expect(result.action).toBe("REFUSE");
    expect(result.reason).toContain("9999999999999");
  });

  it("refuses an empty ledger", async () => {
    const migrations = readMigrations();
    const client = await productionDatabase(migrations);
    await addLedger(client, []);

    const result = await classifyDatabaseState({ client, migrations });

    expect(result.action).toBe("REFUSE");
    expect(result.reason).toContain("empty");
  });

  it("refuses when the ledger level and the schema disagree", async () => {
    const migrations = readMigrations();
    // Ledger claims 0009 but the schema is still at 0003.
    const client = await productionDatabase(migrations, BASELINE_MILLIS);
    await addLedger(client, [[migrations.at(-1).hash, LATEST_MILLIS]]);

    const result = await classifyDatabaseState({ client, migrations });

    expect(result.action).toBe("REFUSE");
    expect(result.diff.join("\n")).toContain("auth_attempts");
  });

  it("uses the greatest created_at when the ledger holds multiple rows", async () => {
    const migrations = readMigrations();
    const intermediate = migrations.find((m) => m.folderMillis === 1785352305141);
    const baseline = migrations.find((m) => m.folderMillis === BASELINE_MILLIS);
    const client = await productionDatabase(migrations, intermediate.folderMillis);
    // Insert out of order: newer timestamp first, then baseline.
    await addLedger(client, [
      [intermediate.hash, intermediate.folderMillis],
      [baseline.hash, BASELINE_MILLIS],
    ]);

    const result = await classifyDatabaseState({ client, migrations });

    expect(result).toEqual({ action: "MIGRATE", fromMillis: intermediate.folderMillis });
  });

  it("refuses when ledger claims 0003 baseline but schema is at 0009", async () => {
    const migrations = readMigrations();
    // Schema is at 0009 but ledger claims 0003.
    const client = await productionDatabase(migrations, LATEST_MILLIS);
    const baseline = migrations.find((m) => m.folderMillis === BASELINE_MILLIS);
    await addLedger(client, [[baseline.hash, BASELINE_MILLIS]]);

    const result = await classifyDatabaseState({ client, migrations });

    expect(result.action).toBe("REFUSE");
    expect(result.diff.join("\n")).toContain("auth_attempts");
  });

  it("refuses when ledger created_at is non-numeric text", async () => {
    const migrations = readMigrations();
    const client = await productionDatabase(migrations);
    const baseline = migrations.find((m) => m.folderMillis === BASELINE_MILLIS);
    // Insert a row with created_at as text that's not numeric.
    await client.execute(`CREATE TABLE ${LEDGER_TABLE} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at text)`);
    await client.execute({
      sql: `INSERT INTO ${LEDGER_TABLE} ("hash","created_at") VALUES (?, ?)`,
      args: [baseline.hash, "not-a-number"],
    });

    const result = await classifyDatabaseState({ client, migrations });

    expect(result.action).toBe("REFUSE");
    expect(result.reason).toContain("unrecognised migration timestamp");
  });

  it("refuses when ledger hash does not match the migration file", async () => {
    const migrations = readMigrations();
    const client = await productionDatabase(migrations);
    const baseline = migrations.find((m) => m.folderMillis === BASELINE_MILLIS);
    // Insert with a mismatched hash.
    await addLedger(client, [["baddeadbeefc0ffee", BASELINE_MILLIS]]);

    const result = await classifyDatabaseState({ client, migrations });

    expect(result.action).toBe("REFUSE");
    expect(result.reason).toContain("hash does not match");
    expect(result.reason).toContain(String(BASELINE_MILLIS));
  });

  it("refuses when the ledger table is malformed", async () => {
    const migrations = readMigrations();
    const client = await productionDatabase(migrations);
    // Create a ledger table without the expected columns.
    await client.execute(`CREATE TABLE ${LEDGER_TABLE} (id INTEGER PRIMARY KEY)`);

    const result = await classifyDatabaseState({ client, migrations });

    expect(result.action).toBe("REFUSE");
    expect(result.reason).toContain("failed to read migration ledger");
  });
});
