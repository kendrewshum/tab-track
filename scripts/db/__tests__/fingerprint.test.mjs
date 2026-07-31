import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";
import { buildFingerprint, diffFingerprints } from "../fingerprint.mjs";

const clients = [];

afterEach(() => {
  while (clients.length > 0) clients.pop()?.close();
});

function newClient() {
  const client = createClient({ url: ":memory:" });
  clients.push(client);
  return client;
}

async function seed(statements) {
  const client = newClient();
  for (const statement of statements) await client.execute(statement);
  return client;
}

const USERS = "CREATE TABLE `users` (`id` text PRIMARY KEY NOT NULL, `email` text NOT NULL)";
const EMAIL_INDEX = "CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`)";

describe("buildFingerprint", () => {
  it("captures columns, foreign keys and explicit indexes", async () => {
    const client = await seed([
      USERS,
      EMAIL_INDEX,
      "CREATE TABLE `groups` (`id` text PRIMARY KEY NOT NULL, `owner` text REFERENCES users(id) ON DELETE SET NULL)",
    ]);

    const fingerprint = await buildFingerprint(client);

    expect(Object.keys(fingerprint).sort()).toEqual(["groups", "users"]);
    expect(fingerprint.users.columns.email).toEqual({
      type: "TEXT",
      notNull: 1,
      default: null,
      primaryKey: 0,
    });
    expect(fingerprint.users.indexes.users_email_unique).toEqual({
      unique: 1,
      columns: ["email"],
    });
    expect(fingerprint.groups.foreignKeys).toEqual([
      "owner->users.id upd=NO ACTION del=SET NULL",
    ]);
  });

  it("ignores column order so db:push and migration builds compare equal", async () => {
    const a = await seed(["CREATE TABLE `t` (`x` text NOT NULL, `y` text)"]);
    const b = await seed(["CREATE TABLE `t` (`y` text, `x` text NOT NULL)"]);

    expect(diffFingerprints(await buildFingerprint(a), await buildFingerprint(b))).toEqual([]);
  });

  it("excludes the drizzle ledger so a migrated database still matches a replay", async () => {
    const client = await seed([
      USERS,
      "CREATE TABLE `__drizzle_migrations` (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
    ]);

    expect(Object.keys(await buildFingerprint(client))).toEqual(["users"]);
  });

  it("keys implicit indexes by what they constrain, not their positional name", async () => {
    const a = await seed(["CREATE TABLE `t` (`id` text PRIMARY KEY NOT NULL, `k` text UNIQUE)"]);
    const b = await seed(["CREATE TABLE `t` (`id` text PRIMARY KEY NOT NULL, `k` text UNIQUE)"]);

    expect(diffFingerprints(await buildFingerprint(a), await buildFingerprint(b))).toEqual([]);
  });
});

describe("diffFingerprints", () => {
  it("names a changed foreign key action", async () => {
    const expected = await buildFingerprint(
      await seed([USERS, "CREATE TABLE `g` (`o` text REFERENCES users(id) ON DELETE SET NULL)"]),
    );
    const actual = await buildFingerprint(
      await seed([USERS, "CREATE TABLE `g` (`o` text REFERENCES users(id))"]),
    );

    const diff = diffFingerprints(expected, actual);

    expect(diff).toHaveLength(1);
    expect(diff[0]).toContain("g foreign keys");
    expect(diff[0]).toContain("del=SET NULL");
    expect(diff[0]).toContain("del=NO ACTION");
  });

  it("names a missing table, a missing index and a changed column", async () => {
    const expected = await buildFingerprint(await seed([USERS, EMAIL_INDEX]));
    const actual = await buildFingerprint(
      await seed(["CREATE TABLE `users` (`id` text PRIMARY KEY NOT NULL, `email` text)"]),
    );

    const diff = diffFingerprints(expected, actual).join("\n");

    expect(diff).toContain("users.email");
    expect(diff).toContain("users_email_unique");
  });

  it("reports an unexpected extra table", async () => {
    const expected = await buildFingerprint(await seed([USERS]));
    const actual = await buildFingerprint(await seed([USERS, "CREATE TABLE `extra` (`id` text)"]));

    expect(diffFingerprints(expected, actual).join("\n")).toContain("extra");
  });
});
