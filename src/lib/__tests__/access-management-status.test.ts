import { describe, expect, test } from "vitest";

import { getAccessManagementStatus } from "@/lib/access-management-status";

describe("getAccessManagementStatus", () => {
  test.each([
    ["access-removed", "Access removed."],
    ["invitation-cancelled", "Invitation cancelled."],
  ])("maps the exact %s marker", (marker, expected) => {
    expect(getAccessManagementStatus(marker)).toBe(expected);
  });

  test.each([
    undefined,
    "unknown",
    "access-removed ",
    "invitation-cancelled?extra=true",
    "<script>alert('unsafe')</script>",
    ["access-removed"],
    ["invitation-cancelled", "access-removed"],
  ])("ignores unsupported marker input %#", (value) => {
    expect(getAccessManagementStatus(value)).toBeUndefined();
  });
});
