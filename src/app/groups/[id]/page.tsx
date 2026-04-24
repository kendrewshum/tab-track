import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";
import { Plus, ArrowRight } from "lucide-react";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { expenses, expenseSplits, groups, members, settlements } from "@/db/schema";
import { calculateBalances, simplifyDebts } from "@/lib/balances";
import { formatCurrency, formatDate } from "@/lib/format";
import { addMember, deleteExpense, deleteGroup } from "@/app/actions";

export default async function GroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const group = await db.query.groups.findFirst({ where: eq(groups.id, id) });
  if (!group) notFound();

  const [groupMembers, groupExpenses, groupSettlements] = await Promise.all([
    db.select().from(members).where(eq(members.groupId, id)),
    db
      .select()
      .from(expenses)
      .where(eq(expenses.groupId, id))
      .orderBy(expenses.date),
    db.select().from(settlements).where(eq(settlements.groupId, id)),
  ]);

  const expensesWithSplits = await Promise.all(
    groupExpenses.map(async (e) => ({
      ...e,
      splits: await db
        .select()
        .from(expenseSplits)
        .where(eq(expenseSplits.expenseId, e.id)),
    }))
  );

  const balances = calculateBalances(groupMembers, expensesWithSplits, groupSettlements);
  const debts = simplifyDebts(balances);
  const memberMap = new Map(groupMembers.map((m) => [m.id, m.name]));
  const totalSpend = groupExpenses.reduce((s, e) => s + e.amount, 0);

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
                    <p className="font-medium text-slate-900 truncate">{expense.description}</p>
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
                    <form action={deleteExpense.bind(null, id, expense.id)}>
                      <button
                        type="submit"
                        className="text-slate-300 hover:text-red-400 transition-colors text-lg leading-none"
                        title="Delete expense"
                      >
                        ×
                      </button>
                    </form>
                  </div>
                </div>
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

      {/* Danger zone */}
      <section className="pt-2">
        <form action={deleteGroup.bind(null, id)}>
          <button
            type="submit"
            className="text-xs text-slate-400 hover:text-red-500 transition-colors"
            onClick={(e) => {
              if (!confirm("Delete this group and all its expenses? This cannot be undone.")) {
                e.preventDefault();
              }
            }}
          >
            Delete group
          </button>
        </form>
      </section>
    </div>
  );
}
