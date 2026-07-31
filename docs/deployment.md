# Deployment

TabTrack deploys on Vercel and stores hosted data in Turso. Database
migrations are an explicit operator action: application builds never change
the database schema, except for the guarded one-time baseline adoption step
described in "One-time production baseline adoption" below.

## Environments

Create separate Turso databases for Vercel's **Preview** and **Production**
environments. Give each environment its own database-scoped token and configure
these variables in the matching Vercel environment:

| Variable | Purpose |
| --- | --- |
| `TURSO_DATABASE_URL` | `libsql://` URL for that environment's Turso database |
| `TURSO_AUTH_TOKEN` | Token scoped to that database |
| `AUTH_SECRET` | Long, random secret used to protect authentication state |
| `APP_INVITE_CODE` | Shared code required by the current signup flow |

Do not copy Production database credentials into Preview. Local development can
leave the Turso variables unset and use `file:local.db`.

## Verify the migration target

Run migrations from a trusted administrative environment, not from a Vercel
build. Load the same Turso variables configured for the target environment,
then print only the non-secret URL components:

```bash
node -e 'const url = new URL(process.env.TURSO_DATABASE_URL); console.log({ protocol: url.protocol, host: url.host })'
```

Confirm that the hostname is the intended Preview or Production database. Also
confirm the selected Vercel project/environment in the dashboard. Never print
`TURSO_AUTH_TOKEN`, `AUTH_SECRET`, or `APP_INVITE_CODE`.

## Existing databases created by `db:push`

Databases deployed before committed migrations were introduced may already
contain the application schema without Drizzle's `__drizzle_migrations` ledger.
Do not run `npm run db:migrate` against one of these databases until it has been
adopted. Otherwise Drizzle starts at migration `0000` and collides with tables
that already exist.

Adopt Preview first, then repeat the same checks independently for Production:

1. Create and verify a usable backup or restore point.
2. Check out the exact deployed revision that last ran `db:push`. Migration
   metadata from a newer or older revision is not a valid baseline.
3. Verify the target URL as described above, then inspect the target through a
   trusted Turso shell or administrative client. If `__drizzle_migrations`
   exists and contains rows, stop: the database is already migration-managed
   and must not be baselined again.
4. Compare the target's tables, columns, foreign keys, and indexes with the
   schema and committed migrations at that exact deployed revision. Stop and
   resolve every difference before continuing. Never mark unapplied schema as
   migrated.
5. From that revision, print the last committed migration's tag, SHA-256 hash,
   and journal timestamp:

   ```bash
   node --input-type=module -e 'import { createHash } from "node:crypto"; import { readFileSync } from "node:fs"; const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")); const entry = journal.entries.at(-1); const migration = readFileSync(`drizzle/${entry.tag}.sql`); console.log({ tag: entry.tag, hash: createHash("sha256").update(migration).digest("hex"), createdAt: entry.when });'
   ```

6. In one transaction, create the ledger with Drizzle's SQLite shape and insert
   the printed hash and timestamp. Substitute only the two reviewed values:

   ```sql
   BEGIN;
   CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (
     id SERIAL PRIMARY KEY,
     hash text NOT NULL,
     created_at numeric
   );
   INSERT INTO `__drizzle_migrations` (hash, created_at)
   VALUES ('<printed hash>', <printed createdAt>);
   COMMIT;
   ```

7. Query `__drizzle_migrations` and verify the stored hash and timestamp. Then
   check out the reviewed release revision you intend to deploy, review its
   newer migration files, and run `npm run db:migrate` from that checkout.
   Drizzle will skip the adopted migrations and apply only migrations newer
   than the recorded timestamp.

If the deployed schema cannot be matched exactly to a committed revision, do
not guess a baseline. Restore a clone, reconcile it with a reviewed corrective
migration, and rehearse the procedure there before changing Preview or
Production.

## Migrate and deploy

Use Preview first:

1. Review the committed SQL in `drizzle/`.
2. Export the Preview `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
3. Verify the target as described above.
4. Apply committed migrations:

   ```bash
   npm run db:migrate
   ```

5. Deploy the compatible application version to Preview.
6. Verify signup or login, open a group, and check `/api/health`.
7. Repeat the target verification and migration for Production.
8. Deploy the same verified application version to Production and repeat the
   smoke checks.

`npm run db:push` remains available only for deliberate local schema
prototyping. It is not a deployment command.

## One-time production baseline adoption

Production predates the migration ledger: it was built by `db:push` and sits at
the `0003` schema with no `__drizzle_migrations` table. `node scripts/db/cli.mjs`
runs at the start of every Vercel build and adopts that schema as `0003` before
applying `0004`-`0009`.

It is inert unless **both** hold:

- `VERCEL_ENV=production`
- `DB_ADOPT_BASELINE=0003`

It compares the live schema against the committed migrations before writing
anything and refuses, failing the build, on any mismatch.

### Procedure

1. Take a backup and record the UTC timestamp. Turso PITR is always on;
   retention is 24 hours on Free, longer on paid plans. A PITR restore creates a
   *new* database, so recovery also means repointing `TURSO_DATABASE_URL`.
2. Verify out of band that the Production database schema matches the expected
   baseline. The test suite validates against a reconstructed schema from the
   committed migrations, not a live sample. In a trusted environment with
   Production Turso credentials loaded, run:

   ```bash
   node --input-type=module -e '
   import { createClient } from "@libsql/client";
   import { readMigrations, buildExpectedFingerprint, BASELINE_MILLIS } from "./scripts/db/state.mjs";
   import { buildFingerprint, diffFingerprints } from "./scripts/db/fingerprint.mjs";
   const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
   try {
     const migrations = readMigrations();
     const expected = await buildExpectedFingerprint(migrations, BASELINE_MILLIS);
     const actual = await buildFingerprint(client);
     const differences = diffFingerprints(expected, actual);
     if (differences.length === 0) console.log("✓ Schema matches baseline");
     else { console.log("Schema mismatches:"); differences.forEach(d => console.log("  " + d)); process.exit(1); }
   } finally { client.close(); }
   '
   ```

   Expect "Schema matches baseline" or a diff output. The guarded run will refuse
   and fail the build on any mismatch, but discovering it beforehand prevents a
   production deployment failure.
3. Merge the change to `main`. It stays inert without the environment variable.
4. Add `DB_ADOPT_BASELINE=0003` to the Vercel **Production** environment.
5. Trigger a Production deployment. While an Instant Rollback is active the new
   build does not take traffic.
6. Read the build log: expect `adopting baseline`, then `complete and verified`.
7. Smoke-test login on the deployment URL.
8. Promote the deployment / undo the rollback.
9. Remove `DB_ADOPT_BASELINE` immediately.

After step 9, the script is a permanent no-op again: it only acts when both
`VERCEL_ENV=production` and `DB_ADOPT_BASELINE=0003` are set, and the latter
is now removed. Applying future migrations to Production goes back to being
a manual `npm run db:migrate` action, as described above.

## Rollback and recovery

Drizzle migrations do not automatically reverse. Before a risky Production
migration, verify that the Turso database has a usable backup or restore point
and that the operator knows how to restore it.

If a deployment fails without an incompatible schema change, redeploy the last
compatible application version. If the schema has changed, prefer a
forward-compatible corrective migration. Restore the database only through the
previously verified Turso recovery procedure, and pair it with an application
version compatible with the restored schema.
