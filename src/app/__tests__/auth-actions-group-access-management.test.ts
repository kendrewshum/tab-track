import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelGroupInvitation: vi.fn(),
  createGroupAccessManagementStore: vi.fn(),
  redirect: vi.fn(),
  requireGroupOwner: vi.fn(),
  revalidatePath: vi.fn(),
  revokeGroupAccess: vi.fn(),
}));

vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {},
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));
vi.mock("@/auth", () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: { mocked: "db" },
}));
vi.mock("@/lib/server/group-access-management", () => ({
  cancelGroupInvitation: mocks.cancelGroupInvitation,
  createGroupAccessManagementStore: mocks.createGroupAccessManagementStore,
  revokeGroupAccess: mocks.revokeGroupAccess,
}));
vi.mock("@/lib/server/session", () => ({
  requireGroupOwner: mocks.requireGroupOwner,
}));

import {
  cancelGroupInvitationAction,
  revokeGroupAccessAction,
} from "@/app/auth-actions";

const redirectSentinel = new Error("NEXT_REDIRECT");

function formData(fieldName: string, value?: string) {
  const data = new FormData();
  if (value !== undefined) {
    data.set(fieldName, value);
  }
  return data;
}

describe("revokeGroupAccessAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createGroupAccessManagementStore.mockReturnValue("management-store");
    mocks.redirect.mockImplementation(() => {
      throw redirectSentinel;
    });
    mocks.requireGroupOwner.mockResolvedValue({
      user: { id: "owner-1" },
      access: { role: "owner" },
    });
    mocks.revokeGroupAccess.mockResolvedValue({ kind: "revoked" });
  });

  test("authorizes before rejecting malformed form data", async () => {
    await expect(
      revokeGroupAccessAction("group-1", {}, formData("accessId")),
    ).resolves.toEqual({ error: "We could not remove that access." });

    expect(mocks.requireGroupOwner).toHaveBeenCalledWith("group-1");
    expect(mocks.createGroupAccessManagementStore).not.toHaveBeenCalled();
    expect(mocks.revokeGroupAccess).not.toHaveBeenCalled();
  });

  test("propagates owner authorization failures before validating form data", async () => {
    const rejection = new Error("not authorized");
    mocks.requireGroupOwner.mockRejectedValue(rejection);

    await expect(
      revokeGroupAccessAction("group-1", {}, formData("accessId")),
    ).rejects.toBe(rejection);

    expect(mocks.revokeGroupAccess).not.toHaveBeenCalled();
  });

  test("passes only the scoped IDs, revalidates, and redirects with stable feedback", async () => {
    await expect(
      revokeGroupAccessAction(
        "group-1",
        {},
        formData("accessId", "  access-1  "),
      ),
    ).rejects.toBe(redirectSentinel);

    expect(mocks.createGroupAccessManagementStore).toHaveBeenCalledWith({
      mocked: "db",
    });
    expect(mocks.revokeGroupAccess).toHaveBeenCalledWith("management-store", {
      groupId: "group-1",
      accessId: "access-1",
    });
    expect(mocks.requireGroupOwner.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.revokeGroupAccess.mock.invocationCallOrder[0],
    );
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/"],
      ["/groups/group-1"],
    ]);
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/groups/group-1?accessManagement=access-removed",
    );
    expect(mocks.revalidatePath.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.redirect.mock.invocationCallOrder[0],
    );
  });

  test("protects the owner without revalidating", async () => {
    mocks.revokeGroupAccess.mockResolvedValue({ kind: "owner-protected" });

    await expect(
      revokeGroupAccessAction("group-1", {}, formData("accessId", "access-1")),
    ).resolves.toEqual({ error: "The group owner cannot be removed." });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  test("treats inactive access as an idempotent success and redirects", async () => {
    mocks.revokeGroupAccess.mockResolvedValue({ kind: "not-active" });

    await expect(
      revokeGroupAccessAction("group-1", {}, formData("accessId", "access-1")),
    ).rejects.toBe(redirectSentinel);

    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/"],
      ["/groups/group-1"],
    ]);
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/groups/group-1?accessManagement=access-removed",
    );
  });

  test("returns a confirmation-capable retry error without exposing service details", async () => {
    mocks.revokeGroupAccess.mockRejectedValue(
      new Error("database unavailable: internal details"),
    );

    await expect(
      revokeGroupAccessAction("group-1", {}, formData("accessId", "access-1")),
    ).resolves.toEqual({
      error: "We could not remove that access. Try again.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("cancelGroupInvitationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(1_725_000_000_000);
    mocks.createGroupAccessManagementStore.mockReturnValue("management-store");
    mocks.redirect.mockImplementation(() => {
      throw redirectSentinel;
    });
    mocks.requireGroupOwner.mockResolvedValue({
      user: { id: "owner-1" },
      access: { role: "owner" },
    });
    mocks.cancelGroupInvitation.mockResolvedValue({ kind: "cancelled" });
  });

  afterEach(() => {
    vi.mocked(Date.now).mockRestore();
  });

  test("authorizes before rejecting malformed form data", async () => {
    await expect(
      cancelGroupInvitationAction("group-1", {}, formData("invitationId")),
    ).resolves.toEqual({ error: "We could not cancel that invitation." });

    expect(mocks.requireGroupOwner).toHaveBeenCalledWith("group-1");
    expect(mocks.createGroupAccessManagementStore).not.toHaveBeenCalled();
    expect(mocks.cancelGroupInvitation).not.toHaveBeenCalled();
  });

  test("propagates owner authorization failures before validating form data", async () => {
    const rejection = new Error("not authorized");
    mocks.requireGroupOwner.mockRejectedValue(rejection);

    await expect(
      cancelGroupInvitationAction("group-1", {}, formData("invitationId")),
    ).rejects.toBe(rejection);

    expect(mocks.cancelGroupInvitation).not.toHaveBeenCalled();
  });

  test("uses the owner and clock, then revalidates and redirects with stable feedback", async () => {
    await expect(
      cancelGroupInvitationAction(
        "group-1",
        {},
        formData("invitationId", "  invitation-1  "),
      ),
    ).rejects.toBe(redirectSentinel);

    expect(mocks.createGroupAccessManagementStore).toHaveBeenCalledWith({
      mocked: "db",
    });
    expect(mocks.cancelGroupInvitation).toHaveBeenCalledWith(
      "management-store",
      {
        groupId: "group-1",
        invitationId: "invitation-1",
        cancelledByUserId: "owner-1",
        now: 1_725_000_000_000,
      },
    );
    expect(mocks.requireGroupOwner.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.cancelGroupInvitation.mock.invocationCallOrder[0],
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/groups/group-1");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/groups/group-1?accessManagement=invitation-cancelled",
    );
    expect(mocks.revalidatePath.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.redirect.mock.invocationCallOrder[0],
    );
  });

  test("treats inactive invitations as idempotently cancelled and redirects", async () => {
    mocks.cancelGroupInvitation.mockResolvedValue({ kind: "not-active" });

    await expect(
      cancelGroupInvitationAction(
        "group-1",
        {},
        formData("invitationId", "invitation-1"),
      ),
    ).rejects.toBe(redirectSentinel);

    expect(mocks.revalidatePath).toHaveBeenCalledWith("/groups/group-1");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/groups/group-1?accessManagement=invitation-cancelled",
    );
  });

  test("returns a confirmation-capable retry error without exposing service details", async () => {
    mocks.cancelGroupInvitation.mockRejectedValue(
      new Error("database unavailable: internal details"),
    );

    await expect(
      cancelGroupInvitationAction(
        "group-1",
        {},
        formData("invitationId", "invitation-1"),
      ),
    ).resolves.toEqual({
      error: "We could not cancel that invitation. Try again.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
