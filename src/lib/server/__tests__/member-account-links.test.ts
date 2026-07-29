import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, describe, expect, it } from "vitest";

import { groupAccess, groups, members, users } from "@/db/schema";
import {
  createMemberAccountLinkStore,
  setAccountMemberLink,
} from "@/lib/server/member-account-links";

type TestDatabase = ReturnType<
  typeof drizzle<{
    groupAccess: typeof groupAccess;
    groups: typeof groups;
    members: typeof members;
    users: typeof users;
  }>
>;

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

async function createTestDatabase(): Promise<TestDatabase> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "tab-track-link-service-"));
  const client = createClient({
    url: `file:${path.join(tempDir, "test.db")}`,
  });
  const db = drizzle(client, {
    schema: { groupAccess, groups, members, users },
  });
  cleanups.push(() => {
    client.close();
    rmSync(tempDir, { force: true, recursive: true });
  });

  await migrate(db, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });

  return db;
}

async function seedDatabase(db: TestDatabase): Promise<void> {
  await db.insert(users).values([
    {
      id: "user-target",
      email: "target@example.com",
      displayName: "Target",
      passwordHash: "hash",
    },
    {
      id: "user-other",
      email: "other@example.com",
      displayName: "Other",
      passwordHash: "hash",
    },
  ]);
  await db.insert(groups).values([
    { id: "group-a", name: "Group A" },
    { id: "group-b", name: "Group B" },
  ]);
  await db.insert(groupAccess).values([
    {
      id: "access-target",
      groupId: "group-a",
      userId: "user-target",
      role: "owner",
    },
    {
      id: "access-other",
      groupId: "group-a",
      userId: "user-other",
      role: "member",
    },
    {
      id: "access-cross-group",
      groupId: "group-b",
      userId: "user-target",
      role: "owner",
    },
  ]);
  await db.insert(members).values([
    { id: "member-old", groupId: "group-a", name: "Old", userId: null },
    { id: "member-new", groupId: "group-a", name: "New", userId: null },
    {
      id: "member-claimed",
      groupId: "group-a",
      name: "Claimed",
      userId: "user-other",
    },
    {
      id: "member-cross-group",
      groupId: "group-b",
      name: "Cross group",
      userId: "user-target",
    },
  ]);
}

async function getLink(
  db: TestDatabase,
  groupId: string,
  memberId: string,
): Promise<string | null> {
  const [member] = await db
    .select({ userId: members.userId })
    .from(members)
    .where(and(eq(members.groupId, groupId), eq(members.id, memberId)))
    .limit(1);

  return member.userId;
}

async function setLink(
  db: TestDatabase,
  input: { groupId: string; accessId: string; memberId: string | null },
) {
  return setAccountMemberLink(createMemberAccountLinkStore(db), input);
}

describe("setAccountMemberLink", () => {
  it("links a group account to a member", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);

    await expect(
      setLink(db, {
        groupId: "group-a",
        accessId: "access-target",
        memberId: "member-new",
      }),
    ).resolves.toEqual({ success: true });
    await expect(getLink(db, "group-a", "member-new")).resolves.toBe(
      "user-target",
    );
  });

  it("rejects access records from another group without changing links", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);

    await expect(
      setLink(db, {
        groupId: "group-a",
        accessId: "access-cross-group",
        memberId: "member-new",
      }),
    ).resolves.toEqual({ success: false, reason: "invalid-target" });
    await expect(getLink(db, "group-a", "member-new")).resolves.toBeNull();
  });

  it("rejects members from another group without disclosing their existence", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);

    await expect(
      setLink(db, {
        groupId: "group-a",
        accessId: "access-target",
        memberId: "member-cross-group",
      }),
    ).resolves.toEqual({ success: false, reason: "invalid-target" });
    await expect(getLink(db, "group-a", "member-old")).resolves.toBeNull();
    await expect(
      getLink(db, "group-b", "member-cross-group"),
    ).resolves.toBe("user-target");
  });

  it("unlinks the target account in the requested group", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await db
      .update(members)
      .set({ userId: "user-target" })
      .where(eq(members.id, "member-old"));

    await expect(
      setLink(db, {
        groupId: "group-a",
        accessId: "access-target",
        memberId: null,
      }),
    ).resolves.toEqual({ success: true });
    await expect(getLink(db, "group-a", "member-old")).resolves.toBeNull();
    await expect(
      getLink(db, "group-b", "member-cross-group"),
    ).resolves.toBe("user-target");
  });

  it("treats an already-linked request as successful", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await db
      .update(members)
      .set({ userId: "user-target" })
      .where(eq(members.id, "member-new"));

    await expect(
      setLink(db, {
        groupId: "group-a",
        accessId: "access-target",
        memberId: "member-new",
      }),
    ).resolves.toEqual({ success: true });
    await expect(getLink(db, "group-a", "member-new")).resolves.toBe(
      "user-target",
    );
  });

  it("treats an already-unlinked request as successful", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);

    await expect(
      setLink(db, {
        groupId: "group-a",
        accessId: "access-target",
        memberId: null,
      }),
    ).resolves.toEqual({ success: true });
    await expect(getLink(db, "group-a", "member-old")).resolves.toBeNull();
    await expect(getLink(db, "group-a", "member-new")).resolves.toBeNull();
  });

  it("moves only the target account link in the requested group", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await db
      .update(members)
      .set({ userId: "user-target" })
      .where(eq(members.id, "member-old"));

    await expect(
      setLink(db, {
        groupId: "group-a",
        accessId: "access-target",
        memberId: "member-new",
      }),
    ).resolves.toEqual({ success: true });
    await expect(getLink(db, "group-a", "member-old")).resolves.toBeNull();
    await expect(getLink(db, "group-a", "member-new")).resolves.toBe(
      "user-target",
    );
    await expect(getLink(db, "group-a", "member-claimed")).resolves.toBe(
      "user-other",
    );
    await expect(
      getLink(db, "group-b", "member-cross-group"),
    ).resolves.toBe("user-target");
  });

  it("maps a claimed-member unique conflict and rolls back the cleared link", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await db
      .update(members)
      .set({ userId: "user-target" })
      .where(eq(members.id, "member-old"));

    await expect(
      setLink(db, {
        groupId: "group-a",
        accessId: "access-target",
        memberId: "member-claimed",
      }),
    ).resolves.toEqual({ success: false, reason: "member-claimed" });
    await expect(getLink(db, "group-a", "member-old")).resolves.toBe(
      "user-target",
    );
    await expect(getLink(db, "group-a", "member-claimed")).resolves.toBe(
      "user-other",
    );
  });

  it("propagates unexpected store errors", async () => {
    const failure = new Error("database unavailable");
    const store = {
      transaction: async () => {
        throw failure;
      },
      isUniqueConflict: () => false,
    };

    await expect(
      setAccountMemberLink(store, {
        groupId: "group-a",
        accessId: "access-target",
        memberId: "member-new",
      }),
    ).rejects.toBe(failure);
  });

  it("maps the member-link SQLite unique constraint to member-claimed", async () => {
    const db = await createTestDatabase();
    const failure = Object.assign(
      new Error(
        "SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: members.group_id, members.user_id",
      ),
      { code: "SQLITE_CONSTRAINT_UNIQUE" },
    );
    const productionStore = createMemberAccountLinkStore(db);
    const store = {
      transaction: async () => {
        throw failure;
      },
      isUniqueConflict: productionStore.isUniqueConflict,
    };

    await expect(
      setAccountMemberLink(store, {
        groupId: "group-a",
        accessId: "access-target",
        memberId: "member-new",
      }),
    ).resolves.toEqual({ success: false, reason: "member-claimed" });
  });

  it("does not swallow an unrelated SQLite unique constraint", async () => {
    const db = await createTestDatabase();
    const failure = Object.assign(
      new Error(
        "SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: users.email",
      ),
      { code: "SQLITE_CONSTRAINT_UNIQUE" },
    );
    const productionStore = createMemberAccountLinkStore(db);
    const store = {
      transaction: async () => {
        throw failure;
      },
      isUniqueConflict: productionStore.isUniqueConflict,
    };

    await expect(
      setAccountMemberLink(store, {
        groupId: "group-a",
        accessId: "access-target",
        memberId: "member-new",
      }),
    ).rejects.toBe(failure);
  });
});
