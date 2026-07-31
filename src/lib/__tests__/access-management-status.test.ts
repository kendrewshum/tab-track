import { describe, expect, test } from "vitest";

import {
  getAccessManagementStatus,
  getUrlWithoutAccessManagementStatus,
} from "@/lib/access-management-status";

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

describe("getUrlWithoutAccessManagementStatus", () => {
  test.each([
    [
      "https://tab-track.example/groups/group-1?accessManagement=access-removed&activity=40#history",
      "/groups/group-1?activity=40#history",
    ],
    [
      "https://tab-track.example/groups/group-1?activity=20&accessManagement=one&accessManagement=two#balances",
      "/groups/group-1?activity=20#balances",
    ],
    [
      "https://tab-track.example/groups/group-1?accessManagement=unknown",
      "/groups/group-1",
    ],
  ])("removes only accessManagement from %s", (url, expected) => {
    expect(getUrlWithoutAccessManagementStatus(url)).toBe(expected);
  });

  test("does not request history replacement when the marker is absent", () => {
    expect(
      getUrlWithoutAccessManagementStatus(
        "https://tab-track.example/groups/group-1?activity=20#history",
      ),
    ).toBeUndefined();
  });
});
