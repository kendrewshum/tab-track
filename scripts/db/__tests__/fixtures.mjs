/**
 * Shared fixtures for the scripts/db tests.
 *
 * The production-shaped replay and the ledger DDL are reproduced here once so a
 * change to either (a renamed migration, a column added to drizzle's ledger)
 * cannot land in one test file and silently drift in the other.
 */
import { createClient } from "@libsql/client";
import { LEDGER_TABLE } from "../state.mjs";

/** Journal timestamp of 0003, the level production was adopted at. Used here
 *  only as a convenient mid-history fixture level. */
export const BASELINE_MILLIS = 1777261198039;

/** Journal timestamp of the newest committed migration. */
export const LATEST_MILLIS = 1785449603211;

const clients = [];

/** Close every client a fixture opened. Call from afterEach. */
export function closeFixtureClients() {
  while (clients.length > 0) clients.pop()?.close();
}

/** Replay committed migrations into a fresh in-memory database. */
export async function replay(migrations, throughMillis, transform = (sql) => sql) {
  const client = createClient({ url: ":memory:" });
  clients.push(client);
  for (const migration of migrations) {
    if (migration.folderMillis > throughMillis) break;
    for (const statement of transform(migration.sql)) await client.execute(statement);
  }
  return client;
}

/** Reproduces the live production shape: drizzle-kit push kept the
 *  ON DELETE set null that drizzle/0002 dropped. */
export async function productionDatabase(migrations, throughMillis = BASELINE_MILLIS) {
  return replay(migrations, throughMillis, (statements) =>
    statements.map((statement) =>
      statement.includes("ADD `created_by_user_id`")
        ? `${statement.replace(/;?\s*$/, "")} ON DELETE set null`
        : statement,
    ),
  );
}

/** Create the ledger with drizzle's own DDL and insert the given [hash, createdAt] rows. */
export async function addLedger(client, rows) {
  await client.execute(
    `CREATE TABLE ${LEDGER_TABLE} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
  );
  for (const [hash, createdAt] of rows) {
    await client.execute({
      sql: `INSERT INTO ${LEDGER_TABLE} ("hash","created_at") VALUES (?, ?)`,
      args: [hash, createdAt],
    });
  }
}

/** A production-shaped database already under migration management at a level. */
export async function ledgeredDatabase(migrations, throughMillis = BASELINE_MILLIS) {
  const client = await productionDatabase(migrations, throughMillis);
  const migration = migrations.find((candidate) => candidate.folderMillis === throughMillis);
  await addLedger(client, [[migration.hash, throughMillis]]);
  return client;
}
