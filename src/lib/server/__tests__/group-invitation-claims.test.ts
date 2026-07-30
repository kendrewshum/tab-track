import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { LibsqlError } from "@libsql/core/api";
import { and, eq, sql } from "drizzle-orm";
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
  GROUP_INVITATION_CLAIM_MAX_ATTEMPTS,
  claimGroupInvitation,
  createGroupInvitationClaimStore,
  inspectGroupInvitation,
  isInvitationAuthorizedForSignup,
  type GroupInvitationClaimStore,
  type GroupInvitationClaimTransaction,
} from "@/lib/server/group-invitation-claims";

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
  return (await createTestDatabases(1))[0]!;
}

async function createTestDatabases(count: number): Promise<TestDatabase[]> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "tab-track-claim-service-"));
  const url = `file:${path.join(tempDir, "test.db")}`;
  const clients = Array.from({ length: count }, () => createClient({ url }));
  const databases = clients.map((client) =>
    drizzle(client, {
      schema: { groupAccess, groupInvitations, groups, members, users },
    }),
  );
  cleanups.push(() => {
    for (const client of clients) client.close();
    rmSync(tempDir, { force: true, recursive: true });
  });
  await databases[0]!.run(sql`PRAGMA journal_mode = WAL`);
  await migrate(databases[0]!, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  return databases;
}

async function seedDatabase(db: TestDatabase): Promise<void> {
  await db.insert(users).values([
    {
      id: "owner",
      email: "owner@example.com",
      displayName: "Owner",
      passwordHash: "hash",
    },
    {
      id: "claimant",
      email: "friend@example.com",
      displayName: "Friend",
      passwordHash: "hash",
    },
    {
      id: "other",
      email: "other@example.com",
      displayName: "Other",
      passwordHash: "hash",
    },
  ]);
  await db.insert(groups).values([
    { id: "group-a", name: "Group A", createdByUserId: "owner" },
    { id: "group-b", name: "Group B", createdByUserId: "owner" },
  ]);
  await db.insert(members).values([
    { id: "member-open", groupId: "group-a", name: "Open", userId: null },
    { id: "member-second", groupId: "group-a", name: "Second", userId: null },
    {
      id: "member-other",
      groupId: "group-a",
      name: "Other",
      userId: "other",
    },
    {
      id: "member-cross",
      groupId: "group-b",
      name: "Cross",
      userId: null,
    },
  ]);
}

type InvitationOverrides = Partial<{
  id: string;
  groupId: string;
  email: string;
  memberId: string | null;
  rawToken: string;
  expiresAt: number;
  claimedAt: number | null;
  claimedByUserId: string | null;
  cancelledAt: number | null;
}>;

async function insertInvitation(
  db: TestDatabase,
  overrides: InvitationOverrides = {},
): Promise<void> {
  const invitation = {
    id: "invitation-active",
    groupId: "group-a",
    email: "friend@example.com",
    memberId: null,
    rawToken: "active-token",
    expiresAt: now + 100,
    claimedAt: null,
    claimedByUserId: null,
    cancelledAt: null,
    ...overrides,
  };
  await db.insert(groupInvitations).values({
    id: invitation.id,
    groupId: invitation.groupId,
    email: invitation.email,
    role: "member",
    memberId: invitation.memberId,
    tokenHash: hashGroupInvitationToken(invitation.rawToken, secret),
    expiresAt: invitation.expiresAt,
    claimedAt: invitation.claimedAt,
    claimedByUserId: invitation.claimedByUserId,
    cancelledAt: invitation.cancelledAt,
    createdAt: now - 100,
    updatedAt: now - 100,
  });
}

function claim(
  db: TestDatabase,
  overrides: Partial<Parameters<typeof claimGroupInvitation>[1]> = {},
) {
  return claimGroupInvitation(createGroupInvitationClaimStore(db), {
    rawToken: "active-token",
    secret,
    user: { id: "claimant", email: "friend@example.com" },
    now,
    ...overrides,
  });
}

function databaseBusyError(): Error & { code: "SQLITE_BUSY" } {
  return Object.assign(new Error("database is locked"), {
    code: "SQLITE_BUSY" as const,
  });
}

function successfulClaimTransaction(): GroupInvitationClaimTransaction {
  return {
    findActiveInvitation: async () => ({
      id: "invitation-active",
      groupId: "group-a",
      email: "friend@example.com",
      memberId: null,
      expiresAt: now + 100,
    }),
    markClaimed: async () => true,
    grantAccess: async () => undefined,
    linkMember: async () => false,
  };
}

async function accessRows(db: TestDatabase) {
  return db
    .select()
    .from(groupAccess)
    .where(
      and(
        eq(groupAccess.groupId, "group-a"),
        eq(groupAccess.userId, "claimant"),
      ),
    );
}

describe("group invitation claims", () => {
  it("inspects an active invitation without exposing invitation details", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await insertInvitation(db, { expiresAt: now + 1 });

    const result = await inspectGroupInvitation(
      createGroupInvitationClaimStore(db),
      { rawToken: "active-token", secret, now },
    );

    expect(result).toEqual({ kind: "active", expiresAt: now + 1 });
    expect(JSON.stringify(result)).not.toContain("friend@example.com");
    expect(JSON.stringify(result)).not.toContain("group-a");
    expect(JSON.stringify(result)).not.toContain(
      hashGroupInvitationToken("active-token", secret),
    );
  });

  it("treats exact expiry as unavailable", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await insertInvitation(db, { expiresAt: now });

    await expect(
      inspectGroupInvitation(createGroupInvitationClaimStore(db), {
        rawToken: "active-token",
        secret,
        now,
      }),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("returns one generic result for unknown, expired, cancelled, and claimed invitations", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await insertInvitation(db, {
      id: "expired",
      rawToken: "expired-token",
      email: "expired@example.com",
      expiresAt: now,
    });
    await insertInvitation(db, {
      id: "cancelled",
      rawToken: "cancelled-token",
      email: "cancelled@example.com",
      cancelledAt: now - 1,
    });
    await insertInvitation(db, {
      id: "claimed",
      rawToken: "claimed-token",
      email: "claimed@example.com",
      claimedAt: now - 1,
      claimedByUserId: "other",
    });

    const store = createGroupInvitationClaimStore(db);
    for (const input of [
      { rawToken: "unknown-token", secret },
      { rawToken: "active-token", secret: "wrong-secret" },
      { rawToken: "expired-token", secret },
      { rawToken: "cancelled-token", secret },
      { rawToken: "claimed-token", secret },
    ]) {
      await expect(
        inspectGroupInvitation(store, { ...input, now }),
      ).resolves.toEqual({ kind: "unavailable" });
    }
  });

  it("authorizes signup for a normalized email match without consuming the invitation", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await insertInvitation(db, { email: "friend@example.com" });

    await expect(
      isInvitationAuthorizedForSignup(createGroupInvitationClaimStore(db), {
        rawToken: "active-token",
        secret,
        email: " Friend@Example.COM ",
        now,
      }),
    ).resolves.toBe(true);
    await expect(
      db.select().from(groupInvitations),
    ).resolves.toEqual([
      expect.objectContaining({
        claimedAt: null,
        claimedByUserId: null,
        cancelledAt: null,
      }),
    ]);
    await expect(accessRows(db)).resolves.toEqual([]);
  });

  it("does not authorize mismatched or inactive signup invitations", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await insertInvitation(db);
    await insertInvitation(db, {
      id: "expired",
      rawToken: "expired-token",
      email: "expired@example.com",
      expiresAt: now,
    });
    await insertInvitation(db, {
      id: "cancelled",
      rawToken: "cancelled-token",
      email: "cancelled@example.com",
      cancelledAt: now - 1,
    });
    await insertInvitation(db, {
      id: "claimed",
      rawToken: "claimed-token",
      email: "claimed@example.com",
      claimedAt: now - 1,
      claimedByUserId: "other",
    });
    const store = createGroupInvitationClaimStore(db);

    for (const input of [
      {
        rawToken: "active-token",
        secret,
        email: "different@example.com",
      },
      {
        rawToken: "active-token",
        secret: "wrong-secret",
        email: "friend@example.com",
      },
      {
        rawToken: "unknown-token",
        secret,
        email: "friend@example.com",
      },
      {
        rawToken: "expired-token",
        secret,
        email: "expired@example.com",
      },
      {
        rawToken: "cancelled-token",
        secret,
        email: "cancelled@example.com",
      },
      {
        rawToken: "claimed-token",
        secret,
        email: "claimed@example.com",
      },
    ]) {
      await expect(
        isInvitationAuthorizedForSignup(store, { ...input, now }),
      ).resolves.toBe(false);
    }
    await expect(accessRows(db)).resolves.toEqual([]);
    expect(
      (await db.select().from(groupInvitations)).every(
        (invitation) =>
          invitation.id === "claimed" || invitation.claimedAt === null,
      ),
    ).toBe(true);
  });

  it("claims an invitation, records the account, and grants member access", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await insertInvitation(db);

    const result = await claim(db, {
      user: { id: "claimant", email: " Friend@Example.COM " },
    });

    expect(result).toEqual({ kind: "claimed", groupId: "group-a" });
    await expect(
      db.select().from(groupInvitations),
    ).resolves.toEqual([
      expect.objectContaining({
        claimedAt: now,
        claimedByUserId: "claimant",
        updatedAt: now,
      }),
    ]);
    await expect(accessRows(db)).resolves.toEqual([
      expect.objectContaining({
        groupId: "group-a",
        userId: "claimant",
        role: "member",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain(
      hashGroupInvitationToken("active-token", secret),
    );
  });

  it("leaves a mismatched invitation active and grants no access", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await insertInvitation(db);

    await expect(
      claim(db, {
        user: { id: "claimant", email: "someone-else@example.com" },
      }),
    ).resolves.toEqual({ kind: "account-mismatch" });
    await expect(
      db.select().from(groupInvitations),
    ).resolves.toEqual([
      expect.objectContaining({
        claimedAt: null,
        claimedByUserId: null,
      }),
    ]);
    await expect(accessRows(db)).resolves.toEqual([]);
    await expect(
      inspectGroupInvitation(createGroupInvitationClaimStore(db), {
        rawToken: "active-token",
        secret,
        now,
      }),
    ).resolves.toEqual({ kind: "active", expiresAt: now + 100 });
  });

  it("rejects replay without duplicating access", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await insertInvitation(db);

    await expect(claim(db)).resolves.toEqual({
      kind: "claimed",
      groupId: "group-a",
    });
    await expect(claim(db)).resolves.toEqual({ kind: "unavailable" });
    await expect(accessRows(db)).resolves.toHaveLength(1);
  });

  it.each(["owner", "member"] as const)(
    "keeps existing %s access unchanged while consuming the invitation",
    async (role) => {
      const db = await createTestDatabase();
      await seedDatabase(db);
      await db.insert(groupAccess).values({
        id: `existing-${role}`,
        groupId: "group-a",
        userId: "claimant",
        role,
      });
      await insertInvitation(db);

      await expect(claim(db)).resolves.toEqual({
        kind: "claimed",
        groupId: "group-a",
      });
      await expect(accessRows(db)).resolves.toEqual([
        expect.objectContaining({ id: `existing-${role}`, role }),
      ]);
      await expect(
        db.select({ claimedAt: groupInvitations.claimedAt }).from(
          groupInvitations,
        ),
      ).resolves.toEqual([{ claimedAt: now }]);
    },
  );

  it("links the optional member when it is available in the invitation group", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await insertInvitation(db, { memberId: "member-open" });

    await expect(claim(db)).resolves.toEqual({
      kind: "claimed",
      groupId: "group-a",
    });
    await expect(
      db
        .select({ userId: members.userId })
        .from(members)
        .where(eq(members.id, "member-open")),
    ).resolves.toEqual([{ userId: "claimant" }]);
  });

  it.each([
    ["no member", null],
    ["cross-group member", "member-cross"],
    ["member linked to another account", "member-other"],
  ] as const)(
    "succeeds access-only for an unavailable %s",
    async (_description, memberId) => {
      const db = await createTestDatabase();
      await seedDatabase(db);
      await insertInvitation(db, { memberId });

      await expect(claim(db)).resolves.toEqual({
        kind: "claimed",
        groupId: "group-a",
      });
      await expect(accessRows(db)).resolves.toHaveLength(1);
      if (memberId !== null) {
        const [member] = await db
          .select({ userId: members.userId })
          .from(members)
          .where(eq(members.id, memberId));
        expect(member?.userId).not.toBe("claimant");
      }
    },
  );

  it("succeeds access-only when the invited member was deleted", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await insertInvitation(db, { memberId: "member-open" });
    await db.delete(members).where(eq(members.id, "member-open"));

    await expect(claim(db)).resolves.toEqual({
      kind: "claimed",
      groupId: "group-a",
    });
    await expect(accessRows(db)).resolves.toHaveLength(1);
  });

  it("preserves an account's existing member link instead of moving it", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await db
      .update(members)
      .set({ userId: "claimant" })
      .where(eq(members.id, "member-second"));
    await insertInvitation(db, { memberId: "member-open" });

    await expect(claim(db)).resolves.toEqual({
      kind: "claimed",
      groupId: "group-a",
    });
    await expect(
      db
        .select({ id: members.id, userId: members.userId })
        .from(members)
        .where(eq(members.groupId, "group-a")),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "member-open", userId: null }),
        expect.objectContaining({ id: "member-second", userId: "claimant" }),
      ]),
    );
  });

  it.each([1, 2, 3])(
    "allows exactly one concurrent claimant to consume a token (run %s)",
    async () => {
      const [db, concurrentDb] = await createTestDatabases(2);
      if (!db || !concurrentDb) throw new Error("missing concurrent database");
      await seedDatabase(db);
      await insertInvitation(db);
      const input = {
        rawToken: "active-token",
        secret,
        user: { id: "claimant", email: "friend@example.com" },
        now,
      };

      const results = await Promise.all([
        claimGroupInvitation(createGroupInvitationClaimStore(db), input),
        claimGroupInvitation(
          createGroupInvitationClaimStore(concurrentDb),
          input,
        ),
      ]);

      expect(results).toEqual(
        expect.arrayContaining([
          { kind: "claimed", groupId: "group-a" },
          { kind: "unavailable" },
        ]),
      );
      expect(
        results.filter((result) => result.kind === "claimed"),
      ).toHaveLength(1);
      await expect(accessRows(db)).resolves.toHaveLength(1);
      await expect(
        db
          .select({
            claimedAt: groupInvitations.claimedAt,
            claimedByUserId: groupInvitations.claimedByUserId,
          })
          .from(groupInvitations),
      ).resolves.toEqual([
        { claimedAt: now, claimedByUserId: "claimant" },
      ]);
    },
  );

  it.each(["grantAccess", "linkMember"] as const)(
    "rolls back the claim and access after an unexpected %s failure",
    async (failingMethod) => {
      const db = await createTestDatabase();
      await seedDatabase(db);
      await insertInvitation(db, { memberId: "member-open" });
      const store = createGroupInvitationClaimStore(db);
      const failingStore: GroupInvitationClaimStore = {
        ...store,
        transaction: (callback) =>
          store.transaction((tx) =>
            callback({
              ...tx,
              [failingMethod]: async () => {
                throw new Error(`${failingMethod} exploded`);
              },
            }),
          ),
      };

      await expect(
        claimGroupInvitation(failingStore, {
          rawToken: "active-token",
          secret,
          user: { id: "claimant", email: "friend@example.com" },
          now,
        }),
      ).rejects.toThrow(`${failingMethod} exploded`);
      await expect(accessRows(db)).resolves.toEqual([]);
      await expect(
        db
          .select({
            claimedAt: groupInvitations.claimedAt,
            claimedByUserId: groupInvitations.claimedByUserId,
          })
          .from(groupInvitations),
      ).resolves.toEqual([{ claimedAt: null, claimedByUserId: null }]);
      await expect(
        db
          .select({ userId: members.userId })
          .from(members)
          .where(eq(members.id, "member-open")),
      ).resolves.toEqual([{ userId: null }]);
    },
  );

  it("retries a SQLITE_BUSY claim transaction and returns its successful result", async () => {
    let transactionCalls = 0;
    const store: GroupInvitationClaimStore = {
      findActiveInvitation: async () => null,
      async transaction(callback) {
        transactionCalls += 1;
        if (transactionCalls === 1) throw databaseBusyError();
        return callback(successfulClaimTransaction());
      },
      isMemberLinkUniqueConflict: () => false,
    };

    await expect(
      claimGroupInvitation(store, {
        rawToken: "active-token",
        secret,
        user: { id: "claimant", email: "friend@example.com" },
        now,
      }),
    ).resolves.toEqual({ kind: "claimed", groupId: "group-a" });
    expect(transactionCalls).toBe(2);
  });

  it("does not retry a non-busy transaction failure", async () => {
    let transactionCalls = 0;
    const failure = new Error("unexpected database failure");
    const store: GroupInvitationClaimStore = {
      findActiveInvitation: async () => null,
      async transaction() {
        transactionCalls += 1;
        throw failure;
      },
      isMemberLinkUniqueConflict: () => false,
    };

    await expect(
      claimGroupInvitation(store, {
        rawToken: "active-token",
        secret,
        user: { id: "claimant", email: "friend@example.com" },
        now,
      }),
    ).rejects.toBe(failure);
    expect(transactionCalls).toBe(1);
  });

  it("stops retrying persistent SQLITE_BUSY failures at the declared maximum", async () => {
    let transactionCalls = 0;
    const failure = databaseBusyError();
    const store: GroupInvitationClaimStore = {
      findActiveInvitation: async () => null,
      async transaction() {
        transactionCalls += 1;
        throw failure;
      },
      isMemberLinkUniqueConflict: () => false,
    };

    await expect(
      claimGroupInvitation(store, {
        rawToken: "active-token",
        secret,
        user: { id: "claimant", email: "friend@example.com" },
        now,
      }),
    ).rejects.toBe(failure);
    expect(transactionCalls).toBe(GROUP_INVITATION_CLAIM_MAX_ATTEMPTS);
  });

  it("fully rolls back a busy transaction before retrying the guarded claim", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    await insertInvitation(db);
    const store = createGroupInvitationClaimStore(db);
    let injectBusy = true;
    const busyStore: GroupInvitationClaimStore = {
      ...store,
      transaction: (callback) =>
        store.transaction((tx) =>
          callback({
            ...tx,
            async grantAccess(groupId, userId) {
              await tx.grantAccess(groupId, userId);
              if (injectBusy) {
                injectBusy = false;
                throw databaseBusyError();
              }
            },
          }),
        ),
    };

    await expect(
      claimGroupInvitation(busyStore, {
        rawToken: "active-token",
        secret,
        user: { id: "claimant", email: "friend@example.com" },
        now,
      }),
    ).resolves.toEqual({ kind: "claimed", groupId: "group-a" });
    await expect(accessRows(db)).resolves.toHaveLength(1);
    await expect(
      db
        .select({
          claimedAt: groupInvitations.claimedAt,
          claimedByUserId: groupInvitations.claimedByUserId,
        })
        .from(groupInvitations),
    ).resolves.toEqual([
      { claimedAt: now, claimedByUserId: "claimant" },
    ]);
  });

  it("recognizes only the exact local member-link unique constraint", async () => {
    const db = await createTestDatabase();
    const store = createGroupInvitationClaimStore(db);

    expect(
      store.isMemberLinkUniqueConflict({
        code: "SQLITE_CONSTRAINT_UNIQUE",
        message:
          "UNIQUE constraint failed: members.group_id, members.user_id",
      }),
    ).toBe(true);
    expect(
      store.isMemberLinkUniqueConflict({
        code: "SQLITE_CONSTRAINT_UNIQUE",
        message:
          "UNIQUE constraint failed: members.group_id, members.user_id, members.id",
      }),
    ).toBe(false);
  });

  it("recognizes the exact remote member-link unique constraint", async () => {
    const db = await createTestDatabase();
    const store = createGroupInvitationClaimStore(db);
    const failure = new LibsqlError(
      "SQLite error: UNIQUE constraint failed: members.group_id, members.user_id",
      "SQLITE_CONSTRAINT",
    );

    expect(store.isMemberLinkUniqueConflict(failure)).toBe(true);
  });

  it("rejects different member-link constraint codes and messages", async () => {
    const db = await createTestDatabase();
    const store = createGroupInvitationClaimStore(db);

    expect(
      store.isMemberLinkUniqueConflict({
        code: "SQLITE_CONSTRAINT_FOREIGNKEY",
        message:
          "UNIQUE constraint failed: members.group_id, members.user_id",
      }),
    ).toBe(false);
    expect(
      store.isMemberLinkUniqueConflict({
        code: "SQLITE_CONSTRAINT_UNIQUE",
        message: "UNIQUE constraint failed: group_access.group_id",
      }),
    ).toBe(false);
  });
});
