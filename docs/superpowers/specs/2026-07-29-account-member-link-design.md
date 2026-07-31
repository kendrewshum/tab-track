# Optional Account-to-Member Link Design

## Goal

Allow a group owner to explicitly associate an account that has app access with one ledger member in the same group. Accounts, access grants, and ledger members remain separate concepts with independent lifecycles.

This replaces the literal user/member unification proposed by issue #31.

## Data model

Add nullable `members.userId`, referencing `users.id` with `ON DELETE SET NULL`.

Add a unique index on `(groupId, userId)`. SQLite permits multiple rows with a null `userId`, so offline members remain supported while a linked account can represent at most one member per group.

The link does not grant or revoke access. A linked user must already have a `group_access` row for the same group. Removing access later must not delete or unlink historical ledger participation.

## Owner interface

The existing **App Access** section remains account-centric. Each access row displays:

- the account email;
- its owner/member access role;
- a **Ledger member** selector.

The selector contains:

- **No linked member**;
- every group member not linked to another account;
- the row's currently linked member.

Changing the selection submits immediately and reports an inline success or sanitized error. Owners can link their own account, link another authorized account, move an account to another unclaimed member, or unlink it. Regular members can see neither the controls nor other accounts' linking details.

The separate **Members** section remains the ledger-oriented list and continues to support offline participants.

## Server action and transaction

Add an owner-only action accepting `groupId`, target `groupAccessId`, and nullable `memberId`.

Inside one transaction it:

1. resolves the target access row by both ID and group;
2. resolves the requested member by both ID and group when non-null;
3. clears any existing member link for the target account in that group;
4. links the requested member to the target account.

The unique index is the final concurrency guard. A conflicting link returns a generic message such as “That ledger member is already linked to another account.” Missing or cross-group targets do not disclose whether an external record exists.

Repeated link or unlink submissions are idempotent.

## Read model

The group page joins `group_access` to `users` and left-joins the group's linked member. A pure helper builds and sorts the account rows, marks the currently selected member, and computes available choices without inferring links from names or email addresses.

No balance, split, settlement, or activity calculation depends on `members.userId`. The column is identity metadata only.

## Migration behavior

Generate the next Drizzle migration after the current serialized migration chain.

Migration verification applies all migrations to a fresh SQLite database and asserts:

- `members.user_id` is nullable;
- its foreign key uses `ON DELETE SET NULL`;
- the `(group_id, user_id)` unique index exists in the declared order;
- duplicate non-null links in one group are rejected;
- the same account may link to a member in a different group;
- multiple offline members with null links remain valid.

## Automated coverage

Unit and database tests cover the read-model helper, input validation, group scoping, idempotent link/unlink behavior, conflicts, and migration constraints.

Desktop Playwright coverage proves that an owner can:

1. share a group with a registered account;
2. link that account to an existing member;
3. see the saved selection after reload;
4. move or unlink the account;
5. leave another member offline.

Access-control coverage proves a regular member cannot invoke or see owner linking controls. Because the App Access layout is responsive, the final verification also runs the iPhone 14 project.

## Out of scope

- Automatic matching by name or email.
- Creating or deleting members while linking.
- Granting access by linking a member.
- Removing access or pending invitations; those belong to issues #30 and #29.
- Reassigning historical expenses or settlements.
