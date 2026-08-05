# Deployment

TabTrack deploys on Vercel and stores hosted data in Turso. Production deploys
apply committed migrations automatically: `node scripts/db/cli.mjs` runs before
the build when `VERCEL_ENV=production`. Preview and local builds never touch a
database. See "Production migrations on deploy" below.

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
7. Deploy to Production. The deploy applies the same migrations itself; do not
   run `npm run db:migrate` against Production by hand.

`npm run db:push` remains available only for deliberate local schema
prototyping. It is not a deployment command.

## Production migrations on deploy

`node scripts/db/cli.mjs` runs before the build. Outside `VERCEL_ENV=production`
it prints a `skipped:` line and exits without opening a connection, so Preview
and local builds never touch a database.

On Production it reads the `__drizzle_migrations` ledger, compares the live
schema against what the committed migrations produce for the level the ledger
claims, applies anything newer, then re-verifies. It refuses and fails the
build — writing nothing — if the ledger is missing, empty, at an unrecognised
timestamp, carries a hash that does not match the committed migration file, or
if the live schema disagrees with the ledger. The refusal prints the diff.

Two consequences worth planning around:

- A migration must be backward compatible with the release currently serving
  traffic, because the schema changes before the new build is promoted.
- A database with no ledger is refused, not adopted. Adopting a legacy
  `db:push` database is a deliberate operator action — see the section above.

To check a live database yourself, with that environment's credentials loaded:

```bash
node scripts/db/check-schema.mjs                       # against the latest migration
node scripts/db/check-schema.mjs 0003_abandoned_black_bolt   # against an earlier level
```

It is read-only, and prints only the protocol and host of the target, never the
connection string or token.

### Historical: how Production was adopted

Production was built by `db:push` and had no ledger. On 2026-08-04 it was
adopted at `0003_abandoned_black_bolt` and migrated through `0009`, using a
temporary `DB_ADOPT_BASELINE` opt-in that has since been removed along with the
adoption code. This is recorded for context only; there is nothing here to
re-run. Should another legacy database ever need adopting, use the manual
procedure in "Existing databases created by `db:push`" above, and note that
Vercel reads environment variables at build time — setting one does not affect
an existing deployment, so a fresh build is required.

## Rollback and recovery

Drizzle migrations do not automatically reverse. Before a risky Production
migration, verify that the Turso database has a usable backup or restore point
and that the operator knows how to restore it.

If a deployment fails without an incompatible schema change, redeploy the last
compatible application version. If the schema has changed, prefer a
forward-compatible corrective migration. Restore the database only through the
previously verified Turso recovery procedure, and pair it with an application
version compatible with the restored schema.
