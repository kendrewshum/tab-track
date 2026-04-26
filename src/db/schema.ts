import { sql } from "drizzle-orm";
import { foreignKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

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
