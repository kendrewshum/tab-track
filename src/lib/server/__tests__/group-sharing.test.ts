import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { LibsqlError } from "@libsql/core/api";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, describe, expect, it } from "vitest";

import {
  groupAccess,
  groupInvitations,
  groups,
  members,
  users,
} from "@/db/schema";
import { hashGroupInvitationToken } from "@/lib/group-invitation-token";
import {
  createGroupSharingStore,
  shareGroup,
  type GroupSharingStore,
} from "@/lib/server/group-sharing";

type TestDatabase = ReturnType<
  typeof drizzle<{
    groupAccess: typeof groupAccess;
    groupInvitations: typeof groupInvitations;
    groups: typeof groups;
    members: typeof members;
    users: typeof users;
  }>
>;

const cleanups: Array<() => void> = [];
const now = 1_700_000_000_000;
const secret = "test-invitation-secret";

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

async function createTestDatabase(): Promise<TestDatabase> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "tab-track-group-sharing-"));
  const client = createClient({ url: `file:${path.join(tempDir, "test.db")}` });
  const db = drizzle(client, {
    schema: { groupAccess, groupInvitations, groups, members, users },
  });
  cleanups.push(() => {
    client.close();
    rmSync(tempDir, { force: true, recursive: true });
  });
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  return db;
}

async function seedDatabase(db: TestDatabase): Promise<void> {
  await db.insert(users).values([
    { id: "owner", email: "owner@example.com", displayName: "Owner", passwordHash: "hash" },
    { id: "registered", email: "registered@example.com", displayName: "Registered", passwordHash: "hash" },
    { id: "friend", email: "friend@example.com", displayName: "Friend", passwordHash: "hash" },
    { id: "other", email: "other@example.com", displayName: "Other", passwordHash: "hash" },
  ]);
  await db.insert(groups).values([
    { id: "group-a", name: "Group A", createdByUserId: "owner" },
    { id: "group-b", name: "Group B", createdByUserId: "owner" },
  ]);
  await db.insert(members).values([
    { id: "member-open", groupId: "group-a", name: "Open", userId: null },
    { id: "member-open-2", groupId: "group-a", name: "Open 2", userId: null },
    { id: "member-other", groupId: "group-a", name: "Other", userId: "other" },
    { id: "member-same", groupId: "group-a", name: "Same", userId: null },
    { id: "member-cross", groupId: "group-b", name: "Cross", userId: null },
  ]);
}

function input(overrides: Partial<Parameters<typeof shareGroup>[1]> = {}) {
  return {
    groupId: "group-a",
    email: "unknown@example.com",
    memberId: null,
    secret,
    now,
    generateId: () => "invitation-1",
    generateToken: () => "first-raw-token",
    ...overrides,
  };
}

async function share(db: TestDatabase, overrides: Partial<Parameters<typeof shareGroup>[1]> = {}) {
  return shareGroup(createGroupSharingStore(db), input(overrides));
}

async function invitationRows(db: TestDatabase) {
  return db.select().from(groupInvitations);
}

describe("shareGroup", () => {
  it("creates a pending invitation for an unknown email without persisting its raw token", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);

    await expect(share(db)).resolves.toEqual({
      kind: "invitation-created",
      email: "unknown@example.com",
      invitationPath: "/invite/first-raw-token",
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });

    await expect(invitationRows(db)).resolves.toEqual([
      expect.objectContaining({
        id: "invitation-1",
        groupId: "group-a",
        email: "unknown@example.com",
        role: "member",
        memberId: null,
        tokenHash: hashGroupInvitationToken("first-raw-token", secret),
        expiresAt: now + 7 * 24 * 60 * 60 * 1000,
        claimedAt: null,
        claimedByUserId: null,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    expect(JSON.stringify(await invitationRows(db))).not.toContain("first-raw-token");
  });

  it("rotates a re-invitation and clears prior invitation metadata", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await share(db, { memberId: "member-open" });
    await db.update(groupInvitations).set({
      claimedAt: 123,
      claimedByUserId: "registered",
      cancelledAt: 456,
    });

    await expect(
      share(db, {
        memberId: "member-open-2",
        now: now + 1,
        generateToken: () => "second-raw-token",
      }),
    ).resolves.toEqual({
      kind: "invitation-created",
      email: "unknown@example.com",
      invitationPath: "/invite/second-raw-token",
      expiresAt: now + 1 + 7 * 24 * 60 * 60 * 1000,
    });

    await expect(invitationRows(db)).resolves.toEqual([
      expect.objectContaining({
        id: "invitation-1",
        memberId: "member-open-2",
        tokenHash: hashGroupInvitationToken("second-raw-token", secret),
        expiresAt: now + 1 + 7 * 24 * 60 * 60 * 1000,
        claimedAt: null,
        claimedByUserId: null,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now + 1,
      }),
    ]);
    expect((await invitationRows(db))[0]?.tokenHash).not.toBe(
      hashGroupInvitationToken("first-raw-token", secret),
    );
  });

  it("grants a registered account access and links its selected member", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);

    await expect(
      share(db, { email: "registered@example.com", memberId: "member-open" }),
    ).resolves.toEqual({
      kind: "access-granted",
      email: "registered@example.com",
      memberLinked: true,
    });
    await expect(
      db.select().from(groupAccess).where(and(eq(groupAccess.groupId, "group-a"), eq(groupAccess.userId, "registered"))),
    ).resolves.toEqual([expect.objectContaining({ role: "member" })]);
    await expect(
      db.select({ userId: members.userId }).from(members).where(eq(members.id, "member-open")),
    ).resolves.toEqual([{ userId: "registered" }]);
  });

  it("reports no member link when granting a registered account access without a selected member", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);

    await expect(share(db, { email: "registered@example.com" })).resolves.toEqual({
      kind: "access-granted",
      email: "registered@example.com",
      memberLinked: false,
    });
  });

  it("normalizes a service email before finding and returning a registered account", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);

    await expect(
      share(db, { email: " Friend@Example.COM " }),
    ).resolves.toEqual({
      kind: "access-granted",
      email: "friend@example.com",
      memberLinked: false,
    });
    await expect(
      db
        .select()
        .from(groupAccess)
        .where(
          and(
            eq(groupAccess.groupId, "group-a"),
            eq(groupAccess.userId, "friend"),
          ),
        ),
    ).resolves.toHaveLength(1);
  });

  it("keeps existing access authoritative instead of rotating a pending invitation", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await db.insert(groupInvitations).values({
      id: "old-pending-invitation",
      groupId: "group-a",
      email: "registered@example.com",
      role: "member",
      memberId: null,
      tokenHash: hashGroupInvitationToken("old-token", secret),
      expiresAt: now + 100,
      claimedAt: null,
      claimedByUserId: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const [pending] = await invitationRows(db);
    await db.insert(groupAccess).values({ id: "existing-access", groupId: "group-a", userId: "registered", role: "member" });

    await expect(
      share(db, { email: "registered@example.com", generateToken: () => "would-rotate" }),
    ).resolves.toEqual({ kind: "already-shared" });
    await expect(invitationRows(db)).resolves.toEqual([pending]);
  });

  it.each([
    ["missing", "missing-member"],
    ["cross-group", "member-cross"],
    ["claimed by another account", "member-other"],
  ])("rejects a %s member without writing access or an invitation", async (_label, memberId) => {
    const db = await createTestDatabase();
    await seedDatabase(db);

    await expect(share(db, { email: "registered@example.com", memberId })).resolves.toEqual({ kind: "invalid-member" });
    await expect(db.select().from(groupAccess).where(eq(groupAccess.groupId, "group-a"))).resolves.toEqual([]);
    await expect(invitationRows(db)).resolves.toEqual([]);
  });

  it("allows recovery when the selected member is already linked to the target account", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await db
      .update(members)
      .set({ userId: "registered" })
      .where(eq(members.id, "member-same"));

    await expect(
      share(db, { email: "registered@example.com", memberId: "member-same" }),
    ).resolves.toEqual({
      kind: "access-granted",
      email: "registered@example.com",
      memberLinked: true,
    });
  });

  it("commits access after production-classified member-link contention", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await db
      .update(members)
      .set({ userId: "registered" })
      .where(eq(members.id, "member-same"));
    const productionStore = createGroupSharingStore(db);
    const seenErrors: unknown[] = [];
    const store: GroupSharingStore = {
      ...productionStore,
      isMemberLinkUniqueConflict(error) {
        seenErrors.push(error);
        return productionStore.isMemberLinkUniqueConflict(error);
      },
    };

    await expect(
      shareGroup(
        store,
        input({ email: "registered@example.com", memberId: "member-open" }),
      ),
    ).resolves.toEqual({
      kind: "access-granted",
      email: "registered@example.com",
      memberLinked: false,
    });
    expect(seenErrors).toHaveLength(1);
    expect(seenErrors[0]).toMatchObject({
      code: expect.stringMatching(/^SQLITE_CONSTRAINT(?:_UNIQUE)?$/),
      message: expect.stringMatching(
        /^UNIQUE constraint failed: members\.group_id, members\.user_id$/,
      ),
    });
    expect(productionStore.isMemberLinkUniqueConflict(seenErrors[0])).toBe(true);
    await expect(
      db
        .select()
        .from(groupAccess)
        .where(
          and(
            eq(groupAccess.groupId, "group-a"),
            eq(groupAccess.userId, "registered"),
          ),
        ),
    ).resolves.toHaveLength(1);
    await expect(
      db.select({ userId: members.userId }).from(members).where(eq(members.id, "member-same")),
    ).resolves.toEqual([{ userId: "registered" }]);
    await expect(
      db.select({ userId: members.userId }).from(members).where(eq(members.id, "member-open")),
    ).resolves.toEqual([{ userId: null }]);
  });

  it("does not classify member-link constraints with additional columns", async () => {
    const db = await createTestDatabase();
    const store = createGroupSharingStore(db);
    const broaderConstraint = Object.assign(
      new Error(
        "UNIQUE constraint failed: members.group_id, members.user_id, members.id",
      ),
      { code: "SQLITE_CONSTRAINT_UNIQUE" },
    );

    expect(store.isMemberLinkUniqueConflict(broaderConstraint)).toBe(false);
  });

  it("classifies the exact member conflict shape returned by Turso", async () => {
    const db = await createTestDatabase();
    const store = createGroupSharingStore(db);
    const remoteConflict = new LibsqlError(
      "SQLite error: UNIQUE constraint failed: members.group_id, members.user_id",
      "SQLITE_CONSTRAINT",
    );

    expect(remoteConflict.message).toBe(
      "SQLITE_CONSTRAINT: SQLite error: UNIQUE constraint failed: members.group_id, members.user_id",
    );
    expect(store.isMemberLinkUniqueConflict(remoteConflict)).toBe(true);
  });

  it("rejects remote member constraints with broader columns", async () => {
    const db = await createTestDatabase();
    const store = createGroupSharingStore(db);
    const remoteConstraint = new LibsqlError(
      "SQLite error: UNIQUE constraint failed: members.group_id, members.user_id, members.id",
      "SQLITE_CONSTRAINT",
    );

    expect(store.isMemberLinkUniqueConflict(remoteConstraint)).toBe(false);
  });

  it("propagates unexpected failures so the real transaction rolls back", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    const store = createGroupSharingStore(db);
    const failingStore: GroupSharingStore = {
      ...store,
      transaction: async (callback) => store.transaction(async (tx) => callback({
        ...tx,
        linkMember: async () => { throw new Error("link exploded"); },
      })),
    };

    await expect(
      shareGroup(failingStore, input({ email: "registered@example.com", memberId: "member-open" })),
    ).rejects.toThrow("link exploded");
    await expect(db.select().from(groupAccess).where(eq(groupAccess.groupId, "group-a"))).resolves.toEqual([]);
  });

  it("invites the same unknown email independently in another group", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await share(db);

    await expect(
      share(db, { groupId: "group-b", generateId: () => "invitation-2", generateToken: () => "group-b-token" }),
    ).resolves.toEqual(expect.objectContaining({ kind: "invitation-created" }));
    await expect(invitationRows(db)).resolves.toHaveLength(2);
  });

  it("rolls back a rotation when its token hash collides with another invitation", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    const oldInvitation = {
      id: "invitee-invitation",
      groupId: "group-a",
      email: "invitee@example.com",
      role: "member" as const,
      memberId: "member-open",
      tokenHash: hashGroupInvitationToken("old-token", secret),
      expiresAt: now + 100,
      claimedAt: 12,
      claimedByUserId: "registered",
      cancelledAt: 34,
      cancelledByUserId: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(groupInvitations).values([
      oldInvitation,
      {
        id: "collision-invitation",
        groupId: "group-b",
        email: "collision@example.com",
        role: "member",
        memberId: null,
        tokenHash: hashGroupInvitationToken("colliding-token", secret),
        expiresAt: now + 200,
        claimedAt: null,
        claimedByUserId: null,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await expect(
      share(db, {
        email: "invitee@example.com",
        memberId: "member-open-2",
        generateToken: () => "colliding-token",
      }),
    ).rejects.toThrow();
    await expect(
      db
        .select()
        .from(groupInvitations)
        .where(eq(groupInvitations.id, "invitee-invitation")),
    ).resolves.toEqual([oldInvitation]);
  });
});
