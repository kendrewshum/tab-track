"use server";

import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";

import { signIn, signOut } from "@/auth";
import { db } from "@/db";
import { getAuthConfigError, isAuthSecretConfigured } from "@/lib/auth-config";
import { parseGroupInvitationForm } from "@/lib/group-invitation-form";
import { generateGroupInvitationToken } from "@/lib/group-invitation-token";
import { parseMemberAccountLinkForm } from "@/lib/member-account-link-form";
import { hashPassword } from "@/lib/password";
import { createAuthAttemptStore } from "@/lib/server/auth-attempt-store";
import { createAuthRateLimiter } from "@/lib/server/auth-rate-limit";
import { getTrustedRequestSource } from "@/lib/server/auth-request-source";
import {
  createGroupSharingStore,
  shareGroup,
} from "@/lib/server/group-sharing";
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
  invitationPath?: string;
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

  const parsed = parseGroupInvitationForm(formData);
  if (!parsed.success) {
    return { error: "Enter a valid email address and ledger member." };
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return { error: "Authentication is not configured yet. Add AUTH_SECRET in Vercel." };
  }

  const result = await shareGroup(createGroupSharingStore(db), {
    groupId,
    ...parsed.data,
    secret,
    now: Date.now(),
    generateId,
    generateToken: generateGroupInvitationToken,
  });

  if (result.kind === "invalid-member") {
    return { error: "Choose a valid ledger member." };
  }

  if (result.kind === "already-shared") {
    return { error: "That user already has access to this group." };
  }

  revalidatePath("/");
  revalidatePath(`/groups/${groupId}`);

  if (result.kind === "invitation-created") {
    return {
      success: `Invitation created for ${result.email}.`,
      invitationPath: result.invitationPath,
    };
  }

  if (!result.memberLinked && parsed.data.memberId !== null) {
    return {
      success:
        `Shared with ${result.email}. ` +
        "Access was granted, but no ledger member was linked.",
    };
  }

  return { success: `Shared with ${result.email}.` };
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
