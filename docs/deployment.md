# Deployment

TabTrack deploys on Vercel and stores hosted data in Turso. Database
migrations are an explicit operator action: application builds never change
the database schema.

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

## Rollback and recovery

Drizzle migrations do not automatically reverse. Before a risky Production
migration, verify that the Turso database has a usable backup or restore point
and that the operator knows how to restore it.

If a deployment fails without an incompatible schema change, redeploy the last
compatible application version. If the schema has changed, prefer a
forward-compatible corrective migration. Restore the database only through the
previously verified Turso recovery procedure, and pair it with an application
version compatible with the restored schema.

