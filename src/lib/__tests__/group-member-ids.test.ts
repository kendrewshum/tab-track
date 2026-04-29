import { describe, expect, test } from "vitest";

import { areGroupMemberIds } from "@/lib/group-member-ids";

describe("areGroupMemberIds", () => {
  const groupMemberIds = new Set(["alice", "bob", "carol"]);

  test("accepts IDs that all belong to the group", () => {
    expect(areGroupMemberIds(groupMemberIds, ["alice", "bob"])).toBe(true);
  });

  test("rejects IDs from another group", () => {
    expect(areGroupMemberIds(groupMemberIds, ["alice", "mallory"])).toBe(false);
  });

  test("rejects duplicate IDs so one member cannot be counted twice", () => {
    expect(areGroupMemberIds(groupMemberIds, ["alice", "alice"])).toBe(false);
  });
});
