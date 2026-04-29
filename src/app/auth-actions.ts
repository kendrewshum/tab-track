"use server";

import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";

import { signIn, signOut } from "@/auth";
import { db } from "@/db";
import { groupAccess } from "@/db/schema";
import { getAuthConfigError, isAuthSecretConfigured } from "@/lib/auth-config";
import { hashPassword } from "@/lib/password";
import { requireGroupOwner } from "@/lib/server/session";
import { createUser, findUserByEmail } from "@/lib/server/users";
import { validateSignupInput } from "@/lib/signup";
import { generateId } from "@/lib/utils";

export type AuthFormState = {
  error?: string;
};

export type InviteFormState = {
  error?: string;
  success?: string;
};

export async function loginAction(
  _previousState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  if (!isAuthSecretConfigured({ AUTH_SECRET: process.env.AUTH_SECRET })) {
    return { error: "Authentication is not configured yet. Add AUTH_SECRET in Vercel." };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "That email and password do not match." };
    }

    throw error;
  }

  return {};
}

export async function signupAction(
  _previousState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const configError = getAuthConfigError({
    AUTH_SECRET: process.env.AUTH_SECRET,
    APP_INVITE_CODE: process.env.APP_INVITE_CODE,
  });
  if (configError) {
    return { error: configError };
  }

  const result = validateSignupInput(
    {
      email: String(formData.get("email") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      password: String(formData.get("password") ?? ""),
      inviteCode: String(formData.get("inviteCode") ?? ""),
    },
    process.env.APP_INVITE_CODE
  );

  if (!result.success) {
    return { error: result.message };
  }

  const existingUser = await findUserByEmail(result.data.email);
  if (existingUser) {
    return { error: "An account with that email already exists." };
  }

  const passwordHash = await hashPassword(result.data.password);
  await createUser({
    email: result.data.email,
    displayName: result.data.displayName,
    passwordHash,
  });

  try {
    await signIn("credentials", {
      email: result.data.email,
      password: result.data.password,
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Your account was created, but we could not sign you in." };
    }

    throw error;
  }

  return {};
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}

export async function inviteUserToGroupAction(
  groupId: string,
  _previousState: InviteFormState,
  formData: FormData
): Promise<InviteFormState> {
  await requireGroupOwner(groupId);

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    return { error: "Enter an email address." };
  }

  const user = await db.query.users.findFirst({
    where: (table, { eq }) => eq(table.email, email),
  });

  if (!user) {
    return { error: "That email does not belong to a registered account yet." };
  }

  const existingAccess = await db.query.groupAccess.findFirst({
    where: (table, { and, eq }) => and(eq(table.groupId, groupId), eq(table.userId, user.id)),
  });

  if (existingAccess) {
    return { error: "That user already has access to this group." };
  }

  await db.insert(groupAccess).values({
    id: generateId(),
    groupId,
    userId: user.id,
    role: "member",
  });

  revalidatePath("/");
  revalidatePath(`/groups/${groupId}`);

  return { success: `Shared with ${user.email}.` };
}
