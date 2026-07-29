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
  const tempDir = mkdtempSync(path.join(tmpdir(), "tab-track-member-links-"));
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
  userId: string | null,
): Promise<void> {
  await client.execute({
    sql: "INSERT INTO members (id, group_id, name, user_id) VALUES (?, ?, ?, ?)",
    args: [id, groupId, id, userId],
  });
}

describe("member account links migration", () => {
  it("adds a nullable user foreign key and the group-user unique index", async () => {
    const client = await createMigratedDatabase();

    const columns = await client.execute('PRAGMA table_info("members")');
    expect(columns.rows).toContainEqual(
      expect.objectContaining({ name: "user_id", notnull: 0 }),
    );

    const foreignKeys = await client.execute(
      'PRAGMA foreign_key_list("members")',
    );
    expect(foreignKeys.rows).toContainEqual(
      expect.objectContaining({
        from: "user_id",
        table: "users",
        to: "id",
        on_delete: "SET NULL",
      }),
    );

    const indexes = await client.execute('PRAGMA index_list("members")');
    expect(indexes.rows).toContainEqual(
      expect.objectContaining({
        name: "members_group_user_unique",
        unique: 1,
      }),
    );

    const indexColumns = await client.execute(
      'PRAGMA index_info("members_group_user_unique")',
    );
    expect(indexColumns.rows.map((row) => row.name)).toEqual([
      "group_id",
      "user_id",
    ]);
  });

  it("rejects duplicate non-null user links within the same group", async () => {
    const client = await createMigratedDatabase();
    await insertUser(client, "user-1");
    await insertGroup(client, "group-1");
    await insertMember(client, "member-1", "group-1", "user-1");

    await expect(
      insertMember(client, "member-2", "group-1", "user-1"),
    ).rejects.toThrow(/unique/i);
  });

  it("allows the same user to link one member in a different group", async () => {
    const client = await createMigratedDatabase();
    await insertUser(client, "user-1");
    await insertGroup(client, "group-1");
    await insertGroup(client, "group-2");

    await expect(
      Promise.all([
        insertMember(client, "member-1", "group-1", "user-1"),
        insertMember(client, "member-2", "group-2", "user-1"),
      ]),
    ).resolves.toHaveLength(2);
  });

  it("allows multiple offline members in the same group", async () => {
    const client = await createMigratedDatabase();
    await insertGroup(client, "group-1");

    await expect(
      Promise.all([
        insertMember(client, "member-1", "group-1", null),
        insertMember(client, "member-2", "group-1", null),
      ]),
    ).resolves.toHaveLength(2);
  });

  it("unlinks a deleted user without deleting the member", async () => {
    const client = await createMigratedDatabase();
    await insertUser(client, "user-1");
    await insertGroup(client, "group-1");
    await insertMember(client, "member-1", "group-1", "user-1");

    await client.execute({
      sql: "DELETE FROM users WHERE id = ?",
      args: ["user-1"],
    });

    const result = await client.execute({
      sql: "SELECT id, user_id FROM members WHERE id = ?",
      args: ["member-1"],
    });
    expect(result.rows).toEqual([{ id: "member-1", user_id: null }]);
  });
});
