import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

import { db } from "@/db";
import { expenses, expenseSplits, groups, members, settlements } from "@/db/schema";
import { calculateBalances, simplifyDebts } from "@/lib/balances";
import { formatCurrency, formatDate, today } from "@/lib/format";
import { createSettlement, deleteSettlement } from "@/app/actions";

export default async function SettlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const group = await db.query.groups.findFirst({ where: eq(groups.id, id) });
  if (!group) notFound();

  const [groupMembers, groupExpenses, groupSettlements] = await Promise.all([
    db.select().from(members).where(eq(members.groupId, id)),
    db.select().from(expenses).where(eq(expenses.groupId, id)),
    db
      .select()
      .from(settlements)
      .where(eq(settlements.groupId, id))
      .orderBy(settlements.date),
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

  const settleAction = createSettlement.bind(null, id);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/groups/${id}`} className="text-sm text-green-600 hover:text-green-700">
          ← {group.name}
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Settle Up</h1>
      </div>

      {/* Suggested payments */}
      <section>
        <h2 className="font-semibold text-slate-900 mb-3">Suggested Payments</h2>
        {debts.length === 0 ? (
          <div className="text-center py-10 bg-green-50 border border-green-100 rounded-xl">
            <p className="text-2xl mb-1">✓</p>
            <p className="font-semibold text-green-800">All settled up!</p>
            <p className="text-sm text-green-600 mt-1">Everyone&apos;s balances are even</p>
          </div>
        ) : (
          <div className="space-y-3">
            {debts.map((debt, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-sm font-medium text-slate-800 mb-3">
                  <span className="font-bold">{debt.fromName}</span>
                  <span className="text-slate-500"> pays </span>
                  <span className="font-bold">{debt.toName}</span>
                  <span className="text-green-600 font-bold"> {formatCurrency(debt.amount)}</span>
                </p>
                <form action={settleAction}>
                  <input type="hidden" name="paidById" value={debt.fromId} />
                  <input type="hidden" name="paidToId" value={debt.toId} />
                  <input type="hidden" name="amount" value={debt.amount} />
                  <input type="hidden" name="date" value={today()} />
                  <button
                    type="submit"
                    className="w-full py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors"
                  >
                    Mark as Settled
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Manual payment */}
      <section>
        <h2 className="font-semibold text-slate-900 mb-3">Record a Payment</h2>
        <form
          action={settleAction}
          className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
              <select
                name="paidById"
                className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
              >
                {groupMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
              <select
                name="paidToId"
                className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
              >
                {groupMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Amount ($)</label>
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0.00"
                className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Date</label>
              <input
                name="date"
                type="date"
                required
                defaultValue={today()}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Note (optional)
            </label>
            <input
              name="note"
              placeholder="e.g. Venmo, cash"
              className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors"
          >
            Record Payment
          </button>
        </form>
      </section>

      {/* History */}
      {groupSettlements.length > 0 && (
        <section>
          <h2 className="font-semibold text-slate-900 mb-3">Payment History</h2>
          <div className="space-y-2">
            {[...groupSettlements].reverse().map((s) => (
              <div
                key={s.id}
                className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-start justify-between gap-3"
              >
                <div>
                  <p className="text-sm">
                    <span className="font-semibold">{memberMap.get(s.paidById)}</span>
                    <span className="text-slate-500"> paid </span>
                    <span className="font-semibold">{memberMap.get(s.paidToId)}</span>
                    <span className="font-bold text-green-600"> {formatCurrency(s.amount)}</span>
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formatDate(s.date)}
                    {s.note ? ` · ${s.note}` : ""}
                  </p>
                </div>
                <form action={deleteSettlement.bind(null, id, s.id)}>
                  <button
                    type="submit"
                    className="text-slate-300 hover:text-red-400 transition-colors text-lg leading-none"
                    title="Delete record"
                  >
                    ×
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
