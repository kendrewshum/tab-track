import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, describe, expect, it } from "vitest";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

async function createMigratedDatabase(): Promise<Client> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "tab-track-invitations-"));
  const client = createClient({ url: `file:${path.join(tempDir, "test.db")}` });
  cleanups.push(() => {
    client.close();
    rmSync(tempDir, { force: true, recursive: true });
  });

  await migrate(drizzle(client), {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });

  return client;
}

async function insertUser(client: Client, id: string): Promise<void> {
  await client.execute({
    sql: `
      INSERT INTO users (id, email, display_name, password_hash)
      VALUES (?, ?, ?, ?)
    `,
    args: [id, `${id}@example.com`, id, "hash"],
  });
}

async function insertGroup(client: Client, id: string): Promise<void> {
  await client.execute({
    sql: "INSERT INTO groups (id, name) VALUES (?, ?)",
    args: [id, id],
  });
}

async function insertMember(
  client: Client,
  id: string,
  groupId: string,
): Promise<void> {
  await client.execute({
    sql: "INSERT INTO members (id, group_id, name) VALUES (?, ?, ?)",
    args: [id, groupId, id],
  });
}

async function insertInvitation(
  client: Client,
  {
    id,
    groupId,
    email,
    tokenHash,
    role = "member",
    memberId = null,
    claimedByUserId = null,
  }: {
    id: string;
    groupId: string;
    email: string;
    tokenHash: string;
    role?: "member" | "owner";
    memberId?: string | null;
    claimedByUserId?: string | null;
  },
): Promise<void> {
  await client.execute({
    sql: `
      INSERT INTO group_invitations (
        id, group_id, email, role, member_id, token_hash, expires_at,
        claimed_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      groupId,
      email,
      role,
      memberId,
      tokenHash,
      1_700_000_000_000,
      claimedByUserId,
      1_700_000_000_000,
      1_700_000_000_000,
    ],
  });
}

describe("group invitations migration", () => {
  it("adds invitation columns, foreign keys, and indexes", async () => {
    const client = await createMigratedDatabase();

    const columns = await client.execute('PRAGMA table_info("group_invitations")');
    expect(columns.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", notnull: 1 }),
        expect.objectContaining({ name: "group_id", notnull: 1 }),
        expect.objectContaining({ name: "email", notnull: 1 }),
        expect.objectContaining({ name: "role", notnull: 1 }),
        expect.objectContaining({ name: "token_hash", notnull: 1 }),
        expect.objectContaining({ name: "expires_at", notnull: 1 }),
        expect.objectContaining({ name: "created_at", notnull: 1 }),
        expect.objectContaining({ name: "updated_at", notnull: 1 }),
        expect.objectContaining({ name: "member_id", notnull: 0 }),
        expect.objectContaining({ name: "claimed_at", notnull: 0 }),
        expect.objectContaining({ name: "claimed_by_user_id", notnull: 0 }),
        expect.objectContaining({ name: "cancelled_at", notnull: 0 }),
      ]),
    );

    const foreignKeys = await client.execute(
      'PRAGMA foreign_key_list("group_invitations")',
    );
    expect(foreignKeys.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "group_id",
          table: "groups",
          to: "id",
          on_delete: "CASCADE",
        }),
        expect.objectContaining({
          from: "member_id",
          table: "members",
          to: "id",
          on_delete: "SET NULL",
        }),
        expect.objectContaining({
          from: "claimed_by_user_id",
          table: "users",
          to: "id",
          on_delete: "SET NULL",
        }),
      ]),
    );

    const indexes = await client.execute('PRAGMA index_list("group_invitations")');
    expect(indexes.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "group_invitations_group_email_unique",
          unique: 1,
        }),
        expect.objectContaining({
          name: "group_invitations_token_hash_unique",
          unique: 1,
        }),
        expect.objectContaining({
          name: "group_invitations_expires_at_idx",
          unique: 0,
        }),
      ]),
    );

    const groupEmailUniqueIndex = await client.execute(
      'PRAGMA index_info("group_invitations_group_email_unique")',
    );
    expect(groupEmailUniqueIndex.rows.map((row) => row.name)).toEqual([
      "group_id",
      "email",
    ]);

    const tokenHashUniqueIndex = await client.execute(
      'PRAGMA index_info("group_invitations_token_hash_unique")',
    );
    expect(tokenHashUniqueIndex.rows.map((row) => row.name)).toEqual([
      "token_hash",
    ]);

    const expiresAtIndex = await client.execute(
      'PRAGMA index_info("group_invitations_expires_at_idx")',
    );
    expect(expiresAtIndex.rows.map((row) => row.name)).toEqual(["expires_at"]);
  });

  it("rejects duplicate email addresses within one group", async () => {
    const client = await createMigratedDatabase();
    await insertGroup(client, "group-1");
    await insertInvitation(client, {
      id: "invitation-1",
      groupId: "group-1",
      email: "friend@example.com",
      tokenHash: "token-1",
    });

    await expect(
      insertInvitation(client, {
        id: "invitation-2",
        groupId: "group-1",
        email: "friend@example.com",
        tokenHash: "token-2",
      }),
    ).rejects.toThrow(/unique/i);
  });

  it("allows an email address to be invited to different groups", async () => {
    const client = await createMigratedDatabase();
    await insertGroup(client, "group-1");
    await insertGroup(client, "group-2");

    await insertInvitation(client, {
      id: "invitation-1",
      groupId: "group-1",
      email: "friend@example.com",
      tokenHash: "token-1",
    });

    await expect(
      insertInvitation(client, {
        id: "invitation-2",
        groupId: "group-2",
        email: "friend@example.com",
        tokenHash: "token-2",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects duplicate token hashes", async () => {
    const client = await createMigratedDatabase();
    await insertGroup(client, "group-1");
    await insertGroup(client, "group-2");
    await insertInvitation(client, {
      id: "invitation-1",
      groupId: "group-1",
      email: "first@example.com",
      tokenHash: "token-1",
    });

    await expect(
      insertInvitation(client, {
        id: "invitation-2",
        groupId: "group-2",
        email: "second@example.com",
        tokenHash: "token-1",
      }),
    ).rejects.toThrow(/unique/i);
  });

  it("rejects roles other than member", async () => {
    const client = await createMigratedDatabase();
    await insertGroup(client, "group-1");

    await expect(
      insertInvitation(client, {
        id: "invitation-1",
        groupId: "group-1",
        email: "friend@example.com",
        role: "owner",
        tokenHash: "token-1",
      }),
    ).rejects.toThrow(/check/i);
  });

  it("unlinks a deleted member from an invitation", async () => {
    const client = await createMigratedDatabase();
    await insertGroup(client, "group-1");
    await insertMember(client, "member-1", "group-1");
    await insertInvitation(client, {
      id: "invitation-1",
      groupId: "group-1",
      email: "friend@example.com",
      tokenHash: "token-1",
      memberId: "member-1",
    });

    await client.execute({
      sql: "DELETE FROM members WHERE id = ?",
      args: ["member-1"],
    });

    const result = await client.execute({
      sql: "SELECT member_id FROM group_invitations WHERE id = ?",
      args: ["invitation-1"],
    });
    expect(result.rows).toEqual([{ member_id: null }]);
  });

  it("unlinks a deleted claiming user from an invitation", async () => {
    const client = await createMigratedDatabase();
    await insertUser(client, "user-1");
    await insertGroup(client, "group-1");
    await insertInvitation(client, {
      id: "invitation-1",
      groupId: "group-1",
      email: "friend@example.com",
      tokenHash: "token-1",
      claimedByUserId: "user-1",
    });

    await client.execute({
      sql: "DELETE FROM users WHERE id = ?",
      args: ["user-1"],
    });

    const result = await client.execute({
      sql: "SELECT claimed_by_user_id FROM group_invitations WHERE id = ?",
      args: ["invitation-1"],
    });
    expect(result.rows).toEqual([{ claimed_by_user_id: null }]);
  });
});
