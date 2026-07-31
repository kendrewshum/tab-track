# Pending Group Invitations Design

## Goal

Allow a group owner to share a group with someone who has not registered yet. The owner receives a copyable, one-time invitation link; TabTrack does not send email.

Registered accounts keep the existing immediate-sharing path. Pending invitations are a separate lifecycle that issue #30 can later cancel, while ledger members remain independent from app access.

## Owner experience

The existing **App Access** form accepts:

- an email address;
- an optional unlinked ledger member.

When the normalized email belongs to a registered account, the action immediately grants member access. It also links the selected ledger member when that member is still available.

When the email is not registered, the action creates or rotates one pending invitation for that group and normalized email. The success state shows a copyable invitation link. The raw token is returned only in this response and cannot be recovered later.

The App Access section lists pending invitations separately from active accounts. Each row shows the invited email, optional ledger-member name, and expiration. It never includes the raw token or token hash. Re-inviting the same email rotates the token, extends the expiration, and immediately invalidates the old link.

Issue #29 does not add email delivery, invitation cancellation, or active-access revocation. Cancellation and revocation controls belong to issue #30.

## Recipient experience

An invitation expires seven days after its most recent creation or rotation.

Opening a valid invitation link immediately exchanges the URL token for an `HttpOnly`, `Secure` in production, `SameSite=Lax` cookie and redirects into an invitation-claim flow. The cookie lasts 30 minutes or until the invitation expires, whichever comes first. The landing response sets `Referrer-Policy: no-referrer`. This keeps the token out of subsequent login and signup URLs, client-side state, analytics, and referrer headers.

If the recipient is signed out, the claim flow sends them to login with a banner explaining that authentication will accept the group invitation. The login page links to signup and preserves the invitation cookie.

A valid invitation authorizes signup for its normalized email, so an invited recipient does not also need `APP_INVITE_CODE`. A signup with no valid matching invitation continues to require the configured app invite code.

After successful login or signup, authentication redirects back to the claim flow. A matching account claims the invitation once and enters the group. A signed-in recipient who opens a link can claim it without authenticating again.

If the signed-in account does not match, the page explains that a different account is required without displaying the invited email. The invitation remains usable so the recipient can sign out and use the correct account.

Invalid, expired, cancelled, already-used, and otherwise unavailable invitations share one generic unavailable state. The flow does not reveal which condition applied.

## Data model

Add `group_invitations` with:

- `id`;
- `groupId`, referencing `groups.id` with `ON DELETE CASCADE`;
- normalized `email`;
- `role`, fixed to the member access role for this feature;
- nullable `memberId`, referencing `members.id` with `ON DELETE SET NULL`;
- a unique HMAC token hash;
- `expiresAt`;
- nullable `claimedAt`;
- nullable `claimedByUserId`, referencing `users.id` with `ON DELETE SET NULL`;
- nullable `cancelledAt`;
- `createdAt` and `updatedAt`.

A unique index on `(groupId, email)` enforces one invitation lifecycle per group and normalized email. A separate unique index on `tokenHash` makes each active token unambiguous. An expiration index supports bounded cleanup and readiness queries.

Rotation updates the existing row with a new hash and expiry, refreshes the optional member choice, and clears prior claimed or cancelled state. The share action refuses rotation while that email already has active group access. After issue #30 revokes access, the same invitation row can be rotated for a new invitation.

The database cannot enforce that `memberId` belongs to `groupId`, so every create, rotate, list, and claim query scopes the member through the invitation's group.

## Token handling

Generate 32 cryptographically random bytes and encode them with base64url. Persist only `HMAC-SHA-256(AUTH_SECRET, rawToken)`.

The raw token exists only in:

- the one-time action response shown to the owner;
- the initial `/invite/[token]` request;
- the short-lived secure cookie used to finish authentication.

The initial token can appear in ordinary server access logs because it is part of the landing URL. The seven-day expiry, one-time claim, immediate cookie exchange, token rotation, and no-referrer response limit that exposure. Avoid logging request URLs or cookie values in invitation code.

The owner UI constructs the absolute copyable URL from the returned relative invitation path and the current browser origin. No new deployment URL environment variable is required.

## Components and boundaries

Keep the feature in focused units:

1. A pure invitation-token module generates raw tokens, calculates HMAC hashes, and defines expiry.
2. A pure share-form parser normalizes and validates email and the optional member ID.
3. An invitation store owns group-scoped persistence, rotation, active-state checks, and conditional consumption.
4. A sharing service chooses registered-account immediate access or pending-invitation creation.
5. A claim service validates account email and atomically consumes an invitation while granting access.
6. A view-model helper produces pending rows without exposing token material.
7. Thin server actions and routes enforce the current owner or authenticated user, manage cookies and redirects, revalidate pages, and translate domain results into sanitized UI states.

These units do not send email, infer a ledger-member link from names or email addresses, or mix invitation state into balance and activity calculations.

## Immediate registered-account sharing

For an existing account, one transaction:

1. verifies the account does not already have group access;
2. inserts member access;
3. conditionally links the selected member after validating that it belongs to the group and is still unclaimed.

An invalid or cross-group member rejects the request without granting access. If a valid optional member becomes unavailable concurrently, access still succeeds and the response explains that no ledger member was linked. The owner can select another member through the account-link controls from issue #32.

## Atomic invitation claim

The claim service runs in one database transaction:

1. hashes the cookie token and resolves an active, unexpired, unclaimed, uncancelled invitation;
2. verifies that the authenticated account's normalized email matches;
3. conditionally marks the invitation claimed, so concurrent or replayed claims cannot both win;
4. inserts group access if it does not already exist;
5. conditionally links the invitation's member when it still belongs to the group, the member is unclaimed or already linked to this account, and the account is not linked to a different member in that group.

Any database failure rolls back the claim marker and access grant together. If the optional member is unavailable, claiming still succeeds with access only. The cookie is cleared after success or a definitive unavailable result, but retained after an account mismatch.

Existing access is treated idempotently: the invitation is consumed and the user enters the group without a duplicate access row.

## Authentication integration

The invitation landing route validates the raw token before setting the cookie. The claim route then chooses among:

- redirect to login when no account is authenticated;
- claim and redirect to the group for a matching authenticated account;
- render mismatch guidance for a different authenticated account;
- render the generic unavailable state.

Login and signup actions select the claim route as their post-authentication destination when an invitation cookie is present. They do not place invitation tokens in form fields or URLs.

Before creating an account without `APP_INVITE_CODE`, signup validates that the cookie identifies an active invitation whose normalized email matches the submitted email. Final access is still granted only by the atomic post-authentication claim.

## Error handling and security

- Owner mutations require `requireGroupOwner(groupId)`.
- Invitation reads and writes always include the group scope.
- Unknown emails are no longer an error; they produce pending invitations.
- Existing access returns the current generic already-shared response.
- Missing or cross-group member IDs do not disclose external records.
- Claim failures never expose database errors, token hashes, invitation existence, group identity, or the invited email.
- The raw token is never stored in the database, rendered in a pending list, or sent to client-side analytics.
- Rate limiting already applied to login and signup remains unchanged.

## Migration verification

Generate the next Drizzle migration after the optional account-to-member link migration.

Apply all migrations to a fresh SQLite database and assert:

- the group, member, and claimed-user foreign-key actions;
- uniqueness of `(group_id, email)` and `token_hash`;
- nullable member and claim fields;
- multiple invitations for the same email in different groups;
- rejection of duplicate group/email rows and duplicate token hashes;
- the declared expiration index.

## Automated coverage

Unit and database tests cover:

- email normalization and form validation;
- token entropy shape and deterministic HMAC hashing;
- absence of raw tokens in persisted rows and pending view models;
- registered-account immediate sharing;
- pending creation and seven-day expiry;
- re-invitation rotation and old-token invalidation;
- group and member scoping;
- valid, expired, cancelled, claimed, and unknown tokens;
- matching and mismatched account emails;
- signup-code bypass only for a valid matching invitation;
- atomic concurrent claims and replay attempts;
- existing-access idempotency;
- optional-member success and access-only fallback.

Desktop Chrome and iPhone 14 Playwright coverage proves:

1. an owner invites an unregistered email and copies the generated link;
2. the invitation appears separately from active access;
3. the recipient follows the link, signs up without the shared app invite code, and enters the group;
4. the linked ledger member appears when available;
5. the consumed link cannot be replayed;
6. rotating an invitation invalidates the prior link;
7. an account-email mismatch receives sanitized guidance;
8. registered-account sharing remains immediate.

## Out of scope

- Sending invitation email.
- Verifying general account email ownership outside possession of the invitation token.
- Multiple access roles or owner invitations.
- Cancelling invitations or revoking active access; issue #30 adds those controls.
- Automatically linking members by name or email.
- Reassigning historical expenses, settlements, or activity.
