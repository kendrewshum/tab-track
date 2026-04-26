import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { groupAccess, groups, users } from "@/db/schema";
import { type LegacyGroupAccessStore, parseLegacyGroupAccessMap, syncLegacyGroupAccessForUser } from "@/lib/legacy-group-access";
import { generateId } from "@/lib/utils";

export type AppUserRecord = typeof users.$inferSelect;

export async function findUserByEmail(email: string): Promise<AppUserRecord | null> {
  const normalizedEmail = email.trim().toLowerCase();

  return (
    (await db.query.users.findFirst({
      where: eq(users.email, normalizedEmail),
    })) ?? null
  );
}

export async function createUser(input: {
  email: string;
  displayName: string;
  passwordHash: string;
}): Promise<AppUserRecord> {
  const user = {
    id: generateId(),
    email: input.email.trim().toLowerCase(),
    displayName: input.displayName.trim(),
    passwordHash: input.passwordHash,
  };

  await db.insert(users).values(user);

  return {
    ...user,
    createdAt: new Date().toISOString(),
  };
}

function buildLegacyGroupAccessStore(): LegacyGroupAccessStore {
  return {
    async findGroupByName(name) {
      return (
        (await db.query.groups.findFirst({
          where: eq(groups.name, name),
        })) ?? null
      );
    },
    async findUserByEmail(email) {
      const user = await findUserByEmail(email);
      return user ? { id: user.id, email: user.email } : null;
    },
    async updateGroupOwner(groupId, userId) {
      await db
        .update(groups)
        .set({ createdByUserId: userId })
        .where(and(eq(groups.id, groupId), isNull(groups.createdByUserId)));
    },
    async ensureGroupAccess(groupId, userId, role) {
      await db
        .insert(groupAccess)
        .values({
          id: generateId(),
          groupId,
          userId,
          role,
        })
        .onConflictDoNothing({
          target: [groupAccess.groupId, groupAccess.userId],
        });
    },
  };
}

export async function syncLegacyGroupAccessForAppUser(user: {
  id: string;
  email: string;
}): Promise<void> {
  const entries = parseLegacyGroupAccessMap(process.env.LEGACY_GROUP_ACCESS_MAP);
  if (entries.length === 0) {
    return;
  }

  await syncLegacyGroupAccessForUser(
    buildLegacyGroupAccessStore(),
    { id: user.id, email: user.email },
    entries
  );
}
