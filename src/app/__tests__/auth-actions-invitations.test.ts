import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as React from "react";
import { AuthError } from "next-auth";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  createAuthAttemptStore: vi.fn(),
  createAuthRateLimiter: vi.fn(),
  createGroupInvitationClaimStore: vi.fn(),
  createGroupSharingStore: vi.fn(),
  createUser: vi.fn(),
  findUserByEmail: vi.fn(),
  generateGroupInvitationToken: vi.fn(),
  generateId: vi.fn(),
  getCurrentUser: vi.fn(),
  getTrustedRequestSource: vi.fn(),
  hashPassword: vi.fn(),
  isInvitationAuthorizedForSignup: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  requireGroupOwner: vi.fn(),
  shareGroup: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  useActionState: vi.fn(),
  useEffect: vi.fn(),
  useId: vi.fn(),
  useState: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return {
    ...original,
    useActionState: mocks.useActionState,
    useEffect: mocks.useEffect,
    useId: mocks.useId,
    useState: mocks.useState,
  };
});
vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {},
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));
vi.mock("@/auth", () => ({
  signIn: mocks.signIn,
  signOut: mocks.signOut,
}));
vi.mock("@/db", () => ({
  db: { mocked: "db" },
}));
vi.mock("@/lib/password", () => ({
  hashPassword: mocks.hashPassword,
}));
vi.mock("@/lib/group-invitation-token", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/group-invitation-token")>();
  return {
    ...original,
    generateGroupInvitationToken: mocks.generateGroupInvitationToken,
  };
});
vi.mock("@/lib/server/group-sharing", () => ({
  createGroupSharingStore: mocks.createGroupSharingStore,
  shareGroup: mocks.shareGroup,
}));
vi.mock("@/lib/server/auth-attempt-store", () => ({
  createAuthAttemptStore: mocks.createAuthAttemptStore,
}));
vi.mock("@/lib/server/auth-rate-limit", () => ({
  createAuthRateLimiter: mocks.createAuthRateLimiter,
}));
vi.mock("@/lib/server/auth-request-source", () => ({
  getTrustedRequestSource: mocks.getTrustedRequestSource,
}));
vi.mock("@/lib/server/group-invitation-claims", () => ({
  createGroupInvitationClaimStore: mocks.createGroupInvitationClaimStore,
  isInvitationAuthorizedForSignup: mocks.isInvitationAuthorizedForSignup,
}));
vi.mock("@/lib/server/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
  requireGroupOwner: mocks.requireGroupOwner,
}));
vi.mock("@/lib/server/users", () => ({
  createUser: mocks.createUser,
  findUserByEmail: mocks.findUserByEmail,
}));
vi.mock("@/lib/utils", () => ({
  generateId: mocks.generateId,
}));

import {
  inviteUserToGroupAction,
  loginAction,
  signupAction,
} from "@/app/auth-actions";
import { InviteUserForm } from "@/app/groups/[id]/invite-user-form";
import { LoginForm } from "@/app/login/login-form";
import LoginPage from "@/app/login/page";
import { SignupForm } from "@/app/signup/signup-form";
import SignupPage from "@/app/signup/page";
import { GROUP_INVITATION_COOKIE_NAME } from "@/lib/server/group-invitation-cookie";

type ElementLike = {
  type?: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

function collectElements(node: unknown): ElementLike[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectElements);
  }
  if (
    typeof node !== "object" ||
    node === null ||
    !("props" in node) ||
    typeof node.props !== "object" ||
    node.props === null
  ) {
    return [];
  }

  const element = node as ElementLike;
  return [element, ...collectElements(element.props.children)];
}

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textContent).join("");
  }
  if (
    typeof node === "object" &&
    node !== null &&
    "props" in node &&
    typeof node.props === "object" &&
    node.props !== null &&
    "children" in node.props
  ) {
    return textContent(node.props.children);
  }
  return "";
}

function invitationForm(email = "friend@example.com", memberId?: string) {
  const formData = new FormData();
  formData.set("email", email);
  if (memberId !== undefined) {
    formData.set("memberId", memberId);
  }
  return formData;
}

describe("inviteUserToGroupAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_SECRET", "test-auth-secret");
    vi.spyOn(Date, "now").mockReturnValue(1_725_000_000_000);
    mocks.createGroupSharingStore.mockReturnValue("sharing-store");
    mocks.generateGroupInvitationToken.mockReturnValue("raw-token");
    mocks.generateId.mockReturnValue("generated-id");
    mocks.requireGroupOwner.mockResolvedValue({ access: { role: "owner" } });
    mocks.shareGroup.mockResolvedValue({
      kind: "access-granted",
      email: "friend@example.com",
      memberLinked: true,
    });
    mocks.useActionState.mockReturnValue([{}, vi.fn(), false]);
    mocks.useEffect.mockImplementation(() => undefined);
    mocks.useId.mockReturnValue("invite-form");
    mocks.useState.mockReturnValue([false, vi.fn()]);
    vi.stubGlobal("React", React);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.mocked(Date.now).mockRestore();
  });

  test("propagates an owner authorization rejection before sharing", async () => {
    const rejection = new Error("not found");
    mocks.requireGroupOwner.mockRejectedValue(rejection);

    await expect(
      inviteUserToGroupAction(
        "group-1",
        {},
        invitationForm("friend@example.com", "member-1"),
      ),
    ).rejects.toBe(rejection);

    expect(mocks.requireGroupOwner).toHaveBeenCalledWith("group-1");
    expect(mocks.createGroupSharingStore).not.toHaveBeenCalled();
    expect(mocks.shareGroup).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  test("rejects malformed invitation data without sharing or revalidating", async () => {
    await expect(
      inviteUserToGroupAction("group-1", {}, invitationForm("not-an-email")),
    ).resolves.toEqual({
      error: "Enter a valid email address and ledger member.",
    });

    expect(mocks.requireGroupOwner).toHaveBeenCalledWith("group-1");
    expect(mocks.createGroupSharingStore).not.toHaveBeenCalled();
    expect(mocks.shareGroup).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  test("returns a sanitized configuration error before generating or sharing", async () => {
    vi.stubEnv("AUTH_SECRET", "");

    await expect(
      inviteUserToGroupAction(
        "group-1",
        {},
        invitationForm("friend@example.com", "member-1"),
      ),
    ).resolves.toEqual({
      error: "Authentication is not configured yet. Add AUTH_SECRET in Vercel.",
    });

    expect(mocks.generateId).not.toHaveBeenCalled();
    expect(mocks.generateGroupInvitationToken).not.toHaveBeenCalled();
    expect(mocks.createGroupSharingStore).not.toHaveBeenCalled();
    expect(mocks.shareGroup).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  test("passes the group, normalized form data, secret, clock, and generators to sharing", async () => {
    await inviteUserToGroupAction(
      "group-1",
      {},
      invitationForm("  Friend.Name@Example.COM  ", "  member-1  "),
    );

    expect(mocks.createGroupSharingStore).toHaveBeenCalledWith({
      mocked: "db",
    });
    expect(mocks.shareGroup).toHaveBeenCalledWith("sharing-store", {
      groupId: "group-1",
      email: "friend.name@example.com",
      memberId: "member-1",
      secret: "test-auth-secret",
      now: 1_725_000_000_000,
      generateId: mocks.generateId,
      generateToken: mocks.generateGroupInvitationToken,
    });
    expect(mocks.requireGroupOwner.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.shareGroup.mock.invocationCallOrder[0],
    );
  });

  test("maps an invalid member without revalidating", async () => {
    mocks.shareGroup.mockResolvedValue({ kind: "invalid-member" });

    await expect(
      inviteUserToGroupAction(
        "group-1",
        {},
        invitationForm("friend@example.com", "member-1"),
      ),
    ).resolves.toEqual({ error: "Choose a valid ledger member." });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  test("maps already-shared without revalidating", async () => {
    mocks.shareGroup.mockResolvedValue({ kind: "already-shared" });

    await expect(
      inviteUserToGroupAction("group-1", {}, invitationForm()),
    ).resolves.toEqual({
      error: "That user already has access to this group.",
    });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  test("maps linked access and revalidates both group lists", async () => {
    await expect(
      inviteUserToGroupAction(
        "group-1",
        {},
        invitationForm("friend@example.com", "member-1"),
      ),
    ).resolves.toEqual({ success: "Shared with friend@example.com." });

    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/"],
      ["/groups/group-1"],
    ]);
  });

  test("maps unlinked access without a selected member as ordinary success", async () => {
    mocks.shareGroup.mockResolvedValue({
      kind: "access-granted",
      email: "friend@example.com",
      memberLinked: false,
    });

    await expect(
      inviteUserToGroupAction("group-1", {}, invitationForm()),
    ).resolves.toEqual({ success: "Shared with friend@example.com." });

    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
  });

  test("includes a nonfatal warning when access succeeds but the selected member is not linked", async () => {
    mocks.shareGroup.mockResolvedValue({
      kind: "access-granted",
      email: "friend@example.com",
      memberLinked: false,
    });

    await expect(
      inviteUserToGroupAction(
        "group-1",
        {},
        invitationForm("friend@example.com", "member-1"),
      ),
    ).resolves.toEqual({
      success:
        "Shared with friend@example.com. Access was granted, but no ledger member was linked.",
    });

    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
  });

  test("returns a one-time raw invitation path without exposing a hash", async () => {
    mocks.shareGroup.mockResolvedValue({
      kind: "invitation-created",
      email: "new@example.com",
      invitationPath: "/invite/raw-secret-token",
      expiresAt: 1_725_604_800_000,
    });

    const result = await inviteUserToGroupAction(
      "group-1",
      {},
      invitationForm("new@example.com", "member-1"),
    );

    expect(result).toEqual({
      success: "Invitation created for new@example.com.",
      invitationPath: "/invite/raw-secret-token",
    });
    expect(result).not.toHaveProperty("tokenHash");
    expect(result).not.toHaveProperty("hash");
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/"],
      ["/groups/group-1"],
    ]);
  });

  test("does not let previous state inject invitation output", async () => {
    mocks.shareGroup.mockResolvedValue({ kind: "already-shared" });

    await expect(
      inviteUserToGroupAction(
        "group-1",
        {
          error: "injected error",
          success: "injected success",
          invitationPath: "/invite/injected-token",
        },
        invitationForm(),
      ),
    ).resolves.toEqual({
      error: "That user already has access to this group.",
    });
  });
});

function credentialsForm(
  email = "friend@example.com",
  password = "password123",
) {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("password", password);
  return formData;
}

function signupForm(inviteCode = "") {
  const formData = credentialsForm();
  formData.set("displayName", "Friend");
  formData.set("inviteCode", inviteCode);
  return formData;
}

function requestCookieStore(rawToken?: string) {
  return {
    get: vi.fn((name: string) =>
      name === GROUP_INVITATION_COOKIE_NAME && rawToken
        ? { value: rawToken }
        : undefined,
    ),
    delete: vi.fn(),
  };
}

describe("invitation-aware authentication actions", () => {
  const rawToken = "raw-cookie-invitation-token";
  const reservation = { buckets: [] };
  let cookieStore: ReturnType<typeof requestCookieStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_SECRET", "test-auth-secret");
    vi.stubEnv("APP_INVITE_CODE", "app-invite");
    vi.spyOn(Date, "now").mockReturnValue(1_725_000_000_000);

    cookieStore = requestCookieStore();
    mocks.cookies.mockResolvedValue(cookieStore);
    mocks.createAuthAttemptStore.mockReturnValue("attempt-store");
    mocks.createAuthRateLimiter.mockReturnValue({
      reserve: vi.fn().mockResolvedValue({
        allowed: true,
        reservation,
      }),
      succeed: vi.fn().mockResolvedValue(undefined),
    });
    mocks.createGroupInvitationClaimStore.mockReturnValue("claim-store");
    mocks.createUser.mockResolvedValue(undefined);
    mocks.findUserByEmail.mockResolvedValue(null);
    mocks.getTrustedRequestSource.mockResolvedValue("203.0.113.10");
    mocks.hashPassword.mockResolvedValue("password-hash");
    mocks.isInvitationAuthorizedForSignup.mockResolvedValue(false);
    mocks.signIn.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(Date.now).mockRestore();
  });

  test("redirects a successful invited login through a browser-loadable claim continuation without forwarding the token", async () => {
    cookieStore = requestCookieStore(rawToken);
    mocks.cookies.mockResolvedValue(cookieStore);
    const formData = credentialsForm();

    await expect(loginAction({}, formData)).resolves.toEqual({});

    expect(cookieStore.get).toHaveBeenCalledWith(
      GROUP_INVITATION_COOKIE_NAME,
    );
    expect(mocks.signIn).toHaveBeenCalledWith("credentials", {
      email: "friend@example.com",
      password: "password123",
      redirectTo: "/invite/continue",
    });
    expect(JSON.stringify(mocks.signIn.mock.calls)).not.toContain(rawToken);
    expect([...formData.values()]).not.toContain(rawToken);
  });

  test("keeps the ordinary login redirect when no invitation cookie exists", async () => {
    await expect(
      loginAction({}, credentialsForm()),
    ).resolves.toEqual({});

    expect(mocks.signIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ redirectTo: "/" }),
    );
  });

  test("keeps missing authentication configuration sanitized", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    await expect(
      loginAction({}, credentialsForm()),
    ).resolves.toEqual({
      error: "Authentication is not configured yet. Add AUTH_SECRET in Vercel.",
    });
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  test("keeps malformed login credentials sanitized", async () => {
    await expect(
      loginAction({}, credentialsForm("", "")),
    ).resolves.toEqual({
      error: "Enter your email and password.",
    });
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  test("keeps login AuthError details sanitized", async () => {
    cookieStore = requestCookieStore(rawToken);
    mocks.cookies.mockResolvedValue(cookieStore);
    mocks.signIn.mockRejectedValue(new AuthError());
    await expect(
      loginAction({}, credentialsForm()),
    ).resolves.toEqual({
      error:
        "That email and password do not match, or too many attempts were made. Try again later.",
    });
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  test("creates an account with a matching group invitation when the app code is unset", async () => {
    vi.stubEnv("APP_INVITE_CODE", "");
    cookieStore = requestCookieStore(rawToken);
    mocks.cookies.mockResolvedValue(cookieStore);
    mocks.isInvitationAuthorizedForSignup.mockResolvedValue(true);

    await expect(signupAction({}, signupForm())).resolves.toEqual({});

    expect(mocks.isInvitationAuthorizedForSignup).toHaveBeenCalledWith(
      "claim-store",
      {
        rawToken,
        secret: "test-auth-secret",
        email: "friend@example.com",
        now: 1_725_000_000_000,
      },
    );
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: "friend@example.com",
      displayName: "Friend",
      passwordHash: "password-hash",
    });
    expect(mocks.signIn).toHaveBeenCalledWith("credentials", {
      email: "friend@example.com",
      password: "password123",
      redirectTo: "/invite/continue",
    });
    expect(cookieStore.delete).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.signIn.mock.calls)).not.toContain(rawToken);
  });

  test.each([
    ["mismatched, expired, or claimed", false],
    ["authorization failure", new Error("invitation database details")],
  ])("does not bypass signup for %s invitations", async (_label, outcome) => {
    vi.stubEnv("APP_INVITE_CODE", "");
    cookieStore = requestCookieStore(rawToken);
    mocks.cookies.mockResolvedValue(cookieStore);
    if (outcome instanceof Error) {
      mocks.isInvitationAuthorizedForSignup.mockRejectedValue(outcome);
    } else {
      mocks.isInvitationAuthorizedForSignup.mockResolvedValue(outcome);
    }

    await expect(signupAction({}, signupForm())).resolves.toEqual({
      error: "That invite code is not valid.",
    });

    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  test("still requires the ordinary app invite code without an invitation cookie", async () => {
    await expect(signupAction({}, signupForm("wrong"))).resolves.toEqual({
      error: "That invite code is not valid.",
    });

    expect(mocks.isInvitationAuthorizedForSignup).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();

    await expect(
      signupAction({}, signupForm("app-invite")),
    ).resolves.toEqual({});
    expect(mocks.createUser).toHaveBeenCalledTimes(1);
    expect(mocks.signIn).toHaveBeenLastCalledWith(
      "credentials",
      expect.objectContaining({ redirectTo: "/" }),
    );
  });

  test("accepts the app invite code when a stale group invitation is unauthorized", async () => {
    cookieStore = requestCookieStore(rawToken);
    mocks.cookies.mockResolvedValue(cookieStore);
    mocks.isInvitationAuthorizedForSignup.mockResolvedValue(false);

    await expect(
      signupAction({}, signupForm("app-invite")),
    ).resolves.toEqual({});

    expect(mocks.isInvitationAuthorizedForSignup).toHaveBeenCalledTimes(1);
    expect(mocks.createUser).toHaveBeenCalledTimes(1);
    expect(mocks.signIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ redirectTo: "/invite/claim" }),
    );
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  test("keeps signup unavailable when neither invitation path is configured", async () => {
    vi.stubEnv("APP_INVITE_CODE", "");

    await expect(signupAction({}, signupForm())).resolves.toEqual({
      error: "Signup is not configured yet. Add APP_INVITE_CODE in Vercel.",
    });

    expect(mocks.isInvitationAuthorizedForSignup).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  test("preserves the invitation cookie and sanitizes automatic sign-in failure", async () => {
    cookieStore = requestCookieStore(rawToken);
    mocks.cookies.mockResolvedValue(cookieStore);
    mocks.isInvitationAuthorizedForSignup.mockResolvedValue(true);
    mocks.signIn.mockRejectedValue(new AuthError());

    await expect(signupAction({}, signupForm())).resolves.toEqual({
      error: "Your account was created, but we could not sign you in.",
    });

    expect(mocks.createUser).toHaveBeenCalledTimes(1);
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });
});

describe("invitation-aware authentication pages", () => {
  const rawToken = "never-render-this-invitation-token";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.cookies.mockResolvedValue(requestCookieStore());
    mocks.useActionState.mockReturnValue([{}, vi.fn(), false]);
    mocks.useState.mockReturnValue([false, vi.fn()]);
    vi.stubGlobal("React", React);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test.each([
    [
      "login",
      LoginPage,
      LoginForm,
      "Sign in to accept your group invitation.",
      "/signup",
    ],
    [
      "signup",
      SignupPage,
      SignupForm,
      "Create an account to accept your group invitation.",
      "/login",
    ],
  ])(
    "passes only cookie presence to the %s form and renders an accessible banner",
    async (_label, Page, Form, banner, accountLink) => {
      const cookieStore = requestCookieStore(rawToken);
      mocks.cookies.mockResolvedValue(cookieStore);

      const page = await Page();
      const formElement = collectElements(page).find(
        (element) => element.type === Form,
      );
      const form = Form({
        hasGroupInvitation: true,
      } as Parameters<typeof Form>[0]);
      const status = collectElements(form).find(
        (element) => element.props.role === "status",
      );

      expect(cookieStore.get).toHaveBeenCalledWith(
        GROUP_INVITATION_COOKIE_NAME,
      );
      expect(formElement?.props).toEqual({ hasGroupInvitation: true });
      expect(textContent(status)).toBe(banner);
      expect(textContent(form)).not.toContain(rawToken);
      expect(
        collectElements(form).find(
          (element) => element.props.href === accountLink,
        ),
      ).toBeDefined();
    },
  );

  test("shows the invite code only for ordinary signup", () => {
    mocks.useActionState.mockReturnValue([{}, vi.fn(), false]);

    const ordinaryForm = SignupForm({
      hasGroupInvitation: false,
    } as Parameters<typeof SignupForm>[0]);
    const invitedForm = SignupForm({
      hasGroupInvitation: true,
    } as Parameters<typeof SignupForm>[0]);

    expect(
      collectElements(ordinaryForm).some(
        (element) => element.props.name === "inviteCode",
      ),
    ).toBe(true);
    expect(
      collectElements(invitedForm).some(
        (element) => element.props.name === "inviteCode",
      ),
    ).toBe(false);
  });

  test("reveals an accessible app invite-code fallback without exposing the token", () => {
    const setUseAppInviteCode = vi.fn();
    mocks.useState.mockReturnValue([false, setUseAppInviteCode]);

    const initialForm = SignupForm({
      hasGroupInvitation: true,
    } as Parameters<typeof SignupForm>[0]);
    const toggle = collectElements(initialForm).find(
      (element) =>
        element.props.type === "button" &&
        textContent(element.props.children) === "Use app invite code instead",
    );

    expect(toggle?.props).toEqual(
      expect.objectContaining({
        "aria-controls": "signup-invite-code",
        "aria-expanded": false,
      }),
    );
    expect(
      collectElements(initialForm).some(
        (element) => element.props.name === "inviteCode",
      ),
    ).toBe(false);

    (toggle?.props.onClick as (() => void) | undefined)?.();
    expect(setUseAppInviteCode).toHaveBeenCalledWith(true);

    mocks.useState.mockReturnValue([true, setUseAppInviteCode]);
    const revealedForm = SignupForm({
      hasGroupInvitation: true,
    } as Parameters<typeof SignupForm>[0]);
    const inviteCode = collectElements(revealedForm).find(
      (element) => element.props.name === "inviteCode",
    );
    const status = collectElements(revealedForm).find(
      (element) => element.props.role === "status",
    );

    expect(inviteCode?.props).toEqual(
      expect.objectContaining({
        id: "signup-invite-code",
        required: true,
      }),
    );
    expect(textContent(status)).toContain(
      "Use your app invite code to create your account.",
    );
    expect(textContent(revealedForm)).not.toContain(rawToken);
  });

  test("associates auth labels with stable autocomplete-enabled inputs", () => {
    const forms = [
      {
        tree: LoginForm({ hasGroupInvitation: false }),
        fields: [
          ["email", "login-email", "email"],
          ["password", "login-password", "current-password"],
        ],
      },
      {
        tree: SignupForm({ hasGroupInvitation: false }),
        fields: [
          ["displayName", "signup-display-name", "name"],
          ["email", "signup-email", "email"],
          ["password", "signup-password", "new-password"],
          ["inviteCode", "signup-invite-code", "off"],
        ],
      },
    ] as const;

    for (const { tree, fields } of forms) {
      const elements = collectElements(tree);
      for (const [name, id, autoComplete] of fields) {
        expect(
          elements.find((element) => element.props.name === name)?.props,
        ).toEqual(expect.objectContaining({ id, autoComplete }));
        expect(
          elements.find((element) => element.props.htmlFor === id),
        ).toBeDefined();
      }
    }
  });

  test("does not instruct invited signup users to enter a hidden code", async () => {
    mocks.cookies.mockResolvedValue(requestCookieStore(rawToken));

    const page = await SignupPage();

    expect(textContent(page)).toContain(
      "Set up your account, then continue to your shared group.",
    );
    expect(textContent(page)).not.toContain("Use the shared invite code");
  });

  test.each([
    ["login", LoginPage],
    ["signup", SignupPage],
  ])("redirects authenticated invited users from %s to claim", async (
    _label,
    Page,
  ) => {
    const redirectError = new Error("NEXT_REDIRECT");
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.cookies.mockResolvedValue(requestCookieStore(rawToken));
    mocks.redirect.mockImplementation(() => {
      throw redirectError;
    });

    await expect(Page()).rejects.toBe(redirectError);

    expect(mocks.redirect).toHaveBeenCalledWith("/invite/claim");
  });

  test.each([
    ["login", LoginPage],
    ["signup", SignupPage],
  ])("keeps the authenticated ordinary %s redirect", async (_label, Page) => {
    const redirectError = new Error("NEXT_REDIRECT");
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.redirect.mockImplementation(() => {
      throw redirectError;
    });

    await expect(Page()).rejects.toBe(redirectError);

    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });
});

describe("InviteUserForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useActionState.mockReturnValue([{}, vi.fn(), false]);
    mocks.useEffect.mockImplementation(() => undefined);
    mocks.useId.mockReturnValue("invite-form");
    mocks.useState
      .mockReturnValueOnce([null, vi.fn()])
      .mockReturnValueOnce([null, vi.fn()]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("renders the optional unlinked ledger member choices", () => {
    const tree = InviteUserForm({
      groupId: "group-1",
      choices: [
        { id: "member-2", name: "Bea" },
        { id: "member-1", name: "Alex" },
      ],
    } as Parameters<typeof InviteUserForm>[0]);
    const elements = collectElements(tree);
    const memberSelect = elements.find(
      (element) => element.props.name === "memberId",
    );

    expect(memberSelect).toBeDefined();
    const options = collectElements(memberSelect?.props.children);
    expect(
      options.map((option) => ({
        value: option.props.value,
        label: textContent(option.props.children),
      })),
    ).toEqual([
      { value: "", label: "No linked member" },
      { value: "member-2", label: "Bea" },
      { value: "member-1", label: "Alex" },
    ]);
  });

  test("copies an absolute invitation URL while displaying only its relative path", async () => {
    const setCopiedPath = vi.fn();
    const setManualCopy = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    mocks.useActionState.mockReturnValue([
      {
        success: "Invitation created for new@example.com.",
        invitationPath: "/invite/raw-token",
      },
      vi.fn(),
      false,
    ]);
    mocks.useState
      .mockReset()
      .mockReturnValueOnce([null, setCopiedPath])
      .mockReturnValueOnce([null, setManualCopy]);
    vi.stubGlobal("window", {
      location: { origin: "https://tab-track.example" },
    });
    vi.stubGlobal("navigator", {
      clipboard: { writeText },
    });

    const tree = InviteUserForm({
      groupId: "group-1",
      choices: [],
    } as Parameters<typeof InviteUserForm>[0]);
    const elements = collectElements(tree);
    const pathField = elements.find(
      (element) =>
        element.props.readOnly === true &&
        element.props.value === "/invite/raw-token",
    );
    const copyButton = elements.find(
      (element) =>
        element.props.type === "button" &&
        textContent(element.props.children) === "Copy invitation link",
    );

    expect(pathField).toBeDefined();
    expect(copyButton).toBeDefined();
    expect(writeText).not.toHaveBeenCalled();

    await (
      copyButton?.props.onClick as (() => Promise<void>) | undefined
    )?.();

    expect(writeText).toHaveBeenCalledWith(
      "https://tab-track.example/invite/raw-token",
    );
    expect(setCopiedPath).toHaveBeenCalledWith("/invite/raw-token");
    expect(setManualCopy).toHaveBeenCalledWith(null);
  });

  test("hides stale invitation output while a new submission is pending", () => {
    mocks.useActionState.mockReturnValue([
      {
        success: "Invitation created for old@example.com.",
        invitationPath: "/invite/old-token",
      },
      vi.fn(),
      true,
    ]);
    mocks.useState
      .mockReset()
      .mockReturnValueOnce(["/invite/old-token", vi.fn()])
      .mockReturnValueOnce([
        {
          invitationPath: "/invite/old-token",
          absoluteUrl: "https://tab-track.example/invite/old-token",
        },
        vi.fn(),
      ]);

    const tree = InviteUserForm({
      groupId: "group-1",
      choices: [],
    } as Parameters<typeof InviteUserForm>[0]);
    const elements = collectElements(tree);

    expect(
      elements.find(
        (element) => element.props.value === "/invite/old-token",
      ),
    ).toBeUndefined();
    expect(
      elements.find(
        (element) =>
          element.props.type === "button" &&
          textContent(element.props.children) === "Copy invitation link",
      ),
    ).toBeUndefined();
    expect(
      elements.find(
        (element) =>
          element.props.role === "status" &&
          textContent(element.props.children) === "Copied",
      ),
    ).toBeUndefined();
  });

  test("does not show copied or manual feedback from a different invitation path", () => {
    mocks.useActionState.mockReturnValue([
      { invitationPath: "/invite/new-token" },
      vi.fn(),
      false,
    ]);
    mocks.useState
      .mockReset()
      .mockReturnValueOnce(["/invite/old-token", vi.fn()])
      .mockReturnValueOnce([
        {
          invitationPath: "/invite/old-token",
          absoluteUrl: "https://tab-track.example/invite/old-token",
        },
        vi.fn(),
      ]);

    const tree = InviteUserForm({
      groupId: "group-1",
      choices: [],
    } as Parameters<typeof InviteUserForm>[0]);
    const elements = collectElements(tree);

    expect(
      elements.find(
        (element) =>
          element.props.role === "status" &&
          textContent(element.props.children) === "Copied",
      ),
    ).toBeUndefined();
    expect(
      elements.find(
        (element) =>
          element.props.value ===
          "https://tab-track.example/invite/old-token",
      ),
    ).toBeUndefined();
  });

  test("clears copied and manual feedback on path changes and form submission", () => {
    const setCopiedPath = vi.fn();
    const setManualCopy = vi.fn();
    mocks.useActionState.mockReturnValue([
      { invitationPath: "/invite/new-token" },
      vi.fn(),
      false,
    ]);
    mocks.useState
      .mockReset()
      .mockReturnValueOnce(["/invite/new-token", setCopiedPath])
      .mockReturnValueOnce([null, setManualCopy]);

    const tree = InviteUserForm({
      groupId: "group-1",
      choices: [],
    } as Parameters<typeof InviteUserForm>[0]);
    const elements = collectElements(tree);
    const copiedStatus = elements.find(
      (element) =>
        element.props.role === "status" &&
        textContent(element.props.children) === "Copied",
    );

    expect(copiedStatus).toBeDefined();
    expect(mocks.useEffect).toHaveBeenCalledOnce();
    const [resetFeedback, dependencies] = mocks.useEffect.mock.calls[0];
    expect(dependencies).toEqual(["/invite/new-token"]);

    resetFeedback();
    expect(setCopiedPath).toHaveBeenCalledWith(null);
    expect(setManualCopy).toHaveBeenCalledWith(null);

    setCopiedPath.mockClear();
    setManualCopy.mockClear();
    const form = elements.find(
      (element) => typeof element.props.onSubmit === "function",
    );
    expect(form).toBeDefined();

    (form?.props.onSubmit as (() => void) | undefined)?.();
    expect(setCopiedPath).toHaveBeenCalledWith(null);
    expect(setManualCopy).toHaveBeenCalledWith(null);
  });

  test("shows a manual absolute link when clipboard access is unavailable", async () => {
    const invitationPath = "/invite/unavailable-token";
    const absoluteUrl =
      "https://tab-track.example/invite/unavailable-token";
    const setCopiedPath = vi.fn();
    const setManualCopy = vi.fn();
    mocks.useActionState.mockReturnValue([
      { invitationPath },
      vi.fn(),
      false,
    ]);
    mocks.useState
      .mockReset()
      .mockReturnValueOnce([null, setCopiedPath])
      .mockReturnValueOnce([null, setManualCopy]);
    vi.stubGlobal("window", {
      location: { origin: "https://tab-track.example" },
    });
    vi.stubGlobal("navigator", {});

    const firstTree = InviteUserForm({
      groupId: "group-1",
      choices: [],
    } as Parameters<typeof InviteUserForm>[0]);
    const copyButton = collectElements(firstTree).find(
      (element) =>
        element.props.type === "button" &&
        textContent(element.props.children) === "Copy invitation link",
    );

    await expect(
      (
        copyButton?.props.onClick as (() => Promise<void>) | undefined
      )?.(),
    ).resolves.toBeUndefined();
    expect(setCopiedPath).toHaveBeenCalledWith(null);
    expect(setManualCopy).toHaveBeenCalledWith({
      invitationPath,
      absoluteUrl,
    });

    mocks.useState
      .mockReset()
      .mockReturnValueOnce([null, setCopiedPath])
      .mockReturnValueOnce([
        { invitationPath, absoluteUrl },
        setManualCopy,
      ]);
    const fallbackTree = InviteUserForm({
      groupId: "group-1",
      choices: [],
    } as Parameters<typeof InviteUserForm>[0]);
    const fallbackElements = collectElements(fallbackTree);

    expect(
      fallbackElements.find(
        (element) =>
          element.props.readOnly === true &&
          element.props.value === absoluteUrl,
      ),
    ).toBeDefined();
    expect(
      fallbackElements.find(
        (element) =>
          element.props.role === "alert" &&
          textContent(element.props.children).includes(
            "Copy the full invitation link manually",
          ),
      ),
    ).toBeDefined();
  });

  test("handles rejected clipboard writes with the same manual fallback", async () => {
    const invitationPath = "/invite/rejected-token";
    const absoluteUrl =
      "https://tab-track.example/invite/rejected-token";
    const setCopiedPath = vi.fn();
    const setManualCopy = vi.fn();
    const writeText = vi.fn().mockRejectedValue(new Error("not allowed"));
    mocks.useActionState.mockReturnValue([
      { invitationPath },
      vi.fn(),
      false,
    ]);
    mocks.useState
      .mockReset()
      .mockReturnValueOnce([null, setCopiedPath])
      .mockReturnValueOnce([null, setManualCopy]);
    vi.stubGlobal("window", {
      location: { origin: "https://tab-track.example" },
    });
    vi.stubGlobal("navigator", {
      clipboard: { writeText },
    });

    const firstTree = InviteUserForm({
      groupId: "group-1",
      choices: [],
    } as Parameters<typeof InviteUserForm>[0]);
    const copyButton = collectElements(firstTree).find(
      (element) =>
        element.props.type === "button" &&
        textContent(element.props.children) === "Copy invitation link",
    );

    await expect(
      (
        copyButton?.props.onClick as (() => Promise<void>) | undefined
      )?.(),
    ).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledWith(absoluteUrl);
    expect(setCopiedPath).toHaveBeenCalledWith(null);
    expect(setManualCopy).toHaveBeenCalledWith({
      invitationPath,
      absoluteUrl,
    });

    mocks.useState
      .mockReset()
      .mockReturnValueOnce([null, setCopiedPath])
      .mockReturnValueOnce([
        { invitationPath, absoluteUrl },
        setManualCopy,
      ]);
    const fallbackTree = InviteUserForm({
      groupId: "group-1",
      choices: [],
    } as Parameters<typeof InviteUserForm>[0]);

    expect(
      collectElements(fallbackTree).find(
        (element) =>
          element.props.readOnly === true &&
          element.props.value === absoluteUrl,
      ),
    ).toBeDefined();
  });
});
