import { describe, expect, test } from "vitest";

import {
  parseLegacyGroupAccessMap,
  syncLegacyGroupAccessForUser,
  type LegacyGroupAccessEntry,
  type LegacyGroupAccessStore,
} from "@/lib/legacy-group-access";

function createStore(overrides?: Partial<LegacyGroupAccessStore>) {
  const groups = new Map([
    ["Austin 2026", { id: "group-1", name: "Austin 2026", createdByUserId: null as string | null }],
  ]);
  const users = new Map([
    ["owner@example.com", { id: "user-owner", email: "owner@example.com" }],
    ["friend@example.com", { id: "user-friend", email: "friend@example.com" }],
  ]);
  const accessRows: Array<{ groupId: string; userId: string; role: "owner" | "member" }> = [];

  const store: LegacyGroupAccessStore = {
    async findGroupByName(name) {
      return groups.get(name) ?? null;
    },
    async findUserByEmail(email) {
      return users.get(email) ?? null;
    },
    async updateGroupOwner(groupId, userId) {
      for (const group of groups.values()) {
        if (group.id === groupId) {
          group.createdByUserId = userId;
        }
      }
    },
    async ensureGroupAccess(groupId, userId, role) {
      const exists = accessRows.some((row) => row.groupId === groupId && row.userId === userId);
      if (!exists) {
        accessRows.push({ groupId, userId, role });
      }
    },
    ...overrides,
  };

  return { store, groups, users, accessRows };
}

describe("parseLegacyGroupAccessMap", () => {
  test("parses valid JSON mappings", () => {
    expect(
      parseLegacyGroupAccessMap(
        '[{"groupName":"Austin 2026","ownerEmail":"owner@example.com","memberEmails":["friend@example.com"]}]'
      )
    ).toEqual<LegacyGroupAccessEntry[]>([
      {
        groupName: "Austin 2026",
        ownerEmail: "owner@example.com",
        memberEmails: ["friend@example.com"],
      },
    ]);
  });

  test("returns an empty list for invalid JSON", () => {
    expect(parseLegacyGroupAccessMap("{not json")).toEqual([]);
  });
});

describe("syncLegacyGroupAccessForUser", () => {
  const mappings: LegacyGroupAccessEntry[] = [
    {
      groupName: "Austin 2026",
      ownerEmail: "owner@example.com",
      memberEmails: ["friend@example.com"],
    },
  ];

  test("adds mapped users to the existing legacy group and sets the owner once available", async () => {
    const { store, groups, accessRows } = createStore();

    await syncLegacyGroupAccessForUser(
      store,
      { id: "user-friend", email: "friend@example.com" },
      mappings
    );

    expect(groups.get("Austin 2026")?.createdByUserId).toBe("user-owner");
    expect(accessRows).toEqual(
      expect.arrayContaining([
        { groupId: "group-1", userId: "user-owner", role: "owner" },
        { groupId: "group-1", userId: "user-friend", role: "member" },
      ])
    );
  });

  test("does nothing for users who are not in the mapping", async () => {
    const { store, groups, accessRows } = createStore({
      async findUserByEmail(email) {
        if (email === "other@example.com") {
          return { id: "user-other", email };
        }

        return email === "owner@example.com"
          ? { id: "user-owner", email }
          : email === "friend@example.com"
          ? { id: "user-friend", email }
          : null;
      },
    });

    await syncLegacyGroupAccessForUser(
      store,
      { id: "user-other", email: "other@example.com" },
      mappings
    );

    expect(groups.get("Austin 2026")?.createdByUserId).toBeNull();
    expect(accessRows).toEqual([]);
  });

  test("is idempotent across repeated syncs", async () => {
    const { store, accessRows } = createStore();

    await syncLegacyGroupAccessForUser(
      store,
      { id: "user-friend", email: "friend@example.com" },
      mappings
    );
    await syncLegacyGroupAccessForUser(
      store,
      { id: "user-friend", email: "friend@example.com" },
      mappings
    );

    expect(accessRows).toEqual([
      { groupId: "group-1", userId: "user-owner", role: "owner" },
      { groupId: "group-1", userId: "user-friend", role: "member" },
    ]);
  });
});
