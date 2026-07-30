import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { groupAccess, groupInvitations, members } from "@/db/schema";
import { hashGroupInvitationToken } from "@/lib/group-invitation-token";
import { generateId } from "@/lib/utils";

export const GROUP_INVITATION_CLAIM_MAX_ATTEMPTS = 10;
const GROUP_INVITATION_CLAIM_MAX_RETRY_DELAY_MS = 20;

export type InvitationInspection =
  | { kind: "active"; expiresAt: number }
  | { kind: "unavailable" };

export type InvitationClaimResult =
  | { kind: "claimed"; groupId: string }
  | { kind: "account-mismatch" }
  | { kind: "unavailable" };

type ActiveInvitation = {
  id: string;
  groupId: string;
  email: string;
  memberId: string | null;
  expiresAt: number;
};

export type GroupInvitationClaimTransaction = {
  findActiveInvitation(
    tokenHash: string,
    now: number,
  ): Promise<ActiveInvitation | null>;
  markClaimed(input: {
    invitationId: string;
    tokenHash: string;
    userId: string;
    now: number;
  }): Promise<boolean>;
  grantAccess(groupId: string, userId: string): Promise<void>;
  linkMember(
    groupId: string,
    memberId: string,
    userId: string,
  ): Promise<boolean>;
};

export type GroupInvitationClaimStore = {
  findActiveInvitation(
    tokenHash: string,
    now: number,
  ): Promise<ActiveInvitation | null>;
  transaction<T>(
    callback: (tx: GroupInvitationClaimTransaction) => Promise<T>,
  ): Promise<T>;
  isMemberLinkUniqueConflict(error: unknown): boolean;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function inspectGroupInvitation(
  store: GroupInvitationClaimStore,
  input: { rawToken: string; secret: string; now: number },
): Promise<InvitationInspection> {
  const invitation = await store.findActiveInvitation(
    hashGroupInvitationToken(input.rawToken, input.secret),
    input.now,
  );
  return invitation === null
    ? { kind: "unavailable" }
    : { kind: "active", expiresAt: invitation.expiresAt };
}

export async function isInvitationAuthorizedForSignup(
  store: GroupInvitationClaimStore,
  input: {
    rawToken: string;
    secret: string;
    email: string;
    now: number;
  },
): Promise<boolean> {
  const invitation = await store.findActiveInvitation(
    hashGroupInvitationToken(input.rawToken, input.secret),
    input.now,
  );
  return (
    invitation !== null &&
    normalizeEmail(invitation.email) === normalizeEmail(input.email)
  );
}

export async function claimGroupInvitation(
  store: GroupInvitationClaimStore,
  input: {
    rawToken: string;
    secret: string;
    user: { id: string; email: string };
    now: number;
  },
): Promise<InvitationClaimResult> {
  const tokenHash = hashGroupInvitationToken(input.rawToken, input.secret);

  const runClaimTransaction = () =>
    store.transaction(async (tx): Promise<InvitationClaimResult> => {
      const invitation = await tx.findActiveInvitation(tokenHash, input.now);
      if (invitation === null) {
        return { kind: "unavailable" };
      }
      if (
        normalizeEmail(invitation.email) !== normalizeEmail(input.user.email)
      ) {
        return { kind: "account-mismatch" };
      }

      const claimed = await tx.markClaimed({
        invitationId: invitation.id,
        tokenHash,
        userId: input.user.id,
        now: input.now,
      });
      if (!claimed) {
        return { kind: "unavailable" };
      }

      await tx.grantAccess(invitation.groupId, input.user.id);

      if (invitation.memberId !== null) {
        try {
          await tx.linkMember(
            invitation.groupId,
            invitation.memberId,
            input.user.id,
          );
        } catch (error) {
          if (!store.isMemberLinkUniqueConflict(error)) {
            throw error;
          }
        }
      }

      return { kind: "claimed", groupId: invitation.groupId };
    });

  // SQLITE_BUSY rejects and rolls back the whole write transaction. Retrying
  // re-enters the same guarded claim flow; partial claim/access writes never carry over.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await runClaimTransaction();
    } catch (error) {
      if (
        !isDatabaseBusy(error) ||
        attempt + 1 === GROUP_INVITATION_CLAIM_MAX_ATTEMPTS
      ) {
        throw error;
      }
      await waitForTransactionRetry(attempt);
    }
  }
}

async function selectActiveInvitation(
  db: Pick<LibSQLDatabase<Record<string, unknown>>, "select">,
  tokenHash: string,
  now: number,
): Promise<ActiveInvitation | null> {
  const [invitation] = await db
    .select({
      id: groupInvitations.id,
      groupId: groupInvitations.groupId,
      email: groupInvitations.email,
      memberId: groupInvitations.memberId,
      expiresAt: groupInvitations.expiresAt,
    })
    .from(groupInvitations)
    .where(
      and(
        eq(groupInvitations.tokenHash, tokenHash),
        isNull(groupInvitations.claimedAt),
        isNull(groupInvitations.cancelledAt),
        gt(groupInvitations.expiresAt, now),
      ),
    )
    .limit(1);
  return invitation ?? null;
}

function isMemberLinkUniqueConflict(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    !("message" in error)
  ) {
    return false;
  }

  if (
    (error.code !== "SQLITE_CONSTRAINT" &&
      error.code !== "SQLITE_CONSTRAINT_UNIQUE") ||
    typeof error.message !== "string"
  ) {
    return false;
  }

  const canonicalMessage =
    "unique constraint failed: members.group_id, members.user_id";
  const codePrefixes = ["SQLITE_CONSTRAINT:", "SQLITE_CONSTRAINT_UNIQUE:"];
  let message = error.message.trim();
  const codePrefix = codePrefixes.find((prefix) =>
    message.toLowerCase().startsWith(prefix.toLowerCase()),
  );
  if (codePrefix) {
    message = message.slice(codePrefix.length).trimStart();
  }

  const sqliteErrorPrefix = "SQLite error:";
  if (message.toLowerCase().startsWith(sqliteErrorPrefix.toLowerCase())) {
    message = message.slice(sqliteErrorPrefix.length).trimStart();
  }

  return message.trim().toLowerCase() === canonicalMessage;
}

function isDatabaseBusy(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "SQLITE_BUSY"
  );
}

function waitForTransactionRetry(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(
      resolve,
      Math.min(2 ** attempt, GROUP_INVITATION_CLAIM_MAX_RETRY_DELAY_MS),
    );
  });
}

export function createGroupInvitationClaimStore<
  TSchema extends Record<string, unknown>,
>(db: LibSQLDatabase<TSchema>): GroupInvitationClaimStore {
  return {
    findActiveInvitation: (tokenHash, now) =>
      selectActiveInvitation(db, tokenHash, now),
    transaction: (callback) =>
      db.transaction(async (tx) =>
        callback({
          findActiveInvitation: (tokenHash, now) =>
            selectActiveInvitation(tx, tokenHash, now),

          async markClaimed(input) {
            const claimed = await tx
              .update(groupInvitations)
              .set({
                claimedAt: input.now,
                claimedByUserId: input.userId,
                updatedAt: input.now,
              })
              .where(
                and(
                  eq(groupInvitations.id, input.invitationId),
                  eq(groupInvitations.tokenHash, input.tokenHash),
                  isNull(groupInvitations.claimedAt),
                  isNull(groupInvitations.cancelledAt),
                  gt(groupInvitations.expiresAt, input.now),
                ),
              )
              .returning({ id: groupInvitations.id });
            return claimed.length === 1;
          },

          async grantAccess(groupId, userId) {
            await tx
              .insert(groupAccess)
              .values({
                id: generateId(),
                groupId,
                userId,
                role: "member",
              })
              .onConflictDoNothing({
                target: [groupAccess.groupId, groupAccess.userId],
              });
          },

          async linkMember(groupId, memberId, userId) {
            const [existingLink] = await tx
              .select({ id: members.id })
              .from(members)
              .where(
                and(
                  eq(members.groupId, groupId),
                  eq(members.userId, userId),
                ),
              )
              .limit(1);
            if (existingLink && existingLink.id !== memberId) {
              return false;
            }

            const linked = await tx
              .update(members)
              .set({ userId })
              .where(
                and(
                  eq(members.groupId, groupId),
                  eq(members.id, memberId),
                  or(isNull(members.userId), eq(members.userId, userId)),
                ),
              )
              .returning({ id: members.id });
            return linked.length === 1;
          },
        }),
      ),
    isMemberLinkUniqueConflict,
  };
}
