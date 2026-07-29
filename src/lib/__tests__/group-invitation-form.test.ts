import { describe, expect, test } from "vitest";

import { parseGroupInvitationForm } from "@/lib/group-invitation-form";

function invitationForm(email?: string | File, memberId?: string | File): FormData {
  const formData = new FormData();

  if (email !== undefined) {
    formData.set("email", email);
  }

  if (memberId !== undefined) {
    formData.set("memberId", memberId);
  }

  return formData;
}

describe("parseGroupInvitationForm", () => {
  test("trims and lowercases a valid email", () => {
    expect(
      parseGroupInvitationForm(invitationForm("  Friend.Name@Example.COM  "))
    ).toEqual({
      success: true,
      data: { email: "friend.name@example.com", memberId: null },
    });
  });

  test.each([
    ["missing", undefined],
    ["a File", new File([], "email.txt")],
    ["empty", ""],
    ["whitespace-only", "   "],
    ["missing local part", "@example.com"],
    ["missing domain", "friend@"],
    ["missing top-level domain", "friend@example"],
    ["embedded whitespace", "friend name@example.com"],
    ["embedded whitespace after at-sign", "friend@exam ple.com"],
  ])("rejects %s email", (_description, email) => {
    expect(parseGroupInvitationForm(invitationForm(email))).toEqual({
      success: false,
    });
  });

  test("maps a missing member ID to null", () => {
    expect(
      parseGroupInvitationForm(invitationForm("friend@example.com"))
    ).toEqual({
      success: true,
      data: { email: "friend@example.com", memberId: null },
    });
  });

  test("maps an empty or whitespace-only member ID to null", () => {
    expect(
      parseGroupInvitationForm(invitationForm("friend@example.com", "  "))
    ).toEqual({
      success: true,
      data: { email: "friend@example.com", memberId: null },
    });
  });

  test("trims a non-empty member ID", () => {
    expect(
      parseGroupInvitationForm(invitationForm("friend@example.com", " member-1 "))
    ).toEqual({
      success: true,
      data: { email: "friend@example.com", memberId: "member-1" },
    });
  });

  test("rejects a File member ID", () => {
    expect(
      parseGroupInvitationForm(
        invitationForm("friend@example.com", new File([], "member.txt"))
      )
    ).toEqual({ success: false });
  });
});
