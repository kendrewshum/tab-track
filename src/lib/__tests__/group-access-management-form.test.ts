import { File } from "node:buffer";

import { describe, expect, test } from "vitest";

import {
  parseGroupAccessTarget,
  parseGroupInvitationTarget,
} from "@/lib/group-access-management-form";

function formWith(name: string, value?: string | File): FormData {
  const formData = new FormData();

  if (value !== undefined) {
    formData.set(name, value);
  }

  return formData;
}

describe("parseGroupAccessTarget", () => {
  test("trims a valid access ID", () => {
    expect(parseGroupAccessTarget(formWith("accessId", " access-1 "))).toEqual({
      success: true,
      data: { accessId: "access-1" },
    });
  });

  test.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace-only", "  "],
    ["a File", new File([], "access.txt")],
  ])("rejects a %s access ID", (_description, accessId) => {
    expect(parseGroupAccessTarget(formWith("accessId", accessId))).toEqual({
      success: false,
    });
  });
});

describe("parseGroupInvitationTarget", () => {
  test("trims a valid invitation ID", () => {
    expect(
      parseGroupInvitationTarget(formWith("invitationId", " invitation-1 "))
    ).toEqual({
      success: true,
      data: { invitationId: "invitation-1" },
    });
  });

  test.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace-only", "  "],
    ["a File", new File([], "invitation.txt")],
  ])("rejects a %s invitation ID", (_description, invitationId) => {
    expect(
      parseGroupInvitationTarget(formWith("invitationId", invitationId))
    ).toEqual({ success: false });
  });
});
