#!/bin/bash
# Fired on Stop via asyncRewake. Exits 0 (silent) or 2 (wake Claude with a message).

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0

# Source files changed vs origin (committed) or staged/unstaged
CHANGED_SRC=$(
  {
    git diff "origin/$BRANCH..HEAD" --name-only 2>/dev/null
    git diff --cached --name-only 2>/dev/null
    git diff --name-only 2>/dev/null
  } | grep -E '\.(ts|tsx|js|jsx)$' \
    | grep -vE '\.(test|spec)\.(ts|tsx|js|jsx)$' \
    | grep -v '__tests__' \
    | grep -vE '\.(config|d)\.' \
    | sort -u
)

[ -z "$CHANGED_SRC" ] && exit 0   # nothing changed, nothing to check

ISSUES=()

# 1. Check that at least one test file was also touched
CHANGED_TESTS=$(
  {
    git diff "origin/$BRANCH..HEAD" --name-only 2>/dev/null
    git diff --cached --name-only 2>/dev/null
    git diff --name-only 2>/dev/null
  } | grep -E '\.(test|spec)\.(ts|tsx|js|jsx)$' | sort -u
)

if [ -z "$CHANGED_TESTS" ]; then
  ISSUES+=("No unit test files were added or modified alongside these source changes: $(echo "$CHANGED_SRC" | tr '\n' ' ')")
fi

# 2. Check for an E2E test framework (Playwright or Cypress)
if ! { [ -f "playwright.config.ts" ] || [ -f "playwright.config.js" ] || [ -f "cypress.config.ts" ] || [ -f "cypress.config.js" ]; }; then
  ISSUES+=("No E2E test framework found (Playwright or Cypress). Please set one up and add E2E tests for the changed functionality.")
fi

# 3. Run unit tests if node_modules is present
if [ -d "node_modules" ]; then
  TEST_OUTPUT=$(npm test 2>&1)
  TEST_EXIT=$?
  if [ $TEST_EXIT -ne 0 ]; then
    ISSUES+=("Unit tests are failing. Output: $(echo "$TEST_OUTPUT" | tail -20)")
  fi
fi

if [ ${#ISSUES[@]} -eq 0 ]; then
  exit 0
fi

# Build the message and wake Claude
MSG=$(printf '  - %s\n' "${ISSUES[@]}")
printf '{"systemMessage": "Test coverage check failed:\n%s\n\nPlease fix the above issues before finishing: ensure unit tests cover changed code, add E2E tests, and make sure all tests pass."}' "$MSG"
exit 2
