import { and, eq, isNull, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { groupAccess, members } from "@/db/schema";

type AccountMemberLinkResult =
  | { success: true }
  | { success: false; reason: "invalid-target" | "member-claimed" };

type MemberAccountLinkTransaction = {
  findAccess(
    groupId: string,
    accessId: string,
  ): Promise<{ userId: string } | null>;
  findMember(
    groupId: string,
    memberId: string,
  ): Promise<{ id: string } | null>;
  clearUserLink(groupId: string, userId: string): Promise<void>;
  linkMember(
    groupId: string,
    memberId: string,
    userId: string,
  ): Promise<void>;
};

export type MemberAccountLinkStore = {
  transaction<T>(
    callback: (tx: MemberAccountLinkTransaction) => Promise<T>,
  ): Promise<T>;
  isUniqueConflict(error: unknown): boolean;
};

type SetAccountMemberLinkInput = {
  groupId: string;
  accessId: string;
  memberId: string | null;
};

export async function setAccountMemberLink(
  store: MemberAccountLinkStore,
  input: SetAccountMemberLinkInput,
): Promise<AccountMemberLinkResult> {
  try {
    return await store.transaction(async (tx) => {
      const access = await tx.findAccess(input.groupId, input.accessId);
      if (!access) {
        return { success: false, reason: "invalid-target" };
      }

      if (input.memberId !== null) {
        const member = await tx.findMember(input.groupId, input.memberId);
        if (!member) {
          return { success: false, reason: "invalid-target" };
        }
      }

      await tx.clearUserLink(input.groupId, access.userId);
      if (input.memberId !== null) {
        await tx.linkMember(input.groupId, input.memberId, access.userId);
      }

      return { success: true };
    });
  } catch (error) {
    if (store.isUniqueConflict(error)) {
      return { success: false, reason: "member-claimed" };
    }

    throw error;
  }
}

function isMemberLinkUniqueConflict(error: unknown): boolean {
  if (error instanceof MemberClaimedConflict) {
    return true;
  }

  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    !("message" in error)
  ) {
    return false;
  }

  const code = error.code;
  const message = error.message;
  return (
    (code === "SQLITE_CONSTRAINT" || code === "SQLITE_CONSTRAINT_UNIQUE") &&
    typeof message === "string" &&
    /unique constraint failed:\s*members\.group_id,\s*members\.user_id/i.test(
      message,
    )
  );
}

class MemberClaimedConflict extends Error {}

export function createMemberAccountLinkStore<
  TSchema extends Record<string, unknown>,
>(db: LibSQLDatabase<TSchema>): MemberAccountLinkStore {
  return {
    transaction: (callback) =>
      db.transaction(async (tx) =>
        callback({
          async findAccess(groupId, accessId) {
            const [access] = await tx
              .select({ userId: groupAccess.userId })
              .from(groupAccess)
              .where(
                and(
                  eq(groupAccess.groupId, groupId),
                  eq(groupAccess.id, accessId),
                ),
              )
              .limit(1);
            return access ?? null;
          },

          async findMember(groupId, memberId) {
            const [member] = await tx
              .select({ id: members.id })
              .from(members)
              .where(
                and(eq(members.groupId, groupId), eq(members.id, memberId)),
              )
              .limit(1);
            return member ?? null;
          },

          async clearUserLink(groupId, userId) {
            await tx
              .update(members)
              .set({ userId: null })
              .where(
                and(eq(members.groupId, groupId), eq(members.userId, userId)),
              );
          },

          async linkMember(groupId, memberId, userId) {
            const linkedMembers = await tx
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
            if (linkedMembers.length !== 1) {
              throw new MemberClaimedConflict();
            }
          },
        }),
      ),
    isUniqueConflict: isMemberLinkUniqueConflict,
  };
}
