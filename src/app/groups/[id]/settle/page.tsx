import { notFound } from "next/navigation";
import Link from "next/link";
import { eq, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

import { db } from "@/db";
import { expenseRevisions, expenseSplits, expenses, groups, members, settlements } from "@/db/schema";
import { calculateBalances, simplifyDebts } from "@/lib/balances";
import { formatCurrency, formatDate, today } from "@/lib/format";
import { requireGroupAccess } from "@/lib/server/session";
import { hasExpenseEditsAfterSettlementStarted } from "@/lib/history";
import { generateId } from "@/lib/utils";
import { createSettlement, reverseSettlement } from "@/app/actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { ConfirmDeleteButton } from "../confirm-delete-button";

type MemberRow = typeof members.$inferSelect;
type ExpenseRow = typeof expenses.$inferSelect;
type SettlementRow = typeof settlements.$inferSelect;
type ExpenseSplitRow = typeof expenseSplits.$inferSelect;
type ExpenseRevisionRow = typeof expenseRevisions.$inferSelect;

export default async function SettlePage({
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
    db.select().from(expenses).where(eq(expenses.groupId, id)),
    db
      .select()
      .from(settlements)
      .where(eq(settlements.groupId, id))
      .orderBy(settlements.date),
  ]);

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

  const expensesWithSplits = groupExpenses.map((expense) => ({
    ...expense,
    splits: splitsByExpenseId.get(expense.id) ?? [],
  }));

  const balances = calculateBalances(groupMembers, expensesWithSplits, groupSettlements);
  const debts = simplifyDebts(balances);
  const memberMap = new Map(groupMembers.map((m) => [m.id, m.name]));
  const showReopenedLedgerWarning =
    debts.length > 0 &&
    hasExpenseEditsAfterSettlementStarted(groupExpenseRevisions, groupSettlements);
  const reversedSettlementIds = new Set(
    groupSettlements
      .filter((settlement) => settlement.reversalOfSettlementId)
      .map((settlement) => settlement.reversalOfSettlementId as string)
  );
  const settlementActivity = [...groupSettlements].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  );

  const settleAction = createSettlement.bind(null, id);
  const manualSettlementSubmissionToken = generateId();

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/groups/${id}`} className="text-sm text-green-600 hover:text-green-700">
          ← {group.name}
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Settle Up</h1>
      </div>

      {showReopenedLedgerWarning && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm font-medium text-amber-900">
            Payments remain in your history, but edited expenses reopened the current
            ledger.
          </p>
          <p className="text-sm text-amber-800 mt-1">
            Earlier payments stay recorded. If the balances below still show debt, record
            another payment to settle the current ledger.
          </p>
        </div>
      )}

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
                  <input type="hidden" name="_submissionToken" value={generateId()} />
                  <input type="hidden" name="paidById" value={debt.fromId} />
                  <input type="hidden" name="paidToId" value={debt.toId} />
                  <input type="hidden" name="amount" value={debt.amount} />
                  <input type="hidden" name="date" value={today()} />
                  <PendingSubmitButton
                    pendingLabel="Recording..."
                    className="w-full py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors"
                  >
                    Mark as Settled
                  </PendingSubmitButton>
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
          <input
            type="hidden"
            name="_submissionToken"
            value={manualSettlementSubmissionToken}
          />
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
          <PendingSubmitButton
            pendingLabel="Recording..."
            className="w-full py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors"
          >
            Record Payment
          </PendingSubmitButton>
        </form>
      </section>

      {/* Settlement Activity */}
      {settlementActivity.length > 0 && (
        <section>
          <h2 className="font-semibold text-slate-900 mb-1">Settlement Activity</h2>
          <p className="text-sm text-slate-500 mb-3">
            Settlement records stay in the ledger. If an older expense changes later, add
            another payment instead of rewriting history.
          </p>
          <div className="space-y-2">
            {settlementActivity.map((s) => (
              <div
                key={s.id}
                className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-start justify-between gap-3"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900 mb-1">
                    {s.reversalOfSettlementId ? "Payment reversed" : "Payment recorded"}
                  </p>
                  <p className="text-sm">
                    <span className="font-semibold">{memberMap.get(s.paidById)}</span>
                    <span className="text-slate-500"> paid </span>
                    <span className="font-semibold">{memberMap.get(s.paidToId)}</span>
                    <span
                      className={`font-bold ${
                        s.reversalOfSettlementId ? "text-amber-700" : "text-green-600"
                      }`}
                    >
                      {" "}
                      {formatCurrency(s.amount)}
                    </span>
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formatDate(s.date)}
                    {s.note ? ` · ${s.note}` : ""}
                  </p>
                </div>
                {!s.reversalOfSettlementId && !reversedSettlementIds.has(s.id) && (
                  <ConfirmDeleteButton
                    action={reverseSettlement.bind(null, id, s.id)}
                    message="Record a reversing payment for this entry?"
                    pendingLabel="Reversing..."
                    className="text-sm text-amber-700 hover:text-amber-800 font-medium transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                    title="Reverse payment"
                  >
                    Reverse payment
                  </ConfirmDeleteButton>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
