/**
 * Read-only operator check: does a live database match what the committed
 * migrations produce?
 *
 *   node scripts/db/check-schema.mjs              # against the latest migration
 *   node scripts/db/check-schema.mjs 0003_abandoned_black_bolt
 *
 * Pass a migration tag to check against an earlier level, which is what you
 * want before adopting a legacy `db:push` database as that baseline.
 *
 * Reads TURSO_DATABASE_URL and TURSO_AUTH_TOKEN from the environment and never
 * prints them; only the protocol and host are echoed, so the output is safe to
 * paste into a ticket or a chat. Runs PRAGMA and SELECT only.
 *
 * Exit 0 when the schema matches, 1 on any difference or failure.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { buildFingerprint, diffFingerprints } from "./fingerprint.mjs";
import { buildExpectedFingerprint, MIGRATIONS_FOLDER, readMigrations } from "./state.mjs";

/** readMigrationFiles drops the tag, so map tag -> timestamp via the journal. */
function resolveTarget(migrations, tag) {
  if (!tag) return migrations.at(-1);
  const journalPath = path.join(MIGRATIONS_FOLDER, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const entry = journal.entries.find((candidate) => candidate.tag === tag);
  return entry && migrations.find((migration) => migration.folderMillis === entry.when);
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.error("TURSO_DATABASE_URL is not set");
    return 1;
  }

  const requestedTag = process.argv[2];
  const migrations = readMigrations();
  const target = resolveTarget(migrations, requestedTag);
  if (!target) {
    console.error(`no committed migration matches "${requestedTag}"`);
    return 1;
  }

  const { protocol, host } = new URL(url);
  console.log(`target:   ${protocol}//${host}`);
  console.log(`expected: schema as of ${target.folderMillis}`);

  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const expected = await buildExpectedFingerprint(migrations, target.folderMillis);
    const differences = diffFingerprints(expected, await buildFingerprint(client));

    if (differences.length === 0) {
      console.log("OK: live schema matches");
      return 0;
    }
    console.log(`MISMATCH: ${differences.length} difference(s)`);
    for (const line of differences) console.log(`  ${line}`);
    return 1;
  } finally {
    client.close();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  // Log only the code: a malformed URL surfaces the whole connection string,
  // which for Turso commonly embeds ?authToken=<token>.
  console.error(`FAILED: ${error?.code ?? "check could not complete"}`);
  process.exitCode = 1;
}
