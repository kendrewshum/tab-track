import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { buildFingerprint, diffFingerprints } from "./fingerprint.mjs";
import {
  buildExpectedFingerprint,
  classifyDatabaseState,
  LEDGER_TABLE,
  MIGRATIONS_FOLDER,
  readMigrations,
} from "./state.mjs";

/**
 * Production deploys apply committed migrations; every other environment is
 * left alone. The build command is global to every Vercel environment, so the
 * guard has to live here rather than in vercel.json.
 */
export function shouldRun(env) {
  if (env.VERCEL_ENV !== "production") {
    return { run: false, reason: `skipped: VERCEL_ENV is ${env.VERCEL_ENV ?? "unset"}` };
  }
  return { run: true, reason: "production deploy" };
}

export async function verifyFinalState(client, migrations) {
  const latestMillis = migrations.at(-1).folderMillis;
  const problems = diffFingerprints(
    await buildExpectedFingerprint(migrations, latestMillis),
    await buildFingerprint(client),
  );

  const ledgerExists = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    args: [LEDGER_TABLE],
  });
  const ledger = ledgerExists.rows.length
    ? await client.execute(`SELECT created_at FROM ${LEDGER_TABLE} ORDER BY created_at DESC LIMIT 1`)
    : { rows: [] };
  const recorded = ledger.rows[0] ? Number(ledger.rows[0].created_at) : null;
  if (recorded !== latestMillis) {
    problems.push(`ledger records ${recorded}, expected ${latestMillis}`);
  }
  return problems;
}

export async function run({ env = process.env, createClientFn, log = console.log } = {}) {
  const gate = shouldRun(env);
  log(`db migrate: ${gate.reason}`);
  if (!gate.run) return 0;

  // Client construction gets its own handler: @libsql/core's own errors (e.g.
  // a malformed URL) embed the full connection string, and Turso URLs commonly
  // carry the auth token as a query parameter. Logging err.message here would
  // put the credential in the build log, so only a fixed message and the
  // machine-readable error code are logged - never err.message or env.
  let client;
  try {
    client = createClientFn
      ? createClientFn()
      : createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  } catch (err) {
    log(`db migrate: FAILED - could not construct database client (code: ${err?.code ?? "unknown"})`);
    return 1;
  }

  // Everything below only ever throws errors about schema/migration state, not
  // connection credentials, so their messages are safe to log directly. A
  // skipped run never reaches here, so a build with the gate closed can never
  // be misreported as a failure.
  try {
    const migrations = readMigrations();
    const state = await classifyDatabaseState({ client, migrations });

    if (state.action === "REFUSE") {
      log(`db migrate: REFUSED - ${state.reason}`);
      for (const line of state.diff) log(`  ${line}`);
      return 1;
    }

    if (state.action === "NOOP") {
      log(`db migrate: already up to date at ${state.atMillis}`);
      return 0;
    }

    if (state.action !== "MIGRATE") {
      log(`db migrate: REFUSED - unrecognised action ${state.action}`);
      return 1;
    }
    log(`db migrate: ledger at ${state.fromMillis}, applying pending migrations`);

    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

    const problems = await verifyFinalState(client, migrations);
    if (problems.length > 0) {
      log("db migrate: FAILED verification");
      for (const line of problems) log(`  ${line}`);
      return 1;
    }

    log("db migrate: complete and verified");
    return 0;
  } catch (err) {
    // err may not be an Error (e.g. a thrown string), so read defensively
    // rather than risk a TypeError inside the handler itself.
    log(`db migrate: FAILED - ${String(err?.message ?? err)}`);
    return 1;
  }
}

// Only run when invoked directly, so tests can import the module freely.
// pathToFileURL (not a hand-built `file://` string) so a repo path
// containing a space still compares equal instead of silently no-op-ing.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Set exitCode and let the process exit naturally instead of calling
  // process.exit(), which can truncate pending writes to a piped stdout
  // (e.g. Vercel build logs) and lose the tail of a REFUSE diff.
  process.exitCode = await run();
}
