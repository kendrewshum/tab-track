import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/db";
import { isAuthSecretConfigured } from "@/lib/auth-config";
import { findAuthorizedGroupAccess } from "@/lib/group-access";

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
  const userId = session?.user?.id;
  const email = session?.user?.email;

  if (!userId || !email) {
    return null;
  }

  return {
    id: userId,
    email,
    displayName: session.user.name ?? null,
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
  const access = await findAuthorizedGroupAccess(
    {
      async findGroupAccess(userId, requestedGroupId) {
        return (
          (await db.query.groupAccess.findFirst({
            where: (table, { and, eq: tableEq }) =>
              and(tableEq(table.userId, userId), tableEq(table.groupId, requestedGroupId)),
          })) ?? null
        );
      },
    },
    user.id,
    groupId
  );

  if (!access) {
    notFound();
  }

  return { user, access };
}
