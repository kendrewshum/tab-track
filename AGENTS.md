# AGENTS.md

This repo is small on purpose. Keep changes easy to trace, easy to test, and easy to review.

## What This App Is

- `tab-track` is a lightweight expense-splitting app for friends.
- The app uses Next.js App Router, React, Drizzle ORM, and SQLite locally.
- Local development falls back to `file:local.db` when `TURSO_DATABASE_URL` is not set.

## Repo Map

- `src/app/`: pages, server actions, and route handlers
- `src/db/`: database configuration and schema
- `src/lib/`: pure domain helpers and calculations
- `e2e/`: Playwright end-to-end coverage
- `drizzle/`: migrations used by local and e2e databases

## Change Expectations

- Keep changes targeted. Prefer small focused edits over broad refactors.
- Follow existing patterns unless there is a clear reason to improve them.
- When changing business logic, favor pure helpers in `src/lib/` when possible so behavior is easy to test.
- If a change affects storage, queries, or schema behavior, check `src/db/`, migrations, and the user flows that depend on them.
- If a change affects a user journey, check both desktop and mobile layouts because Playwright covers both.

## Testing Rules

- Every behavior change must add or update automated tests.
- Do not merge behavior changes with stale tests or missing coverage.

### Unit Tests

- Add or update Vitest tests for logic changes in `src/lib/`, `src/db/`, and other code that can be verified without a browser.
- Put tests in the existing repo patterns such as `src/lib/__tests__/` and `src/db/__tests__/`.
- Prefer focused tests that describe the behavior being protected, not just the function name.

### E2E Tests

- Add or update Playwright tests when a change affects a user-visible flow, form behavior, navigation, persistence, or a regression-prone interaction.
- Prefer extending the nearest existing scenario in `e2e/` before creating a brand-new spec.
- If a UI change behaves differently on smaller screens, verify the `iPhone 14` project locally in addition to desktop.

## Local Workflow

1. Install dependencies with `npm install`.
2. Start the app with `npm run dev`.
3. For schema changes, update migrations and confirm the app still works against local SQLite.
4. Before pushing, run the verification checklist below from the repo root.

## Verification Checklist Before Pushing

Run these commands from the repo root:

```bash
npm run lint
npm test
npm run build
npm run test:e2e -- --project="Desktop Chrome"
```

Run this too when the change impacts responsive UI or mobile behavior:

```bash
npm run test:e2e -- --project="iPhone 14"
```

## Test Environment Notes

- Unit tests run with Vitest via `npm test`.
- E2E tests run with Playwright via `npm run test:e2e`.
- Playwright wipes and recreates `e2e-test.db` before each run, then starts the app on port `3001`.
- Local development uses `local.db` unless Turso environment variables are provided.

## Definition Of Done

- Code change is complete.
- Relevant unit tests were added or updated.
- Relevant e2e tests were added or updated.
- Local verification commands passed.
- Any new workflow expectations are reflected in this file or `README.md`.
