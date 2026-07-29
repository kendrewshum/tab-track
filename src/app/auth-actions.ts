"use server";

import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";

import { signIn, signOut } from "@/auth";
import { db } from "@/db";
import { groupAccess } from "@/db/schema";
import { getAuthConfigError, isAuthSecretConfigured } from "@/lib/auth-config";
import { parseMemberAccountLinkForm } from "@/lib/member-account-link-form";
import { hashPassword } from "@/lib/password";
import { createAuthAttemptStore } from "@/lib/server/auth-attempt-store";
import { createAuthRateLimiter } from "@/lib/server/auth-rate-limit";
import { getTrustedRequestSource } from "@/lib/server/auth-request-source";
import {
  createMemberAccountLinkStore,
  setAccountMemberLink,
} from "@/lib/server/member-account-links";
import { requireGroupOwner } from "@/lib/server/session";
import { createSignupAccountAttempt } from "@/lib/server/signup-account";
import { createUser, findUserByEmail } from "@/lib/server/users";
import { generateId } from "@/lib/utils";

export type AuthFormState = {
  error?: string;
};

export type InviteFormState = {
  error?: string;
  success?: string;
};

export type MemberAccountLinkFormState = {
  error?: string;
  success?: string;
};

const LOGIN_UNAVAILABLE_MESSAGE =
  "That email and password do not match, or too many attempts were made. Try again later.";

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
      return { error: LOGIN_UNAVAILABLE_MESSAGE };
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

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return { error: "Authentication is not configured yet. Add AUTH_SECRET in Vercel." };
  }

  const result = await createSignupAccountAttempt(
    {
      email: String(formData.get("email") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      password: String(formData.get("password") ?? ""),
      inviteCode: String(formData.get("inviteCode") ?? ""),
      expectedInviteCode: process.env.APP_INVITE_CODE,
      source: await getTrustedRequestSource(),
    },
    {
      limiter: createAuthRateLimiter({
        store: createAuthAttemptStore(db),
        secret,
      }),
      findUserByEmail,
      hashPassword,
      createUser,
    },
  );

  if (!result.success) {
    return { error: result.message };
  }

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

export async function setMemberAccountLinkAction(
  groupId: string,
  _previousState: MemberAccountLinkFormState,
  formData: FormData
): Promise<MemberAccountLinkFormState> {
  await requireGroupOwner(groupId);

  const parsed = parseMemberAccountLinkForm(formData);
  if (!parsed.success) {
    return { error: "Choose a valid ledger member." };
  }

  const result = await setAccountMemberLink(createMemberAccountLinkStore(db), {
    groupId,
    ...parsed.data,
  });

  if (!result.success) {
    if (result.reason === "member-claimed") {
      return {
        error: "That ledger member is already linked to another account.",
      };
    }

    return { error: "We could not update that account link." };
  }

  revalidatePath(`/groups/${groupId}`);
  return { success: "Ledger member updated." };
}
