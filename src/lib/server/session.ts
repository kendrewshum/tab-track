import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/db";
import { isAuthSecretConfigured } from "@/lib/auth-config";
import { findAuthorizedGroupAccess, findAuthorizedGroupOwnerAccess } from "@/lib/group-access";
import { findUserByEmail } from "@/lib/server/users";

export type SessionUser = {
  id: string;
  email: string;
  displayName: string | null;
};

export async function getCurrentUser(): Promise<SessionUser | null> {
  if (!isAuthSecretConfigured({ AUTH_SECRET: process.env.AUTH_SECRET })) {
    return null;
  }

  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();

  if (!email) {
    return null;
  }

  let userId = session?.user?.id?.trim() ?? "";
  let displayName = session?.user?.name ?? null;

  if (!userId) {
    const user = await findUserByEmail(email);
    if (!user) {
      return null;
    }

    userId = user.id;
    displayName = displayName ?? user.displayName;
  }

  return {
    id: userId,
    email,
    displayName,
  };
}

export async function requireGuest() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/");
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function requireGroupAccess(groupId: string) {
  const user = await requireUser();
  const access = await findAuthorizedGroupAccess(groupAccessStore, user.id, groupId);

  if (!access) {
    notFound();
  }

  return { user, access };
}

export async function requireGroupOwner(groupId: string) {
  const user = await requireUser();
  const access = await findAuthorizedGroupOwnerAccess(groupAccessStore, user.id, groupId);

  if (!access) {
    notFound();
  }

  return { user, access };
}

const groupAccessStore = {
  async findGroupAccess(userId: string, requestedGroupId: string) {
    return (
      (await db.query.groupAccess.findFirst({
        where: (table, { and, eq: tableEq }) =>
          and(tableEq(table.userId, userId), tableEq(table.groupId, requestedGroupId)),
      })) ?? null
    );
  },
};
