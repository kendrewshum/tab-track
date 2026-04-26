# tab-track

Lightweight expense splitting app for friends. Self-hosted.

The app now uses account-based access. Users only see groups they have access to, and signup is gated by a shared invite code.

## Stack

- Next.js App Router
- React
- Drizzle ORM
- SQLite locally, Turso in hosted environments
- Vitest for unit tests
- Playwright for end-to-end tests

## Getting Started

From the repo root:

```bash
npm install
npm run dev
```

The app uses a local SQLite database by default during development, so no extra database setup is required for basic local work.

For local auth flows, set these environment variables first:

```bash
AUTH_SECRET=replace-with-a-long-random-secret
APP_INVITE_CODE=shared-friend-code
```

If you need to attach legacy hosted groups like `Austin 2026` to new accounts without recreating data, also set:

```bash
LEGACY_GROUP_ACCESS_MAP='[{"groupName":"Austin 2026","ownerEmail":"you@example.com","memberEmails":["friend@example.com"]}]'
```

## Common Commands

```bash
npm run dev
npm run lint
npm test
npm run build
npm run test:e2e
npm run test:e2e:ui
```

## Testing Expectations

- Every behavior change should add or update unit tests.
- User-facing changes should also add or update Playwright coverage.
- Keep tests close to the behavior they protect:
  - `src/lib/__tests__/` and `src/db/__tests__/` for unit coverage
  - `e2e/` for browser-level user flows

More repo-specific contributor guidance lives in [AGENTS.md](./AGENTS.md).

## Verify Changes Locally Before Pushing

Run this baseline verification from the repo root:

```bash
npm run lint
npm test
npm run build
npm run test:e2e -- --project="Desktop Chrome"
```

If the change affects responsive behavior or mobile layouts, also run:

```bash
npm run test:e2e -- --project="iPhone 14"
```

## Test Environment Notes

- Vitest runs Node-based unit tests.
- Playwright starts the app on port `3001` and recreates a dedicated `e2e-test.db` before each run.
- Hosted environments require `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, but local development does not.
- Hosted auth also requires `AUTH_SECRET` and `APP_INVITE_CODE`.
