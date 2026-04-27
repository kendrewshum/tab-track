import { sql } from "drizzle-orm";
import { foreignKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { CREATE_ACTION_KINDS } from "@/lib/idempotency";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    emailUniqueIndex: uniqueIndex("users_email_unique").on(table.email),
  })
);

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdByUserId: text("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const groupAccess = sqliteTable(
  "group_access",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] }).notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    groupUserUniqueIndex: uniqueIndex("group_access_group_user_unique").on(
      table.groupId,
      table.userId
    ),
  })
);

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const expenses = sqliteTable("expenses", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  amount: real("amount").notNull(),
  paidById: text("paid_by_id")
    .notNull()
    .references(() => members.id),
  splitType: text("split_type", {
    enum: ["equal", "shares", "percentage", "exact"],
  }).notNull(),
  date: text("date").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const expenseSplits = sqliteTable("expense_splits", {
  id: text("id").primaryKey(),
  expenseId: text("expense_id")
    .notNull()
    .references(() => expenses.id, { onDelete: "cascade" }),
  memberId: text("member_id")
    .notNull()
    .references(() => members.id),
  amount: real("amount").notNull(),
});

export const expenseRevisions = sqliteTable("expense_revisions", {
  id: text("id").primaryKey(),
  expenseId: text("expense_id")
    .notNull()
    .references(() => expenses.id, { onDelete: "cascade" }),
  beforeSnapshot: text("before_snapshot").notNull(),
  afterSnapshot: text("after_snapshot").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const settlements = sqliteTable(
  "settlements",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    paidById: text("paid_by_id")
      .notNull()
      .references(() => members.id),
    paidToId: text("paid_to_id")
      .notNull()
      .references(() => members.id),
    amount: real("amount").notNull(),
    note: text("note"),
    reversalOfSettlementId: text("reversal_of_settlement_id"),
    date: text("date").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    foreignKey({
      columns: [table.reversalOfSettlementId],
      foreignColumns: [table.id],
    }),
  ]
);

export const idempotentSubmissions = sqliteTable(
  "idempotent_submissions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actionKind: text("action_kind", {
      enum: CREATE_ACTION_KINDS,
    }).notNull(),
    submissionToken: text("submission_token").notNull(),
    redirectPath: text("redirect_path").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    userActionTokenUniqueIndex: uniqueIndex(
      "idempotent_submissions_user_action_token_unique"
    ).on(table.userId, table.actionKind, table.submissionToken),
  })
);
