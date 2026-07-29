import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMemberAccountLinkStore: vi.fn(),
  revalidatePath: vi.fn(),
  requireGroupOwner: vi.fn(),
  setAccountMemberLink: vi.fn(),
}));

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
vi.mock("@/lib/server/session", () => ({
  requireGroupOwner: mocks.requireGroupOwner,
}));
vi.mock("@/lib/server/member-account-links", () => ({
  createMemberAccountLinkStore: mocks.createMemberAccountLinkStore,
  setAccountMemberLink: mocks.setAccountMemberLink,
}));

import { setMemberAccountLinkAction } from "@/app/auth-actions";

function validFormData(memberId = "member-1") {
  const formData = new FormData();
  formData.set("accessId", "access-1");
  formData.set("memberId", memberId);
  return formData;
}

describe("setMemberAccountLinkAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createMemberAccountLinkStore.mockReturnValue("store");
    mocks.requireGroupOwner.mockResolvedValue({ access: { role: "owner" } });
    mocks.setAccountMemberLink.mockResolvedValue({ success: true });
  });

  test("authorizes the owner before rejecting malformed targets", async () => {
    const formData = new FormData();

    await expect(
      setMemberAccountLinkAction("group-1", {}, formData)
    ).resolves.toEqual({ error: "Choose a valid ledger member." });

    expect(mocks.requireGroupOwner).toHaveBeenCalledWith("group-1");
    expect(mocks.setAccountMemberLink).not.toHaveBeenCalled();
  });

  test("passes the scoped IDs to the member-account link service", async () => {
    await setMemberAccountLinkAction("group-1", {}, validFormData(""));

    expect(mocks.setAccountMemberLink).toHaveBeenCalledWith("store", {
      groupId: "group-1",
      accessId: "access-1",
      memberId: null,
    });
    expect(mocks.requireGroupOwner.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setAccountMemberLink.mock.invocationCallOrder[0]
    );
  });

  test("returns the member-claimed conflict message", async () => {
    mocks.setAccountMemberLink.mockResolvedValue({
      success: false,
      reason: "member-claimed",
    });

    await expect(
      setMemberAccountLinkAction("group-1", {}, validFormData())
    ).resolves.toEqual({
      error: "That ledger member is already linked to another account.",
    });
  });

  test("returns a generic invalid-target message", async () => {
    mocks.setAccountMemberLink.mockResolvedValue({
      success: false,
      reason: "invalid-target",
    });

    await expect(
      setMemberAccountLinkAction("group-1", {}, validFormData())
    ).resolves.toEqual({
      error: "We could not update that account link.",
    });
  });

  test("revalidates the group and reports success", async () => {
    await expect(
      setMemberAccountLinkAction("group-1", {}, validFormData())
    ).resolves.toEqual({ success: "Ledger member updated." });

    expect(mocks.revalidatePath).toHaveBeenCalledWith("/groups/group-1");
  });

  test("propagates unexpected service errors", async () => {
    const error = new Error("database unavailable");
    mocks.setAccountMemberLink.mockRejectedValue(error);

    await expect(
      setMemberAccountLinkAction("group-1", {}, validFormData())
    ).rejects.toBe(error);
  });
});
