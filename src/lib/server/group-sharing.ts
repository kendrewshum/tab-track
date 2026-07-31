import { and, eq, isNull, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { groupAccess, groupInvitations, members, users } from "@/db/schema";
import {
  getGroupInvitationExpiry,
  hashGroupInvitationToken,
} from "@/lib/group-invitation-token";

export type ShareGroupResult =
  | { kind: "access-granted"; email: string; memberLinked: boolean }
  | {
      kind: "invitation-created";
      email: string;
      invitationPath: string;
      expiresAt: number;
    }
  | { kind: "already-shared" }
  | { kind: "invalid-member" };

export type ShareGroupInput = {
  groupId: string;
  email: string;
  memberId: string | null;
  secret: string;
  now: number;
  generateId: () => string;
  generateToken: () => string;
};

type GroupSharingTransaction = {
  findMember(
    groupId: string,
    memberId: string,
  ): Promise<{ id: string; userId: string | null } | null>;
  findUserByEmail(email: string): Promise<{ id: string } | null>;
  findAccess(groupId: string, userId: string): Promise<{ id: string } | null>;
  grantAccess(input: {
    id: string;
    groupId: string;
    userId: string;
  }): Promise<void>;
  linkMember(
    groupId: string,
    memberId: string,
    userId: string,
  ): Promise<boolean>;
  createOrRotateInvitation(input: {
    id: string;
    groupId: string;
    email: string;
    memberId: string | null;
    tokenHash: string;
    expiresAt: number;
    now: number;
  }): Promise<void>;
};

export type GroupSharingStore = {
  transaction<T>(
    callback: (tx: GroupSharingTransaction) => Promise<T>,
  ): Promise<T>;
  isMemberLinkUniqueConflict(error: unknown): boolean;
};

export async function shareGroup(
  store: GroupSharingStore,
  input: ShareGroupInput,
): Promise<ShareGroupResult> {
  const email = input.email.trim().toLowerCase();

  return store.transaction(async (tx) => {
    const member = input.memberId
      ? await tx.findMember(input.groupId, input.memberId)
      : null;
    if (input.memberId !== null && member === null) {
      return { kind: "invalid-member" };
    }

    const user = await tx.findUserByEmail(email);
    if (member !== null && member.userId !== null && member.userId !== user?.id) {
      return { kind: "invalid-member" };
    }

    if (user === null) {
      const rawToken = input.generateToken();
      const expiresAt = getGroupInvitationExpiry(input.now);
      await tx.createOrRotateInvitation({
        id: input.generateId(),
        groupId: input.groupId,
        email,
        memberId: input.memberId,
        tokenHash: hashGroupInvitationToken(rawToken, input.secret),
        expiresAt,
        now: input.now,
      });
      return {
        kind: "invitation-created",
        email,
        invitationPath: `/invite/${rawToken}`,
        expiresAt,
      };
    }

    if (await tx.findAccess(input.groupId, user.id)) {
      return { kind: "already-shared" };
    }

    await tx.grantAccess({
      id: input.generateId(),
      groupId: input.groupId,
      userId: user.id,
    });

    if (member === null) {
      return { kind: "access-granted", email, memberLinked: false };
    }
    if (member.userId === user.id) {
      return { kind: "access-granted", email, memberLinked: true };
    }

    try {
      const memberLinked = await tx.linkMember(input.groupId, member.id, user.id);
      return { kind: "access-granted", email, memberLinked };
    } catch (error) {
      if (store.isMemberLinkUniqueConflict(error)) {
        return { kind: "access-granted", email, memberLinked: false };
      }
      throw error;
    }
  });
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

export function createGroupSharingStore<
  TSchema extends Record<string, unknown>,
>(db: LibSQLDatabase<TSchema>): GroupSharingStore {
  return {
    transaction: (callback) =>
      db.transaction(async (tx) =>
        callback({
          async findMember(groupId, memberId) {
            const [member] = await tx
              .select({ id: members.id, userId: members.userId })
              .from(members)
              .where(
                and(eq(members.groupId, groupId), eq(members.id, memberId)),
              )
              .limit(1);
            return member ?? null;
          },

          async findUserByEmail(email) {
            const [user] = await tx
              .select({ id: users.id })
              .from(users)
              .where(eq(users.email, email))
              .limit(1);
            return user ?? null;
          },

          async findAccess(groupId, userId) {
            const [access] = await tx
              .select({ id: groupAccess.id })
              .from(groupAccess)
              .where(
                and(
                  eq(groupAccess.groupId, groupId),
                  eq(groupAccess.userId, userId),
                ),
              )
              .limit(1);
            return access ?? null;
          },

          async grantAccess(input) {
            await tx.insert(groupAccess).values({
              id: input.id,
              groupId: input.groupId,
              userId: input.userId,
              role: "member",
            });
          },

          async linkMember(groupId, memberId, userId) {
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

          async createOrRotateInvitation(input) {
            await tx
              .insert(groupInvitations)
              .values({
                id: input.id,
                groupId: input.groupId,
                email: input.email,
                role: "member",
                memberId: input.memberId,
                tokenHash: input.tokenHash,
                expiresAt: input.expiresAt,
                claimedAt: null,
                claimedByUserId: null,
                cancelledAt: null,
                createdAt: input.now,
                updatedAt: input.now,
              })
              .onConflictDoUpdate({
                target: [groupInvitations.groupId, groupInvitations.email],
                set: {
                  memberId: input.memberId,
                  tokenHash: input.tokenHash,
                  expiresAt: input.expiresAt,
                  claimedAt: null,
                  claimedByUserId: null,
                  cancelledAt: null,
                  cancelledByUserId: null,
                  updatedAt: input.now,
                },
              });
          },
        }),
      ),
    isMemberLinkUniqueConflict,
  };
}
