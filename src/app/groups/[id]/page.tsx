import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";
import { Plus, ArrowRight, Pencil } from "lucide-react";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  expenseRevisions,
  expenseSplits,
  expenses,
  groupAccess,
  groups,
  members,
  settlements,
  users,
} from "@/db/schema";
import { calculateBalances, simplifyDebts } from "@/lib/balances";
import { formatCurrency, formatDate } from "@/lib/format";
import { buildGroupShareList } from "@/lib/group-shares";
import { requireGroupAccess } from "@/lib/server/session";
import { buildActivityEvents, getPostSettlementEditedExpenseIds } from "@/lib/history";
import { addMember, deleteExpense } from "@/app/actions";
import { DeleteGroupButton } from "./delete-group-button";
import { ConfirmDeleteButton } from "./confirm-delete-button";
import { InviteUserForm } from "./invite-user-form";

type MemberRow = typeof members.$inferSelect;
type ExpenseRow = typeof expenses.$inferSelect;
type SettlementRow = typeof settlements.$inferSelect;
type ExpenseSplitRow = typeof expenseSplits.$inferSelect;
type ExpenseRevisionRow = typeof expenseRevisions.$inferSelect;

export default async function GroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireGroupAccess(id);

  const group = await db.query.groups.findFirst({ where: eq(groups.id, id) });
  if (!group) notFound();

  const [groupMembers, groupExpenses, groupSettlements]: [
    MemberRow[],
    ExpenseRow[],
    SettlementRow[],
  ] = await Promise.all([
    db.select().from(members).where(eq(members.groupId, id)),
    db
      .select()
      .from(expenses)
      .where(eq(expenses.groupId, id))
      .orderBy(expenses.date),
    db.select().from(settlements).where(eq(settlements.groupId, id)),
  ]);
  const sharedUsers = buildGroupShareList(
    (
      await db
        .select({
          email: users.email,
          role: groupAccess.role,
        })
        .from(groupAccess)
        .innerJoin(users, eq(groupAccess.userId, users.id))
        .where(eq(groupAccess.groupId, id))
    ).map((share) => ({
      email: share.email,
      role: share.role,
    }))
  );

  const expenseIds = groupExpenses.map((expense) => expense.id);
  const [groupExpenseSplits, groupExpenseRevisions]: [ExpenseSplitRow[], ExpenseRevisionRow[]] =
    await Promise.all([
    expenseIds.length > 0
      ? db.select().from(expenseSplits).where(inArray(expenseSplits.expenseId, expenseIds))
      : Promise.resolve([] as ExpenseSplitRow[]),
    expenseIds.length > 0
      ? db.select().from(expenseRevisions).where(inArray(expenseRevisions.expenseId, expenseIds))
      : Promise.resolve([] as ExpenseRevisionRow[]),
    ]);

  const splitsByExpenseId = new Map<string, ExpenseSplitRow[]>();
  for (const split of groupExpenseSplits) {
    const existing = splitsByExpenseId.get(split.expenseId);
    if (existing) {
      existing.push(split);
    } else {
      splitsByExpenseId.set(split.expenseId, [split]);
    }
  }

  const revisionsByExpenseId = new Map<string, ExpenseRevisionRow[]>();
  for (const revision of groupExpenseRevisions) {
    const existing = revisionsByExpenseId.get(revision.expenseId);
    if (existing) {
      existing.push(revision);
    } else {
      revisionsByExpenseId.set(revision.expenseId, [revision]);
    }
  }

  const expensesWithSplits = groupExpenses.map((expense) => ({
    ...expense,
    splits: splitsByExpenseId.get(expense.id) ?? [],
  }));

  const balances = calculateBalances(groupMembers, expensesWithSplits, groupSettlements);
  const debts = simplifyDebts(balances);
  const memberMap = new Map(groupMembers.map((m) => [m.id, m.name]));
  const totalSpend = groupExpenses.reduce((s, e) => s + e.amount, 0);
  const editedExpenseIds = new Set(groupExpenseRevisions.map((revision) => revision.expenseId));
  const postSettlementEditedExpenseIds = getPostSettlementEditedExpenseIds(
    groupExpenseRevisions,
    groupSettlements
  );
  const activityEvents = buildActivityEvents({
    expenses: groupExpenses,
    revisions: groupExpenseRevisions,
    settlements: groupSettlements,
  });

  const addMemberAction = addMember.bind(null, id);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-green-600 hover:text-green-700">
            ← Groups
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">{group.name}</h1>
          <p className="text-sm text-slate-500">
            {groupMembers.length} members · {formatCurrency(totalSpend)} total spent
          </p>
        </div>
        <Link
          href={`/groups/${id}/expenses/new`}
          className="flex-shrink-0 flex items-center gap-1.5 bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
        >
          <Plus size={16} />
          Expense
        </Link>
      </div>

      {/* Balances */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-900">Balances</h2>
          {debts.length > 0 && (
            <Link
              href={`/groups/${id}/settle`}
              className="flex items-center gap-1 text-sm text-green-600 font-medium hover:text-green-700"
            >
              Settle up <ArrowRight size={14} />
            </Link>
          )}
        </div>
        <div className="space-y-1.5">
          {balances.map((b) => (
            <div
              key={b.memberId}
              className="flex items-center justify-between bg-white rounded-lg border border-slate-200 px-4 py-2.5"
            >
              <span className="text-sm font-medium text-slate-800">{b.memberName}</span>
              <span
                className={`text-sm font-semibold ${
                  b.net > 0.01
                    ? "text-green-600"
                    : b.net < -0.01
                    ? "text-red-500"
                    : "text-slate-400"
                }`}
              >
                {b.net > 0.01
                  ? `+${formatCurrency(b.net)}`
                  : b.net < -0.01
                  ? formatCurrency(b.net)
                  : "settled up"}
              </span>
            </div>
          ))}
        </div>
        {debts.length > 0 && (
          <div className="mt-3 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 space-y-1.5">
            {debts.map((d, i) => (
              <p key={i} className="text-sm text-slate-600">
                <span className="font-semibold text-slate-800">{d.fromName}</span>
                {" owes "}
                <span className="font-semibold text-slate-800">{d.toName}</span>
                {"  "}
                <span className="font-bold text-slate-900">{formatCurrency(d.amount)}</span>
              </p>
            ))}
          </div>
        )}
        {debts.length === 0 && groupExpenses.length > 0 && (
          <p className="text-center text-sm text-green-600 font-medium mt-3">
            ✓ All settled up!
          </p>
        )}
      </section>

      {/* Expenses */}
      <section>
        <h2 className="font-semibold text-slate-900 mb-3">Expenses</h2>
        {expensesWithSplits.length === 0 ? (
          <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-xl">
            <p className="text-slate-400 text-sm">No expenses yet</p>
            <Link
              href={`/groups/${id}/expenses/new`}
              className="mt-2 inline-flex items-center gap-1 text-sm text-green-600 font-medium hover:text-green-700"
            >
              <Plus size={14} /> Add first expense
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {[...expensesWithSplits].reverse().map((expense) => (
              <div
                key={expense.id}
                className="bg-white rounded-xl border border-slate-200 px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-slate-900 truncate">{expense.description}</p>
                      {editedExpenseIds.has(expense.id) && (
                        <span className="text-[11px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                          Edited
                        </span>
                      )}
                      {postSettlementEditedExpenseIds.has(expense.id) && (
                        <span className="text-[11px] font-medium bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                          Edited after payments were recorded
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Paid by {memberMap.get(expense.paidById)} · {formatDate(expense.date)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {expense.splits.map((s) => (
                        <span
                          key={s.id}
                          className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full"
                        >
                          {memberMap.get(s.memberId)}: {formatCurrency(s.amount)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="font-semibold text-slate-900">
                      {formatCurrency(expense.amount)}
                    </span>
                    <Link
                      href={`/groups/${id}/expenses/${expense.id}/edit`}
                      className="text-slate-300 hover:text-slate-500 transition-colors"
                      title="Edit expense"
                    >
                      <Pencil size={14} />
                    </Link>
                    <ConfirmDeleteButton
                      action={deleteExpense.bind(null, id, expense.id)}
                      message="Delete this expense? This cannot be undone."
                      className="text-slate-300 hover:text-red-400 transition-colors text-lg leading-none"
                      title="Delete expense"
                    >
                      ×
                    </ConfirmDeleteButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Activity */}
      <section>
        <h2 className="font-semibold text-slate-900 mb-1">Activity</h2>
        <p className="text-sm text-slate-500 mb-3">
          Payments stay in history even if older expenses are edited later. If the current
          ledger shows debt again, record another payment.
        </p>
        {activityEvents.length === 0 ? (
          <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-xl">
            <p className="text-slate-400 text-sm">No activity yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activityEvents.map((event) => (
              <div
                key={event.id}
                className="bg-white rounded-xl border border-slate-200 px-4 py-3 space-y-1"
              >
                {event.type === "expense_created" && (
                  <>
                    <p className="text-sm font-medium text-slate-900">
                      Expense added: {event.expense.description}
                    </p>
                    <p className="text-sm text-slate-600">
                      {memberMap.get(event.expense.paidById)} paid{" "}
                      <span className="font-semibold">{formatCurrency(event.expense.amount)}</span>
                    </p>
                    <p className="text-xs text-slate-400">{formatDate(event.expense.date)}</p>
                  </>
                )}
                {event.type === "expense_edited" && (
                  <>
                    <p className="text-sm font-medium text-slate-900">Expense edited</p>
                    <p className="text-sm text-slate-700">{event.after.description}</p>
                    <p className="text-xs text-slate-500">
                      {formatCurrency(event.before.amount)} → {formatCurrency(event.after.amount)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatDate(event.after.date)}
                      {event.before.description !== event.after.description
                        ? ` · renamed from ${event.before.description}`
                        : ""}
                    </p>
                  </>
                )}
                {event.type === "settlement_recorded" && (
                  <>
                    <p className="text-sm font-medium text-slate-900">Payment recorded</p>
                    <p className="text-sm text-slate-600">
                      <span className="font-semibold">{memberMap.get(event.paidById)}</span>
                      <span className="text-slate-500"> paid </span>
                      <span className="font-semibold">{memberMap.get(event.paidToId)}</span>
                      <span className="font-semibold text-green-600">
                        {" "}
                        {formatCurrency(event.amount)}
                      </span>
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatDate(event.date)}
                      {event.note ? ` · ${event.note}` : ""}
                    </p>
                  </>
                )}
                {event.type === "settlement_reversed" && (
                  <>
                    <p className="text-sm font-medium text-slate-900">Payment reversed</p>
                    <p className="text-sm text-slate-600">
                      <span className="font-semibold">{memberMap.get(event.paidById)}</span>
                      <span className="text-slate-500"> paid </span>
                      <span className="font-semibold">{memberMap.get(event.paidToId)}</span>
                      <span className="font-semibold text-amber-700">
                        {" "}
                        {formatCurrency(event.amount)}
                      </span>
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatDate(event.date)}
                      {event.note ? ` · ${event.note}` : ""}
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Members */}
      <section>
        <h2 className="font-semibold text-slate-900 mb-3">Members</h2>
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {groupMembers.map((m) => (
            <div key={m.id} className="px-4 py-2.5 text-sm text-slate-700">
              {m.name}
            </div>
          ))}
          <form action={addMemberAction} className="flex gap-2 p-3">
            <input
              name="name"
              placeholder="Add a member…"
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
            <button
              type="submit"
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Add
            </button>
          </form>
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900 mb-3">App Access</h2>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-sm text-slate-500 mb-3">
            Share this group with friends who already created an account.
          </p>
          <InviteUserForm groupId={id} />
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-medium text-slate-900">Shared with</h3>
            <div className="mt-2 space-y-2">
              {sharedUsers.map((sharedUser) => (
                <p key={sharedUser.email} className="text-sm text-slate-600">
                  {sharedUser.email}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Danger zone */}
      <section className="pt-2">
        <DeleteGroupButton groupId={id} />
      </section>
    </div>
  );
}
