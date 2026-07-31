import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createClient } from "@libsql/client";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, describe, expect, it } from "vitest";

import {
  expenseRevisions,
  expenses,
  expenseSplits,
  groupAccess,
  groupInvitations,
  groups,
  members,
  settlements,
  users,
} from "@/db/schema";
import { hashGroupInvitationToken } from "@/lib/group-invitation-token";
import {
  claimGroupInvitation,
  createGroupInvitationClaimStore,
  type GroupInvitationClaimStore,
} from "@/lib/server/group-invitation-claims";
import {
  cancelGroupInvitation,
  createGroupAccessManagementStore,
  revokeGroupAccess,
  type GroupAccessManagementStore,
} from "@/lib/server/group-access-management";

type TestSchema = {
  expenseRevisions: typeof expenseRevisions;
  expenses: typeof expenses;
  expenseSplits: typeof expenseSplits;
  groupAccess: typeof groupAccess;
  groupInvitations: typeof groupInvitations;
  groups: typeof groups;
  members: typeof members;
  settlements: typeof settlements;
  users: typeof users;
};

type TestDatabase = ReturnType<typeof drizzle<TestSchema>>;
type TestClient = ReturnType<typeof createClient>;

const cleanups: Array<() => void> = [];
const clientsByDatabase = new WeakMap<TestDatabase, TestClient>();
const now = 1_700_000_000_000;
const secret = "test-invitation-secret";

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

async function createTestDatabase(): Promise<TestDatabase> {
  return (await createTestDatabases(1))[0]!;
}

async function createTestDatabases(count: number): Promise<TestDatabase[]> {
  const tempDir = mkdtempSync(
    path.join(tmpdir(), "tab-track-access-management-"),
  );
  const url = `file:${path.join(tempDir, "test.db")}`;
  const clients = Array.from({ length: count }, () => createClient({ url }));
  const databases = clients.map((client) =>
    drizzle(client, {
      schema: {
        expenseRevisions,
        expenses,
        expenseSplits,
        groupAccess,
        groupInvitations,
        groups,
        members,
        settlements,
        users,
      },
    }),
  );
  databases.forEach((database, index) => {
    clientsByDatabase.set(database, clients[index]!);
  });
  cleanups.push(() => {
    for (const client of clients) {
      client.close();
    }
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
      id: "owner-a",
      email: "owner-a@example.com",
      displayName: "Owner A",
      passwordHash: "hash",
    },
    {
      id: "member-a",
      email: "member-a@example.com",
      displayName: "Member A",
      passwordHash: "hash",
    },
    {
      id: "claimant",
      email: "claimant@example.com",
      displayName: "Claimant",
      passwordHash: "hash",
    },
    {
      id: "owner-b",
      email: "owner-b@example.com",
      displayName: "Owner B",
      passwordHash: "hash",
    },
  ]);
  await db.insert(groups).values([
    { id: "group-a", name: "Group A", createdByUserId: "owner-a" },
    { id: "group-b", name: "Group B", createdByUserId: "owner-b" },
  ]);
  await db.insert(groupAccess).values([
    {
      id: "access-owner-a",
      groupId: "group-a",
      userId: "owner-a",
      role: "owner",
    },
    {
      id: "access-member-a",
      groupId: "group-a",
      userId: "member-a",
      role: "member",
    },
    {
      id: "access-owner-b",
      groupId: "group-b",
      userId: "owner-b",
      role: "owner",
    },
    {
      id: "access-member-b",
      groupId: "group-b",
      userId: "member-a",
      role: "member",
    },
  ]);
  await db.insert(members).values([
    {
      id: "ledger-linked",
      groupId: "group-a",
      userId: "member-a",
      name: "Linked member",
    },
    {
      id: "ledger-other",
      groupId: "group-a",
      userId: null,
      name: "Other member",
    },
  ]);
  await db.insert(expenses).values({
    id: "expense-a",
    groupId: "group-a",
    description: "Dinner",
    amount: 40,
    paidById: "ledger-linked",
    splitType: "equal",
    date: "2026-07-30",
  });
  await db.insert(expenseSplits).values([
    {
      id: "split-linked",
      expenseId: "expense-a",
      memberId: "ledger-linked",
      amount: 20,
    },
    {
      id: "split-other",
      expenseId: "expense-a",
      memberId: "ledger-other",
      amount: 20,
    },
  ]);
  await db.insert(expenseRevisions).values({
    id: "revision-a",
    expenseId: "expense-a",
    beforeSnapshot: '{"amount":30}',
    afterSnapshot: '{"amount":40}',
  });
  await db.insert(settlements).values({
    id: "settlement-a",
    groupId: "group-a",
    paidById: "ledger-other",
    paidToId: "ledger-linked",
    amount: 20,
    note: "Settled",
    date: "2026-07-30",
  });

  await insertInvitation(db, {
    id: "invitation-active",
    rawToken: "active-token",
    memberId: "ledger-other",
  });
  await insertInvitation(db, {
    id: "invitation-claimed",
    email: "claimed@example.com",
    rawToken: "claimed-token",
    claimedAt: now - 1,
    claimedByUserId: "member-a",
  });
  await insertInvitation(db, {
    id: "invitation-cross-group",
    groupId: "group-b",
    email: "cross-group@example.com",
    rawToken: "cross-group-token",
  });
}

async function insertInvitation(
  db: TestDatabase,
  overrides: Partial<{
    id: string;
    groupId: string;
    email: string;
    rawToken: string;
    memberId: string | null;
    claimedAt: number | null;
    claimedByUserId: string | null;
    cancelledAt: number | null;
    cancelledByUserId: string | null;
  }> = {},
): Promise<void> {
  const invitation = {
    id: "invitation-active",
    groupId: "group-a",
    email: "claimant@example.com",
    rawToken: "active-token",
    memberId: null,
    claimedAt: null,
    claimedByUserId: null,
    cancelledAt: null,
    cancelledByUserId: null,
    ...overrides,
  };

  await db.insert(groupInvitations).values({
    id: invitation.id,
    groupId: invitation.groupId,
    email: invitation.email,
    role: "member",
    memberId: invitation.memberId,
    tokenHash: hashGroupInvitationToken(invitation.rawToken, secret),
    expiresAt: now + 60_000,
    claimedAt: invitation.claimedAt,
    claimedByUserId: invitation.claimedByUserId,
    cancelledAt: invitation.cancelledAt,
    cancelledByUserId: invitation.cancelledByUserId,
    createdAt: now - 1_000,
    updatedAt: now - 1_000,
  });
}

function managementStore(db: TestDatabase) {
  return createGroupAccessManagementStore(db);
}

async function financialState(db: TestDatabase) {
  return {
    members: await db.select().from(members),
    expenses: await db.select().from(expenses),
    splits: await db.select().from(expenseSplits),
    revisions: await db.select().from(expenseRevisions),
    settlements: await db.select().from(settlements),
  };
}

describe("revokeGroupAccess", () => {
  it("revokes only member access while preserving its member link and financial history", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    const before = await financialState(db);

    await expect(
      revokeGroupAccess(managementStore(db), {
        groupId: "group-a",
        accessId: "access-member-a",
      }),
    ).resolves.toEqual({ kind: "revoked" });

    await expect(
      db
        .select()
        .from(groupAccess)
        .where(eq(groupAccess.id, "access-member-a")),
    ).resolves.toEqual([]);
    await expect(financialState(db)).resolves.toEqual(before);
  });

  it("protects an owner target scoped to the requested group", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);

    await expect(
      revokeGroupAccess(managementStore(db), {
        groupId: "group-a",
        accessId: "access-owner-a",
      }),
    ).resolves.toEqual({ kind: "owner-protected" });
    await expect(
      db
        .select({ id: groupAccess.id })
        .from(groupAccess)
        .where(eq(groupAccess.id, "access-owner-a")),
    ).resolves.toEqual([{ id: "access-owner-a" }]);
  });

  it("treats missing, cross-group, and repeated targets as not active", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    const store = managementStore(db);

    for (const accessId of [
      "missing-access",
      "access-member-b",
      "access-owner-b",
    ]) {
      await expect(
        revokeGroupAccess(store, { groupId: "group-a", accessId }),
      ).resolves.toEqual({ kind: "not-active" });
    }

    await expect(
      revokeGroupAccess(store, {
        groupId: "group-a",
        accessId: "access-member-a",
      }),
    ).resolves.toEqual({ kind: "revoked" });
    await expect(
      revokeGroupAccess(store, {
        groupId: "group-a",
        accessId: "access-member-a",
      }),
    ).resolves.toEqual({ kind: "not-active" });

    await expect(
      db
        .select({ id: groupAccess.id })
        .from(groupAccess)
        .where(eq(groupAccess.id, "access-member-b")),
    ).resolves.toEqual([{ id: "access-member-b" }]);
  });

  it("allows exactly one of two clients to revoke the same member access", async () => {
    const [db, concurrentDb] = await createTestDatabases(2);
    if (!db || !concurrentDb) {
      throw new Error("missing concurrent database");
    }
    await seedDatabase(db);
    const before = await financialState(db);

    let arrivals = 0;
    let releaseDeletes!: () => void;
    const bothDeletesReady = new Promise<void>((resolve) => {
      releaseDeletes = resolve;
    });
    const synchronizeDelete = (
      store: GroupAccessManagementStore,
    ): GroupAccessManagementStore => ({
      ...store,
      async deleteMemberAccess(groupId, accessId) {
        arrivals += 1;
        if (arrivals === 2) {
          releaseDeletes();
        }
        await bothDeletesReady;
        return store.deleteMemberAccess(groupId, accessId);
      },
    });
    const input = {
      groupId: "group-a",
      accessId: "access-member-a",
    };

    const results = await Promise.all([
      revokeGroupAccess(synchronizeDelete(managementStore(db)), input),
      revokeGroupAccess(
        synchronizeDelete(managementStore(concurrentDb)),
        input,
      ),
    ]);

    expect(results.filter((result) => result.kind === "revoked")).toHaveLength(
      1,
    );
    expect(
      results.filter((result) => result.kind === "not-active"),
    ).toHaveLength(1);
    await expect(
      db
        .select({ id: groupAccess.id })
        .from(groupAccess)
        .where(
          and(
            eq(groupAccess.groupId, "group-a"),
            eq(groupAccess.id, "access-member-a"),
          ),
        ),
    ).resolves.toEqual([]);
    await expect(financialState(db)).resolves.toEqual(before);
  });
});

describe("cancelGroupInvitation", () => {
  it("audits cancellation while preserving the token and optional member target", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    const [before] = await db
      .select({
        tokenHash: groupInvitations.tokenHash,
        memberId: groupInvitations.memberId,
      })
      .from(groupInvitations)
      .where(eq(groupInvitations.id, "invitation-active"));

    await expect(
      cancelGroupInvitation(managementStore(db), {
        groupId: "group-a",
        invitationId: "invitation-active",
        cancelledByUserId: "owner-a",
        now,
      }),
    ).resolves.toEqual({ kind: "cancelled" });

    await expect(
      db
        .select({
          tokenHash: groupInvitations.tokenHash,
          memberId: groupInvitations.memberId,
          claimedAt: groupInvitations.claimedAt,
          cancelledAt: groupInvitations.cancelledAt,
          cancelledByUserId: groupInvitations.cancelledByUserId,
          updatedAt: groupInvitations.updatedAt,
        })
        .from(groupInvitations)
        .where(eq(groupInvitations.id, "invitation-active")),
    ).resolves.toEqual([
      {
        ...before,
        claimedAt: null,
        cancelledAt: now,
        cancelledByUserId: "owner-a",
        updatedAt: now,
      },
    ]);
  });

  it("treats repeated, claimed, missing, and cross-group invitations as not active", async () => {
    const db = await createTestDatabase();
    await seedDatabase(db);
    const store = managementStore(db);
    const cancel = (invitationId: string) =>
      cancelGroupInvitation(store, {
        groupId: "group-a",
        invitationId,
        cancelledByUserId: "owner-a",
        now,
      });

    for (const invitationId of [
      "invitation-claimed",
      "missing-invitation",
      "invitation-cross-group",
    ]) {
      await expect(cancel(invitationId)).resolves.toEqual({
        kind: "not-active",
      });
    }

    await expect(cancel("invitation-active")).resolves.toEqual({
      kind: "cancelled",
    });
    await expect(cancel("invitation-active")).resolves.toEqual({
      kind: "not-active",
    });

    await expect(
      db
        .select({
          cancelledAt: groupInvitations.cancelledAt,
          cancelledByUserId: groupInvitations.cancelledByUserId,
        })
        .from(groupInvitations)
        .where(eq(groupInvitations.id, "invitation-cross-group")),
    ).resolves.toEqual([
      { cancelledAt: null, cancelledByUserId: null },
    ]);
  });

  it("allows exactly one of two clients to cancel the same invitation", async () => {
    const [db, concurrentDb] = await createTestDatabases(2);
    if (!db || !concurrentDb) {
      throw new Error("missing concurrent database");
    }
    await seedDatabase(db);
    const input = {
      groupId: "group-a",
      invitationId: "invitation-active",
      cancelledByUserId: "owner-a",
      now,
    };

    const results = await Promise.all([
      cancelGroupInvitation(managementStore(db), input),
      cancelGroupInvitation(managementStore(concurrentDb), input),
    ]);

    expect(results.filter((result) => result.kind === "cancelled")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.kind === "not-active")).toHaveLength(
      1,
    );
    await expect(
      db
        .select({
          claimedAt: groupInvitations.claimedAt,
          cancelledAt: groupInvitations.cancelledAt,
          cancelledByUserId: groupInvitations.cancelledByUserId,
        })
        .from(groupInvitations)
        .where(eq(groupInvitations.id, "invitation-active")),
    ).resolves.toEqual([
      {
        claimedAt: null,
        cancelledAt: now,
        cancelledByUserId: "owner-a",
      },
    ]);
  });

  it("allows exactly one terminal transition in a claim-versus-cancel race", async () => {
    const [db, concurrentDb] = await createTestDatabases(2);
    if (!db || !concurrentDb) {
      throw new Error("missing concurrent database");
    }
    await seedDatabase(db);

    const [claimResult, cancelResult] = await Promise.all([
      claimGroupInvitation(createGroupInvitationClaimStore(db), {
        rawToken: "active-token",
        secret,
        user: { id: "claimant", email: "claimant@example.com" },
        now,
      }),
      cancelGroupInvitation(managementStore(concurrentDb), {
        groupId: "group-a",
        invitationId: "invitation-active",
        cancelledByUserId: "owner-a",
        now,
      }),
    ]);

    const [invitation] = await db
      .select({
        claimedAt: groupInvitations.claimedAt,
        claimedByUserId: groupInvitations.claimedByUserId,
        cancelledAt: groupInvitations.cancelledAt,
        cancelledByUserId: groupInvitations.cancelledByUserId,
      })
      .from(groupInvitations)
      .where(eq(groupInvitations.id, "invitation-active"));
    const transitions = [
      invitation?.claimedAt !== null,
      invitation?.cancelledAt !== null,
    ].filter(Boolean);

    expect(transitions).toHaveLength(1);
    if (invitation?.claimedAt !== null) {
      expect(claimResult).toEqual({ kind: "claimed", groupId: "group-a" });
      expect(cancelResult).toEqual({ kind: "not-active" });
      expect(invitation).toEqual({
        claimedAt: now,
        claimedByUserId: "claimant",
        cancelledAt: null,
        cancelledByUserId: null,
      });
      await expect(
        db
          .select({ id: groupAccess.id })
          .from(groupAccess)
          .where(
            and(
              eq(groupAccess.groupId, "group-a"),
              eq(groupAccess.userId, "claimant"),
            ),
          ),
      ).resolves.toHaveLength(1);
    } else {
      expect(claimResult).toEqual({ kind: "unavailable" });
      expect(cancelResult).toEqual({ kind: "cancelled" });
      expect(invitation).toEqual({
        claimedAt: null,
        claimedByUserId: null,
        cancelledAt: now,
        cancelledByUserId: "owner-a",
      });
      await expect(
        db
          .select({ id: groupAccess.id })
          .from(groupAccess)
          .where(
            and(
              eq(groupAccess.groupId, "group-a"),
              eq(groupAccess.userId, "claimant"),
            ),
          ),
      ).resolves.toEqual([]);
    }
  });

  it("retries a claim whose read snapshot is invalidated by cancellation", async () => {
    const [db, concurrentDb] = await createTestDatabases(2);
    if (!db || !concurrentDb) {
      throw new Error("missing concurrent database");
    }
    await seedDatabase(db);

    let reportTransactionRead!: () => void;
    const transactionRead = new Promise<void>((resolve) => {
      reportTransactionRead = resolve;
    });
    let resumeClaim!: () => void;
    const cancellationCommitted = new Promise<void>((resolve) => {
      resumeClaim = resolve;
    });
    let blockFirstTransactionRead = true;
    const client = clientsByDatabase.get(db);
    if (!client) {
      throw new Error("missing database client");
    }
    // A read transaction begins deferred, allowing the cancellation write to
    // commit after this claim's read and invalidate its SQLite snapshot.
    const deferredClient = new Proxy(client, {
      get(target, property) {
        if (property === "transaction") {
          return () => target.transaction("read");
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const deferredDb = drizzle(deferredClient, {
      schema: {
        expenseRevisions,
        expenses,
        expenseSplits,
        groupAccess,
        groupInvitations,
        groups,
        members,
        settlements,
        users,
      },
    });
    const productionStore = createGroupInvitationClaimStore(deferredDb);
    const barrierStore: GroupInvitationClaimStore = {
      ...productionStore,
      transaction: (callback) =>
        productionStore.transaction((tx) =>
          callback({
            ...tx,
            async findActiveInvitation(tokenHash, readAt) {
              const invitation = await tx.findActiveInvitation(
                tokenHash,
                readAt,
              );
              if (blockFirstTransactionRead) {
                blockFirstTransactionRead = false;
                reportTransactionRead();
                await cancellationCommitted;
              }
              return invitation;
            },
          }),
        ),
    };

    const claimResult = claimGroupInvitation(barrierStore, {
      rawToken: "active-token",
      secret,
      user: { id: "claimant", email: "claimant@example.com" },
      now,
    });
    await transactionRead;

    let cancelResult;
    try {
      cancelResult = await cancelGroupInvitation(managementStore(concurrentDb), {
        groupId: "group-a",
        invitationId: "invitation-active",
        cancelledByUserId: "owner-a",
        now,
      });
    } finally {
      resumeClaim();
    }

    await expect(claimResult).resolves.toEqual({ kind: "unavailable" });
    expect(cancelResult).toEqual({ kind: "cancelled" });
    await expect(
      db
        .select({
          claimedAt: groupInvitations.claimedAt,
          claimedByUserId: groupInvitations.claimedByUserId,
          cancelledAt: groupInvitations.cancelledAt,
          cancelledByUserId: groupInvitations.cancelledByUserId,
        })
        .from(groupInvitations)
        .where(eq(groupInvitations.id, "invitation-active")),
    ).resolves.toEqual([
      {
        claimedAt: null,
        claimedByUserId: null,
        cancelledAt: now,
        cancelledByUserId: "owner-a",
      },
    ]);
  });
});
