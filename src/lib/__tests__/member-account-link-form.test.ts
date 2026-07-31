import { describe, expect, test } from "vitest";

import { parseMemberAccountLinkForm } from "@/lib/member-account-link-form";

describe("parseMemberAccountLinkForm", () => {
  test.each([
    ["missing", undefined],
    ["non-string", new File([], "access.txt")],
    ["empty", ""],
  ])("rejects a %s access ID", (_description, accessId) => {
    const formData = new FormData();
    if (accessId !== undefined) {
      formData.set("accessId", accessId);
    }
    formData.set("memberId", "");

    expect(parseMemberAccountLinkForm(formData)).toEqual({ success: false });
  });

  test.each([
    ["missing", undefined],
    ["non-string", new File([], "member.txt")],
  ])("rejects a %s member ID", (_description, memberId) => {
    const formData = new FormData();
    formData.set("accessId", "access-1");
    if (memberId !== undefined) {
      formData.set("memberId", memberId);
    }

    expect(parseMemberAccountLinkForm(formData)).toEqual({ success: false });
  });

  test("maps an empty member ID to null", () => {
    const formData = new FormData();
    formData.set("accessId", "access-1");
    formData.set("memberId", "");

    expect(parseMemberAccountLinkForm(formData)).toEqual({
      success: true,
      data: { accessId: "access-1", memberId: null },
    });
  });

  test("preserves a nonempty member ID", () => {
    const formData = new FormData();
    formData.set("accessId", "access-1");
    formData.set("memberId", "member-1");

    expect(parseMemberAccountLinkForm(formData)).toEqual({
      success: true,
      data: { accessId: "access-1", memberId: "member-1" },
    });
  });
});
