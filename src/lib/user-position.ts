// Where the signed-in user stands in each of their groups, and overall.
//
// A user "is" the member row linked to their account (members.userId). Groups
// where no member is linked to the user have no position: we can't tell which
// balance is theirs, so they are left out of the overall total.

import { calculateBalances, type Balance } from "./balances";

const EPSILON = 0.01;

export type Position =
  | { kind: "owed"; amount: number } // others owe the user
  | { kind: "owes"; amount: number } // the user owes others
  | { kind: "settled" };

export type GroupPosition = Position | { kind: "unlinked" };

export function toPosition(net: number): Position {
  const rounded = Math.round(net * 100) / 100;
  if (rounded > EPSILON) return { kind: "owed", amount: rounded };
  if (rounded < -EPSILON) return { kind: "owes", amount: -rounded };
  return { kind: "settled" };
}

export function getGroupPosition(
  balances: Balance[],
  userMemberId: string | null | undefined,
): GroupPosition {
  if (!userMemberId) return { kind: "unlinked" };
  const balance = balances.find((b) => b.memberId === userMemberId);
  if (!balance) return { kind: "unlinked" };
  return toPosition(balance.net);
}

/** Overall position across groups; null when the user is linked in none of them. */
export function summarizePositions(positions: GroupPosition[]): Position | null {
  let linked = 0;
  let net = 0;
  for (const position of positions) {
    if (position.kind === "unlinked") continue;
    linked += 1;
    if (position.kind === "owed") net += position.amount;
    if (position.kind === "owes") net -= position.amount;
  }
  return linked === 0 ? null : toPosition(net);
}

type GroupMemberRow = { id: string; groupId: string; name: string; userId: string | null };
type GroupExpenseRow = {
  id: string;
  groupId: string;
  amount: number;
  paidById: string;
  deletedAt: string | null;
};
type GroupSplitRow = { expenseId: string; memberId: string; amount: number };
type GroupSettlementRow = { groupId: string; paidById: string; paidToId: string; amount: number };

/**
 * The user's position in each group, computed the same way the group page computes
 * balances: deleted expenses are ignored and every settlement row counts.
 */
export function computeGroupPositions(input: {
  userId: string;
  groupIds: string[];
  members: GroupMemberRow[];
  expenses: GroupExpenseRow[];
  splits: GroupSplitRow[];
  settlements: GroupSettlementRow[];
}): Map<string, GroupPosition> {
  const splitsByExpense = new Map<string, GroupSplitRow[]>();
  for (const split of input.splits) {
    const list = splitsByExpense.get(split.expenseId) ?? [];
    list.push(split);
    splitsByExpense.set(split.expenseId, list);
  }

  const result = new Map<string, GroupPosition>();
  for (const groupId of input.groupIds) {
    const groupMembers = input.members.filter((m) => m.groupId === groupId);
    const userMember = groupMembers.find((m) => m.userId === input.userId);
    if (!userMember) {
      result.set(groupId, { kind: "unlinked" });
      continue;
    }

    const groupExpenses = input.expenses
      .filter((e) => e.groupId === groupId && e.deletedAt === null)
      .map((e) => ({ ...e, splits: splitsByExpense.get(e.id) ?? [] }));
    const groupSettlements = input.settlements.filter((s) => s.groupId === groupId);

    const balances = calculateBalances(groupMembers, groupExpenses, groupSettlements);
    result.set(groupId, getGroupPosition(balances, userMember.id));
  }
  return result;
}
