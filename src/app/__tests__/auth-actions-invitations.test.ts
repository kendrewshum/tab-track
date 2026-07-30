import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as React from "react";

const mocks = vi.hoisted(() => ({
  createGroupSharingStore: vi.fn(),
  generateGroupInvitationToken: vi.fn(),
  generateId: vi.fn(),
  revalidatePath: vi.fn(),
  requireGroupOwner: vi.fn(),
  shareGroup: vi.fn(),
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
vi.mock("@/auth", () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: { mocked: "db" },
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
vi.mock("@/lib/server/session", () => ({
  requireGroupOwner: mocks.requireGroupOwner,
}));
vi.mock("@/lib/utils", () => ({
  generateId: mocks.generateId,
}));

import { inviteUserToGroupAction } from "@/app/auth-actions";
import { InviteUserForm } from "@/app/groups/[id]/invite-user-form";

type ElementLike = {
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

describe("InviteUserForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useActionState.mockReturnValue([{}, vi.fn(), false]);
    mocks.useEffect.mockImplementation(() => undefined);
    mocks.useId.mockReturnValue("invite-form");
    mocks.useState.mockReturnValue([false, vi.fn()]);
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
    const setCopied = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    mocks.useActionState.mockReturnValue([
      {
        success: "Invitation created for new@example.com.",
        invitationPath: "/invite/raw-token",
      },
      vi.fn(),
      false,
    ]);
    mocks.useState.mockReturnValue([false, setCopied]);
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
    expect(setCopied).toHaveBeenCalledWith(true);
  });

  test("clears copied feedback when a new invitation path arrives", () => {
    const setCopied = vi.fn();
    mocks.useActionState.mockReturnValue([
      { invitationPath: "/invite/new-token" },
      vi.fn(),
      false,
    ]);
    mocks.useState.mockReturnValue([true, setCopied]);

    const tree = InviteUserForm({
      groupId: "group-1",
      choices: [],
    } as Parameters<typeof InviteUserForm>[0]);
    const copiedStatus = collectElements(tree).find(
      (element) =>
        element.props.role === "status" &&
        textContent(element.props.children) === "Copied",
    );

    expect(copiedStatus).toBeDefined();
    expect(mocks.useEffect).toHaveBeenCalledOnce();
    const [resetCopied, dependencies] = mocks.useEffect.mock.calls[0];
    expect(dependencies).toEqual(["/invite/new-token"]);

    resetCopied();
    expect(setCopied).toHaveBeenCalledWith(false);
  });
});
