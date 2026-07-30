import { and, eq, isNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { groupAccess, groupInvitations } from "@/db/schema";

export type RevokeGroupAccessResult =
  | { kind: "revoked" }
  | { kind: "owner-protected" }
  | { kind: "not-active" };

export type CancelGroupInvitationResult =
  | { kind: "cancelled" }
  | { kind: "not-active" };

type AccessRole = "owner" | "member";

export type GroupAccessManagementStore = {
  deleteMemberAccess(groupId: string, accessId: string): Promise<boolean>;
  findAccess(
    groupId: string,
    accessId: string,
  ): Promise<{ role: AccessRole } | null>;
  cancelActiveInvitation(input: {
    groupId: string;
    invitationId: string;
    cancelledByUserId: string;
    now: number;
  }): Promise<boolean>;
};

export async function revokeGroupAccess(
  store: GroupAccessManagementStore,
  input: { groupId: string; accessId: string },
): Promise<RevokeGroupAccessResult> {
  const revoked = await store.deleteMemberAccess(
    input.groupId,
    input.accessId,
  );
  if (revoked) {
    return { kind: "revoked" };
  }

  const access = await store.findAccess(input.groupId, input.accessId);
  return access?.role === "owner"
    ? { kind: "owner-protected" }
    : { kind: "not-active" };
}

export async function cancelGroupInvitation(
  store: GroupAccessManagementStore,
  input: {
    groupId: string;
    invitationId: string;
    cancelledByUserId: string;
    now: number;
  },
): Promise<CancelGroupInvitationResult> {
  const cancelled = await store.cancelActiveInvitation(input);
  return cancelled ? { kind: "cancelled" } : { kind: "not-active" };
}

export function createGroupAccessManagementStore<
  TSchema extends Record<string, unknown>,
>(db: LibSQLDatabase<TSchema>): GroupAccessManagementStore {
  return {
    async deleteMemberAccess(groupId, accessId) {
      const deleted = await db
        .delete(groupAccess)
        .where(
          and(
            eq(groupAccess.groupId, groupId),
            eq(groupAccess.id, accessId),
            eq(groupAccess.role, "member"),
          ),
        )
        .returning({ id: groupAccess.id });
      return deleted.length === 1;
    },

    async findAccess(groupId, accessId) {
      const [access] = await db
        .select({ role: groupAccess.role })
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

    async cancelActiveInvitation(input) {
      const cancelled = await db
        .update(groupInvitations)
        .set({
          cancelledAt: input.now,
          cancelledByUserId: input.cancelledByUserId,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(groupInvitations.groupId, input.groupId),
            eq(groupInvitations.id, input.invitationId),
            isNull(groupInvitations.claimedAt),
            isNull(groupInvitations.cancelledAt),
          ),
        )
        .returning({ id: groupInvitations.id });
      return cancelled.length === 1;
    },
  };
}
