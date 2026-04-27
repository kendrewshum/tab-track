# Activity Archive Design

**Date:** 2026-04-27

## Goal

Paginate the group activity log in a way that improves UX, avoids infinite scroll, and limits future loading lag risk without overcomplicating the first implementation.

## Problem

The group detail page currently builds and renders the full activity history inline. As activity grows, that creates two problems:

1. The Activity section can become visually unbounded and harder to browse.
2. The page has no archive controls, so every visit attempts to show the full history at once.

The current feed is not sourced from a single table. It is a merged timeline built from expenses, expense revisions, and settlements, then sorted together by event timestamp.

## Decision

Use a URL-backed `Load more activity` archive instead of infinite scroll or literal numbered pagination.

The Activity section will:

- show the newest chunk of activity by default
- reveal older items on demand with a `Load more activity` control at the bottom
- preserve the revealed depth across refresh and browser Back by encoding it in the URL

The URL contract will use a visible-count query param, for example:

- `/groups/<id>`
- `/groups/<id>?activity=40`
- `/groups/<id>?activity=60`

This is cumulative reveal, not literal page navigation. Each larger value means “show the newest N activity items.”

## Why This Pattern

### Why not infinite scroll

Infinite scroll is a poor fit for an archive-like history surface:

- it makes stopping points weak
- it reduces orientation within long history
- it complicates footer access and browser restoration behavior
- it tends to be worse for accessibility and predictable navigation

### Why not numbered pages

Numbered pagination is strongest when users need random access to arbitrary slices of a list. That is not the main use case here. The expected behavior is:

- check recent activity first
- optionally reveal older history
- continue in one chronological list

`Load more` better matches that mental model.

### Why URL-backed reveal

Persisting archive depth in the URL improves the browsing experience:

- refresh keeps the same revealed history depth
- opening an older item and returning with Back preserves the same activity depth
- the behavior is predictable without adding client-side state complexity

## UX Design

### Default behavior

The page initially shows the newest 20 activity items.

If there are more than 20 items, render a footer control:

- label: `Load more activity`

Clicking the control reloads the same group page with a larger `activity` value and appends older entries below the visible list.

### Archive behavior

- newest activity remains at the top
- older activity is appended below
- already-visible items remain visible after each click
- there is no auto-loading while scrolling

### End state

When all activity is visible, hide the `Load more activity` control.

### Empty state

The existing `No activity yet` empty state remains unchanged.

## URL And Validation Rules

### Query param

Use `activity` as the query param name. It represents the number of visible items, not a page number.

### Default chunk size

Use a chunk size constant of `20`.

### Sanitization

The page should sanitize the param before using it:

- missing value becomes the default visible count
- non-numeric values become the default visible count
- zero or negative values become the default visible count
- values smaller than the default become the default visible count
- values larger than the default should snap to the next valid chunk boundary

Examples:

- `?activity=20` stays `20`
- `?activity=21` becomes `40`
- `?activity=40` stays `40`
- `?activity=0` becomes `20`
- `?activity=abc` becomes `20`

This keeps the archive predictable and avoids odd partial-depth states.

## Architecture

Keep the implementation split into two responsibilities.

### 1. Activity event construction

`src/lib/history.ts` remains the source of truth for:

- activity event shapes
- merging events from expenses, revisions, and settlements
- descending chronological ordering

This preserves the current business logic boundary.

### 2. Activity archive windowing

Add a small helper layer that takes an already-sorted activity list plus a requested visible count and returns:

- the visible activity slice
- whether older items remain
- the next visible count to request

This helper should be intentionally generic so a future pivot to literal pagination or query-level retrieval only changes archive-window semantics, not event-building rules.

## Page Integration

On the group page:

1. Read `searchParams`.
2. Derive a sanitized visible count from `activity`.
3. Build the full ordered activity event array using the existing event builder.
4. Pass the ordered array and visible count to the archive helper.
5. Render only the visible slice.
6. Render a `Load more activity` link when older items remain.
7. Point that link at the same route with the next `activity` count.

This keeps the first version simple and fully server-rendered.

## Scope Boundary For Version 1

Version 1 should use render-level limiting, not query-level limiting.

That means the page will still:

- fetch the underlying data sets needed for the current group
- build the full merged activity event array in memory
- slice before render using the new archive helper

This is intentional.

The first goal is to:

- fix the unbounded UI
- establish the URL-backed archive contract
- keep the implementation small and easy to verify

## Why Query-Level Limiting Is Deferred

Query-level limiting is attractive for long-term scale, but it adds complexity immediately because the feed is composed from multiple event sources.

Risks introduced by query-level limiting now:

- more custom SQL or query orchestration across multiple tables
- harder correctness guarantees for merged chronological order
- trickier duplicate/skip avoidance when multiple events share similar timestamps
- more complex tests for cursor or boundary behavior

Because of that, query-level limiting should be a later optimization only if real activity volume or measured latency justifies it.

## Future Pivot Path

If we later want literal pagination or query-level limiting, the clean migration path is:

1. keep the event-building rules intact
2. replace the archive helper semantics
3. move the visible-window contract lower into the query layer if needed

The important future-proofing choice is the abstraction boundary, not whether the first URL param is named like a page number.

## Testing Plan

### Unit tests

Add focused tests for the new archive helper in the existing `src/lib/__tests__/` pattern.

Test cases should cover:

- default visible window behavior
- valid count handling
- invalid count sanitization
- chunk boundary snapping
- `hasMore` behavior
- next-count calculation
- all-items-visible behavior

### E2E tests

Extend the nearest existing group/activity flow in Playwright to verify:

- the group page initially shows only the newest chunk of activity
- `Load more activity` reveals older entries
- the URL updates to include the larger `activity` count
- refresh preserves the expanded archive depth
- navigating away and back preserves the expanded archive depth

Desktop coverage is required. Mobile coverage is optional unless the final control placement behaves materially differently on smaller screens.

## Non-Goals

This change does not include:

- infinite scroll
- numbered page navigation
- direct “jump to older date” controls
- query-level or cursor-based activity retrieval
- redesigning the activity event cards themselves

## Open Implementation Notes

- Keep the chunk size as a single shared constant so later behavior changes stay centralized.
- Keep the archive helper pure so it is easy to test independently from the page component.
- Prefer route links for `Load more activity` so browser navigation behavior stays native and predictable.
