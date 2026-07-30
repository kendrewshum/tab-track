# Group Access Revocation and Invitation Cancellation

## Objective

Allow a group owner to remove an account's app access or cancel a pending
invitation without changing the group's financial ledger. This implements
GitHub issue #30 on top of the optional account-to-member link and pending
invitation work.

## Scope

This feature adds two owner-only lifecycle operations:

1. Revoke an active non-owner account's access to a group.
2. Cancel an active pending invitation to a group.

It does not delete accounts, ledger members, expenses, settlements, revisions,
or activity. It does not transfer group ownership or add multiple-owner
management.

## Domain Invariants

### Active access revocation

- The operation accepts a group ID and group-access ID, never an unscoped user
  ID.
- The current account must be the owner of that group.
- The target access row must belong to the same group.
- An owner access row cannot be revoked. The UI also omits the control, but the
  service enforces the rule independently.
- A successful revocation deletes only the target `group_access` row.
- Any `members.userId` link remains unchanged. The ledger member, financial
  history, and activity remain intact.
- Re-sharing the same registered account restores access and naturally retains
  its existing member link.
- Repeating a revocation is idempotent and returns a safe no-longer-active
  result.

### Pending invitation cancellation

- The operation accepts a group ID and invitation ID.
- The current account must be the owner of that group.
- The invitation must belong to the same group.
- Cancellation sets `cancelledAt` and `cancelledByUserId`; it does not
  hard-delete the invitation.
- Only an unclaimed, uncancelled invitation is changed. Expired invitations may
  also be marked cancelled so the owner action remains deterministic, but they
  are already unusable.
- Repeating cancellation is idempotent.
- Cancelled invitations cannot authorize signup or be claimed.
- Cancelling an invitation does not change its optional ledger-member link.

### Information boundaries

- Target IDs are always scoped to the owner-authorized group.
- A missing, stale, or cross-group target produces the same safe result. The
  caller cannot use the action to discover access or invitation rows in another
  group.
- Non-owners cannot invoke either operation even with a valid target ID.

## Architecture

Add a focused server-side access-management module with two explicit
operations:

- `revokeGroupAccess`
- `cancelGroupInvitation`

The module owns target scoping, lifecycle rules, idempotency, and the minimal
database mutations. It accepts a narrow store interface so the rules can be
tested without a browser and so local SQLite and Turso use the same behavior.

Server actions remain thin:

1. Parse the submitted target ID strictly.
2. Require the current user to own the route group.
3. Call the appropriate service with the authenticated owner ID and current
   time.
4. Revalidate the group page.
5. Return path-keyed, accessible feedback without exposing cross-group state.

The two operations stay separate because active access and pending invitations
have different persistence and lifecycle rules.

## User Interface

The existing App Access section remains the management surface.

### Account rows

- Non-owner rows display `Remove access`.
- Owner rows never display a removal control.
- Activating removal reveals an inline confirmation step with `Confirm remove`
  and `Keep access`.
- The confirmation copy states that app access will end but the ledger member
  and history remain.

### Pending invitation rows

- Each pending row displays `Cancel invitation`.
- Activating cancellation reveals an inline confirmation step with
  `Confirm cancel` and `Keep invitation`.
- The confirmation copy states that the current link will stop working.

Both controls disable while submitting and expose success or failure through
an accessible status region. On success, the page is revalidated so the active
row disappears. Layout must remain usable without horizontal overflow on
Desktop Chrome and iPhone 14.

## Error Handling

- Invalid or missing form fields return a generic validation error.
- Unauthorized group access follows the application's existing not-found
  behavior.
- Missing, stale, already-revoked, already-cancelled, or cross-group targets
  return a safe idempotent result and do not mutate another group.
- Owner-targeted revocation returns a specific safe error because the caller is
  already the authorized owner and no external state is disclosed.
- Database failures return a generic retryable error and do not claim success.
- UI controls leave confirmation open after an error so the owner can retry or
  cancel.

## Concurrency

- Revocation uses a group-scoped delete that excludes owner rows.
- Invitation cancellation uses a conditional group-scoped update that requires
  `claimedAt IS NULL` and `cancelledAt IS NULL`.
- Concurrent duplicate submissions are therefore idempotent: at most one
  mutation reports an active-state transition, and every later attempt sees
  the target as no longer active.
- Claim and cancellation race through guarded updates. Exactly one transition
  wins: a claimed invitation is not cancelled, and a cancelled invitation is
  not claimed.

## Testing

### Unit and service tests

- owner revokes a member access row
- revocation preserves `members.userId` and ledger records
- owner access cannot be revoked
- non-owner, cross-group, missing, and repeated targets do not mutate state
- owner cancels an active invitation with cancellation audit fields
- cancelled invitations remain unclaimable
- repeated, claimed, cross-group, and missing invitations are safe
- concurrent claim/cancel and duplicate-action cases are single-transition

### Server-action tests

- strict target parsing
- owner authorization
- correct service inputs and page revalidation
- generic crafted-request responses
- safe success and retryable failure feedback

### End-to-end tests

- owner revokes a linked account and that account immediately loses group
  access
- the ledger member, balances, and history remain visible to the owner
- re-sharing restores access and retains the member link
- owner cancellation removes the pending row and the old link becomes
  unavailable
- owner rows have no removal control
- non-owners cannot see or invoke management controls
- inline confirmation and pending states work on Desktop Chrome and iPhone 14

## Completion Criteria

- Active access and pending invitations can be removed from the App Access
  section by the group owner.
- Owner access is protected at both UI and service layers.
- Financial identity and history survive access revocation.
- Cancelled invitation links cannot authorize or claim access.
- Cross-group and repeated requests are safe and idempotent.
- Relevant unit, migration-aware, action, Desktop Chrome, and iPhone 14 checks
  pass.
