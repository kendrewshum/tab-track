import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { buildFingerprint, diffFingerprints } from "./fingerprint.mjs";

export const LEDGER_TABLE = "__drizzle_migrations";

/** Journal timestamp of 0003_abandoned_black_bolt, the shape production is in. */
export const BASELINE_MILLIS = 1777261198039;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MIGRATIONS_FOLDER = path.resolve(projectRoot, "drizzle");

/**
 * drizzle/0002_overrated_pestilence.sql adds groups.created_by_user_id with a
 * bare `REFERENCES users(id)`, dropping the ON DELETE SET NULL that
 * src/db/schema.ts declares. Snapshots 0003 and 0009 both record set null, so
 * drizzle-kit believes the schema is correct and will never emit a fix.
 *
 * Databases built by `drizzle-kit push` - production included - have set null.
 * Replaying the migrations therefore produces an expectation that a healthy
 * production database can never satisfy, so correct it here. No migration
 * between 0004 and 0009 touches `groups`, so this holds at every level.
 *
 * A canary test asserts the raw replay still yields NO ACTION; when that test
 * fails, 0002 has been fixed and this correction should be deleted.
 */
const GROUPS_FOREIGN_KEYS = ["created_by_user_id->users.id upd=NO ACTION del=SET NULL"];

export function readMigrations(migrationsFolder = MIGRATIONS_FOLDER) {
  return readMigrationFiles({ migrationsFolder });
}

export async function buildExpectedFingerprint(migrations, throughMillis) {
  const client = createClient({ url: ":memory:" });
  try {
    for (const migration of migrations) {
      if (migration.folderMillis > throughMillis) break;
      for (const statement of migration.sql) await client.execute(statement);
    }
    const fingerprint = await buildFingerprint(client);
    if (fingerprint.groups) fingerprint.groups.foreignKeys = [...GROUPS_FOREIGN_KEYS];
    return fingerprint;
  } finally {
    client.close();
  }
}

async function readLedgerLatest(client) {
  const result = await client.execute(
    `SELECT hash, created_at FROM ${LEDGER_TABLE} ORDER BY created_at DESC LIMIT 1`,
  );
  const row = result.rows[0];
  return row ? { hash: String(row.hash), createdAt: Number(row.created_at) } : null;
}

async function hasLedger(client) {
  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    args: [LEDGER_TABLE],
  });
  return result.rows.length > 0;
}

async function compare(client, migrations, throughMillis) {
  const expected = await buildExpectedFingerprint(migrations, throughMillis);
  return diffFingerprints(expected, await buildFingerprint(client));
}

/**
 * Decide what the live database needs. Fails closed: anything not recognised as
 * a legitimate migration level with a matching schema is refused, never guessed
 * at and never partially baselined.
 */
export async function classifyDatabaseState({ client, migrations }) {
  const latestMigration = migrations.at(-1);

  if (!(await hasLedger(client))) {
    const baseline = migrations.find((m) => m.folderMillis === BASELINE_MILLIS);
    if (!baseline) {
      return {
        action: "REFUSE",
        reason: `no migration found at baseline timestamp ${BASELINE_MILLIS}`,
        diff: [],
      };
    }
    const diff = await compare(client, migrations, BASELINE_MILLIS);
    if (diff.length > 0) {
      return {
        action: "REFUSE",
        reason: "database has no migration ledger and does not match the 0003 baseline",
        diff,
      };
    }
    return { action: "ADOPT", hash: baseline.hash, createdAt: BASELINE_MILLIS };
  }

  let latest;
  try {
    latest = await readLedgerLatest(client);
  } catch (err) {
    return {
      action: "REFUSE",
      reason: `failed to read migration ledger: ${err.message}`,
      diff: [],
    };
  }
  if (latest === null) {
    return { action: "REFUSE", reason: "migration ledger exists but is empty", diff: [] };
  }

  const migration = migrations.find((m) => m.folderMillis === latest.createdAt);
  if (!migration) {
    return {
      action: "REFUSE",
      reason: `ledger records unrecognised migration timestamp ${latest.createdAt}`,
      diff: [],
    };
  }

  if (latest.hash !== migration.hash) {
    return {
      action: "REFUSE",
      reason: `ledger hash does not match migration at timestamp ${latest.createdAt}`,
      diff: [],
    };
  }

  const diff = await compare(client, migrations, latest.createdAt);
  if (diff.length > 0) {
    return {
      action: "REFUSE",
      reason: `schema does not match the ledger level ${latest.createdAt}`,
      diff,
    };
  }

  if (latest.createdAt === latestMigration.folderMillis) {
    return { action: "NOOP", atMillis: latest.createdAt };
  }
  return { action: "MIGRATE", fromMillis: latest.createdAt };
}
