// Core accounting logic: member balances and debt simplification.
//
// Types use only the fields this module needs, keeping it decoupled from the
// ORM layer and making unit tests straightforward — pass plain objects in,
// get plain objects out. Drizzle's inferred types satisfy these interfaces
// structurally, so no casting is needed at call sites.

export type Member = { id: string; name: string };
export type ExpenseSplit = { memberId: string; amount: number };
export type Expense = { amount: number; paidById: string; splits: ExpenseSplit[] };
export type Settlement = { paidById: string; paidToId: string; amount: number };

export type Balance = {
  memberId: string;
  memberName: string;
  net: number; // positive = others owe you; negative = you owe others
};

export type SimplifiedDebt = {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
};

/**
 * Compute each member's net balance across all expenses and settlements.
 *
 * Accounting model:
 *   paying for an expense  → credits you the full amount
 *   being in a split       → debits you your portion
 *   recording a settlement → credits the payer, debits the recipient
 *
 * Money is conserved: the sum of all net balances is always zero.
 */
export function calculateBalances(
  groupMembers: Member[],
  groupExpenses: Expense[],
  groupSettlements: Settlement[]
): Balance[] {
  const net = new Map<string, number>();
  for (const m of groupMembers) net.set(m.id, 0);

  for (const e of groupExpenses) {
    net.set(e.paidById, (net.get(e.paidById) ?? 0) + e.amount);
    for (const s of e.splits) {
      net.set(s.memberId, (net.get(s.memberId) ?? 0) - s.amount);
    }
  }

  for (const s of groupSettlements) {
    net.set(s.paidById, (net.get(s.paidById) ?? 0) + s.amount);
    net.set(s.paidToId, (net.get(s.paidToId) ?? 0) - s.amount);
  }

  const nameMap = new Map(groupMembers.map((m) => [m.id, m.name]));
  return Array.from(net.entries()).map(([id, amount]) => ({
    memberId: id,
    memberName: nameMap.get(id) ?? "Unknown",
    net: Math.round(amount * 100) / 100,
  }));
}

/**
 * Reduce balances to the minimum number of payments needed to settle all
 * debts (greedy algorithm).
 *
 * Algorithm: sort creditors (net > 0) and debtors (net < 0) by absolute
 * value descending. Greedily match each debtor against the largest creditor,
 * paying min(debtor's debt, creditor's credit). Advance whichever side
 * reaches zero.
 *
 * This greedy approach doesn't guarantee the globally optimal solution
 * (which is NP-hard in general) but minimises transactions for the vast
 * majority of real-world groups of ≤ 20 people.
 */
export function simplifyDebts(balances: Balance[]): SimplifiedDebt[] {
  const creditors = balances
    .filter((b) => b.net > 0.01)
    .map((b) => ({ ...b, remaining: b.net }))
    .sort((a, b) => b.remaining - a.remaining);

  const debtors = balances
    .filter((b) => b.net < -0.01)
    .map((b) => ({ ...b, remaining: b.net }))
    .sort((a, b) => a.remaining - b.remaining);

  const result: SimplifiedDebt[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.round(Math.min(-debtor.remaining, creditor.remaining) * 100) / 100;

    if (amount > 0) {
      result.push({
        fromId: debtor.memberId,
        fromName: debtor.memberName,
        toId: creditor.memberId,
        toName: creditor.memberName,
        amount,
      });
    }

    debtor.remaining += amount;
    creditor.remaining -= amount;

    if (Math.abs(debtor.remaining) < 0.01) i++;
    if (Math.abs(creditor.remaining) < 0.01) j++;
  }

  return result;
}
