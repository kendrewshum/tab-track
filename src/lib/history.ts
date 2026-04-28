export type ExpenseSnapshot = {
  description: string;
  amount: number;
  paidById: string;
  splitType: "equal" | "shares" | "percentage" | "exact";
  date: string;
  splits: { memberId: string; amount: number }[];
};

export type ExpenseRevision = {
  id: string;
  expenseId: string;
  beforeSnapshot: string;
  afterSnapshot: string;
  createdAt: string;
};

export type ActivityExpense = {
  id: string;
  description: string;
  amount: number;
  paidById: string;
  splitType: ExpenseSnapshot["splitType"];
  date: string;
  createdAt: string;
};

export type ActivitySettlement = {
  id: string;
  paidById: string;
  paidToId: string;
  amount: number;
  note: string | null;
  date: string;
  createdAt: string;
  reversalOfSettlementId: string | null;
};

export type ActivityEvent =
  | {
      id: string;
      type: "expense_created";
      occurredAt: string;
      expenseId: string;
      expense: ActivityExpense;
    }
  | {
      id: string;
      type: "expense_edited";
      occurredAt: string;
      expenseId: string;
      revisionId: string;
      before: ExpenseSnapshot;
      after: ExpenseSnapshot;
    }
  | {
      id: string;
      type: "settlement_recorded" | "settlement_reversed";
      occurredAt: string;
      settlementId: string;
      paidById: string;
      paidToId: string;
      amount: number;
      note: string | null;
      date: string;
      reversalOfSettlementId: string | null;
    };

export const DEFAULT_ACTIVITY_CHUNK_SIZE = 20;

export function serializeExpenseSnapshot(snapshot: ExpenseSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseExpenseSnapshot(serialized: string): ExpenseSnapshot {
  return JSON.parse(serialized) as ExpenseSnapshot;
}

export function createExpenseSnapshot(
  expense: Omit<ExpenseSnapshot, "splits">,
  splits: ExpenseSnapshot["splits"]
): ExpenseSnapshot {
  return {
    ...expense,
    splits: splits.map((split) => ({ ...split })),
  };
}

export function getActivityVisibleCount(
  requestedCount: number | undefined,
  chunkSize = DEFAULT_ACTIVITY_CHUNK_SIZE
): number {
  if (requestedCount === undefined) {
    return chunkSize;
  }

  if (!Number.isFinite(requestedCount) || !Number.isInteger(requestedCount) || requestedCount < chunkSize) {
    return chunkSize;
  }

  return Math.ceil(requestedCount / chunkSize) * chunkSize;
}

export function buildActivityArchive<T>(
  items: T[],
  visibleCount: number,
  chunkSize = DEFAULT_ACTIVITY_CHUNK_SIZE
): {
  visibleItems: T[];
  hasMore: boolean;
  nextVisibleCount: number;
} {
  const safeVisibleCount = Math.max(visibleCount, chunkSize);
  const visibleItems = items.slice(0, safeVisibleCount);

  return {
    visibleItems,
    hasMore: items.length > visibleItems.length,
    nextVisibleCount: safeVisibleCount + chunkSize,
  };
}

export function buildActivityEvents({
  expenses,
  revisions,
  settlements,
}: {
  expenses: ActivityExpense[];
  revisions: ExpenseRevision[];
  settlements: ActivitySettlement[];
}): ActivityEvent[] {
  const events: ActivityEvent[] = [
    ...expenses.map((expense) => ({
      id: `expense-created-${expense.id}`,
      type: "expense_created" as const,
      occurredAt: expense.createdAt,
      expenseId: expense.id,
      expense,
    })),
    ...revisions.map((revision) => ({
      id: `expense-edited-${revision.id}`,
      type: "expense_edited" as const,
      occurredAt: revision.createdAt,
      expenseId: revision.expenseId,
      revisionId: revision.id,
      before: parseExpenseSnapshot(revision.beforeSnapshot),
      after: parseExpenseSnapshot(revision.afterSnapshot),
    })),
    ...settlements.map((settlement) => {
      const type: "settlement_recorded" | "settlement_reversed" =
        settlement.reversalOfSettlementId ? "settlement_reversed" : "settlement_recorded";

      return {
        id: `settlement-${settlement.id}`,
        type,
        occurredAt: settlement.createdAt,
        settlementId: settlement.id,
        paidById: settlement.paidById,
        paidToId: settlement.paidToId,
        amount: settlement.amount,
        note: settlement.note,
        date: settlement.date,
        reversalOfSettlementId: settlement.reversalOfSettlementId,
      };
    }),
  ];

  return events.sort((a, b) => {
    const occurredAtDifference = toTimestampMs(b.occurredAt) - toTimestampMs(a.occurredAt);
    if (occurredAtDifference !== 0) {
      return occurredAtDifference;
    }

    const businessDateDifference = toTimestampMs(getActivitySortDate(b)) - toTimestampMs(getActivitySortDate(a));
    if (businessDateDifference !== 0) {
      return businessDateDifference;
    }

    return b.id.localeCompare(a.id);
  });
}

export function hasExpenseEditsAfterSettlementStarted(
  revisions: Pick<ExpenseRevision, "createdAt">[],
  settlements: Pick<ActivitySettlement, "createdAt">[]
): boolean {
  if (revisions.length === 0 || settlements.length === 0) return false;

  const firstSettlementAt = Math.min(...settlements.map((settlement) => toTimestampMs(settlement.createdAt)));
  return revisions.some((revision) => toTimestampMs(revision.createdAt) >= firstSettlementAt);
}

export function getPostSettlementEditedExpenseIds(
  revisions: Pick<ExpenseRevision, "expenseId" | "createdAt">[],
  settlements: Pick<ActivitySettlement, "createdAt">[]
): Set<string> {
  if (revisions.length === 0 || settlements.length === 0) return new Set();

  const firstSettlementAt = Math.min(...settlements.map((settlement) => toTimestampMs(settlement.createdAt)));
  return new Set(
    revisions
      .filter((revision) => toTimestampMs(revision.createdAt) >= firstSettlementAt)
      .map((revision) => revision.expenseId)
  );
}

function toTimestampMs(value: string): number {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  return new Date(normalized).getTime();
}

function getActivitySortDate(event: ActivityEvent): string {
  switch (event.type) {
    case "expense_created":
      return event.expense.date;
    case "expense_edited":
      return event.after.date;
    case "settlement_recorded":
    case "settlement_reversed":
      return event.date;
  }
}
