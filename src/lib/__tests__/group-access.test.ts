import { describe, expect, test } from "vitest";

import {
  findAuthorizedGroupAccess,
  findAuthorizedGroupOwnerAccess,
  type GroupAccessRecord,
  type GroupAccessStore,
} from "@/lib/group-access";

describe("findAuthorizedGroupAccess", () => {
  test("returns the membership record for a user who belongs to the group", async () => {
    const access = await findAuthorizedGroupAccess(
      {
        async findGroupAccess(userId, groupId) {
          if (userId === "user-1" && groupId === "group-1") {
            return { groupId, userId, role: "member" };
          }

          return null;
        },
      } satisfies GroupAccessStore,
      "user-1",
      "group-1"
    );

    expect(access).toEqual<GroupAccessRecord>({
      groupId: "group-1",
      userId: "user-1",
      role: "member",
    });
  });

  test("returns null for a user who does not belong to the group", async () => {
    const access = await findAuthorizedGroupAccess(
      {
        async findGroupAccess() {
          return null;
        },
      } satisfies GroupAccessStore,
      "user-2",
      "group-1"
    );

    expect(access).toBeNull();
  });
});

describe("findAuthorizedGroupOwnerAccess", () => {
  test("returns owner access for a user who owns the group", async () => {
    const access = await findAuthorizedGroupOwnerAccess(
      {
        async findGroupAccess(userId, groupId) {
          return { groupId, userId, role: "owner" };
        },
      } satisfies GroupAccessStore,
      "user-1",
      "group-1"
    );

    expect(access).toEqual<GroupAccessRecord>({
      groupId: "group-1",
      userId: "user-1",
      role: "owner",
    });
  });

  test("returns null for regular members", async () => {
    const access = await findAuthorizedGroupOwnerAccess(
      {
        async findGroupAccess(userId, groupId) {
          return { groupId, userId, role: "member" };
        },
      } satisfies GroupAccessStore,
      "user-1",
      "group-1"
    );

    expect(access).toBeNull();
  });
});
