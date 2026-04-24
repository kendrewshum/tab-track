import type { expenses, expenseSplits, members, settlements } from "@/db/schema";

type Member = typeof members.$inferSelect;
type Expense = typeof expenses.$inferSelect & {
  splits: (typeof expenseSplits.$inferSelect)[];
};
type Settlement = typeof settlements.$inferSelect;

export type Balance = {
  memberId: string;
  memberName: string;
  net: number; // positive = is owed money, negative = owes money
};

export type SimplifiedDebt = {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
};

export function calculateBalances(
  groupMembers: Member[],
  groupExpenses: Expense[],
  groupSettlements: Settlement[]
): Balance[] {
  const netMap = new Map<string, number>();
  for (const m of groupMembers) netMap.set(m.id, 0);

  for (const expense of groupExpenses) {
    netMap.set(expense.paidById, (netMap.get(expense.paidById) ?? 0) + expense.amount);
    for (const split of expense.splits) {
      netMap.set(split.memberId, (netMap.get(split.memberId) ?? 0) - split.amount);
    }
  }

  for (const s of groupSettlements) {
    netMap.set(s.paidById, (netMap.get(s.paidById) ?? 0) + s.amount);
    netMap.set(s.paidToId, (netMap.get(s.paidToId) ?? 0) - s.amount);
  }

  const nameMap = new Map(groupMembers.map((m) => [m.id, m.name]));

  return Array.from(netMap.entries()).map(([memberId, net]) => ({
    memberId,
    memberName: nameMap.get(memberId) ?? "Unknown",
    net: Math.round(net * 100) / 100,
  }));
}

// Greedy algorithm: minimises the number of transactions needed to settle up.
export function simplifyDebts(balances: Balance[]): SimplifiedDebt[] {
  const creditors = balances
    .filter((b) => b.net > 0.01)
    .map((b) => ({ ...b, remaining: b.net }))
    .sort((a, b) => b.remaining - a.remaining);

  const debtors = balances
    .filter((b) => b.net < -0.01)
    .map((b) => ({ ...b, remaining: b.net }))
    .sort((a, b) => a.remaining - b.remaining);

  const transactions: SimplifiedDebt[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.round(Math.min(-debtor.remaining, creditor.remaining) * 100) / 100;

    if (amount > 0) {
      transactions.push({
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

  return transactions;
}
