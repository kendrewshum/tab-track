import Image from "next/image";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { sql, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { expenseSplits, expenses, groupAccess, groups, members, settlements } from "@/db/schema";
import { formatCurrency, formatDate } from "@/lib/format";
import { requireUser } from "@/lib/server/session";
import {
  computeGroupPositions,
  summarizePositions,
  type GroupPosition,
  type Position,
} from "@/lib/user-position";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();

  const allGroups = await db
    .select({
      id: groups.id,
      name: groups.name,
      createdAt: groups.createdAt,
      memberCount: sql<number>`count(distinct ${members.id})`,
    })
    .from(groupAccess)
    .innerJoin(groups, eq(groupAccess.groupId, groups.id))
    .leftJoin(members, eq(members.groupId, groups.id))
    .where(eq(groupAccess.userId, user.id))
    .groupBy(groups.id)
    .orderBy(sql`${groups.createdAt} desc`);

  const groupIds = allGroups.map((group) => group.id);
  const positions = groupIds.length > 0 ? await loadGroupPositions(user.id, groupIds) : new Map();
  const overall = summarizePositions(Array.from(positions.values()));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Groups</h1>
        <Link
          href="/groups/new"
          className="flex items-center gap-1.5 bg-brand-600 text-white px-3 py-2 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          <Plus size={16} />
          New Group
        </Link>
      </div>

      {allGroups.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-center">
          <Image src="/tabtrack-mark.svg" alt="" width={56} height={56} className="h-14 w-14 mb-5" />
          <p className="text-slate-900 font-semibold text-lg">No groups yet</p>
          <p className="text-slate-500 text-sm mt-1 mb-6 max-w-xs">
            Create a group for a trip, a household, or anything you split with friends.
          </p>
          <Link
            href="/groups/new"
            className="inline-flex items-center gap-1.5 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus size={16} />
            Create your first group
          </Link>
        </div>
      ) : (
        <>
          {overall && <OverallSummary position={overall} />}

          <ul className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {allGroups.map((group) => (
              <li key={group.id}>
                <Link
                  href={`/groups/${group.id}`}
                  className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:bg-brand-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 truncate">{group.name}</p>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {group.memberCount} member{group.memberCount !== 1 ? "s" : ""} ·{" "}
                      {formatDate(group.createdAt)}
                    </p>
                  </div>
                  <GroupPositionLabel position={positions.get(group.id) ?? { kind: "unlinked" }} />
                  <ChevronRight size={18} className="shrink-0 text-slate-300" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function OverallSummary({ position }: { position: Position }) {
  const label =
    position.kind === "owed"
      ? "Across your groups you're owed"
      : position.kind === "owes"
        ? "Across your groups you owe"
        : "Across your groups";

  return (
    <section
      aria-label="Overall balance"
      className="rounded-2xl bg-brand-600 text-white px-5 py-4"
    >
      <p className="text-sm text-brand-100">{label}</p>
      <p className="mt-0.5 font-mono text-3xl font-medium tracking-tight tabular-nums">
        {position.kind === "settled" ? "All settled up" : formatCurrency(position.amount)}
      </p>
    </section>
  );
}

function GroupPositionLabel({ position }: { position: GroupPosition }) {
  if (position.kind === "unlinked") return null;

  if (position.kind === "settled") {
    return <span className="shrink-0 text-right text-xs text-slate-400">settled</span>;
  }

  const owed = position.kind === "owed";
  return (
    <span className="shrink-0 text-right">
      <span
        className={`block font-mono text-sm font-medium tabular-nums ${
          owed ? "text-positive" : "text-negative"
        }`}
      >
        {owed ? `+${formatCurrency(position.amount)}` : formatCurrency(-position.amount)}
      </span>
      <span className="block text-[11px] text-slate-500">{owed ? "you're owed" : "you owe"}</span>
    </span>
  );
}

async function loadGroupPositions(userId: string, groupIds: string[]) {
  const [memberRows, expenseRows, settlementRows] = await Promise.all([
    db
      .select({
        id: members.id,
        groupId: members.groupId,
        name: members.name,
        userId: members.userId,
      })
      .from(members)
      .where(inArray(members.groupId, groupIds)),
    db
      .select({
        id: expenses.id,
        groupId: expenses.groupId,
        amount: expenses.amount,
        paidById: expenses.paidById,
        deletedAt: expenses.deletedAt,
      })
      .from(expenses)
      .where(inArray(expenses.groupId, groupIds)),
    db
      .select({
        groupId: settlements.groupId,
        paidById: settlements.paidById,
        paidToId: settlements.paidToId,
        amount: settlements.amount,
      })
      .from(settlements)
      .where(inArray(settlements.groupId, groupIds)),
  ]);

  const liveExpenseIds = expenseRows.filter((e) => e.deletedAt === null).map((e) => e.id);
  const splitRows =
    liveExpenseIds.length > 0
      ? await db
          .select({
            expenseId: expenseSplits.expenseId,
            memberId: expenseSplits.memberId,
            amount: expenseSplits.amount,
          })
          .from(expenseSplits)
          .where(inArray(expenseSplits.expenseId, liveExpenseIds))
      : [];

  return computeGroupPositions({
    userId,
    groupIds,
    members: memberRows,
    expenses: expenseRows,
    splits: splitRows,
    settlements: settlementRows,
  });
}
