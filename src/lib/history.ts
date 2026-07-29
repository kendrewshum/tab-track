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
  deletedAt?: string | null;
  deletedByUserId?: string | null;
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
      type: "expense_deleted";
      occurredAt: string;
      expenseId: string;
      description: string;
      date: string;
      deletedByUserId: string | null;
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
  const revisionsByExpenseId = new Map<string, ExpenseRevision[]>();
  for (const revision of revisions) {
    const expenseRevisions = revisionsByExpenseId.get(revision.expenseId) ?? [];
    expenseRevisions.push(revision);
    revisionsByExpenseId.set(revision.expenseId, expenseRevisions);
  }

  const revisionChronologyByExpenseId = new Map<string, ExpenseRevision[]>();
  const revisionSequenceById = new Map<string, number>();
  for (const [expenseId, expenseRevisions] of revisionsByExpenseId) {
    const chronology = buildRevisionChronology(expenseRevisions);
    revisionChronologyByExpenseId.set(expenseId, chronology);
    chronology.forEach((revision, index) => {
      revisionSequenceById.set(revision.id, index);
    });
  }

  const events: ActivityEvent[] = [
    ...expenses.map((expense) => {
      const earliestRevision = revisionChronologyByExpenseId.get(expense.id)?.[0];
      const originalSnapshot = earliestRevision
        ? parseExpenseSnapshot(earliestRevision.beforeSnapshot)
        : null;

      return {
        id: `expense-created-${expense.id}`,
        type: "expense_created" as const,
        occurredAt: expense.createdAt,
        expenseId: expense.id,
        expense: originalSnapshot
          ? {
              ...expense,
              description: originalSnapshot.description,
              amount: originalSnapshot.amount,
              paidById: originalSnapshot.paidById,
              splitType: originalSnapshot.splitType,
              date: originalSnapshot.date,
            }
          : expense,
      };
    }),
    ...expenses.flatMap((expense) =>
      expense.deletedAt
        ? [
            {
              id: `expense-deleted-${expense.id}`,
              type: "expense_deleted" as const,
              occurredAt: expense.deletedAt,
              expenseId: expense.id,
              description: expense.description,
              date: expense.date,
              deletedByUserId: expense.deletedByUserId ?? null,
            },
          ]
        : []
    ),
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

  return sortActivityEvents(
    events,
    revisionChronologyByExpenseId,
    revisionSequenceById
  );
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
    case "expense_deleted":
      return event.date;
    case "expense_edited":
      return event.after.date;
    case "settlement_recorded":
    case "settlement_reversed":
      return event.date;
  }
}

function buildRevisionChronology(revisions: ExpenseRevision[]): ExpenseRevision[] {
  const fallback = [...revisions].sort(
    (a, b) =>
      toTimestampMs(a.createdAt) - toTimestampMs(b.createdAt) ||
      a.id.localeCompare(b.id)
  );
  if (fallback.length < 2) {
    return fallback;
  }

  const roots = fallback.filter(
    (candidate) =>
      !fallback.some(
        (possiblePredecessor) =>
          possiblePredecessor.id !== candidate.id &&
          possiblePredecessor.afterSnapshot === candidate.beforeSnapshot
      )
  );
  if (roots.length !== 1) {
    return fallback;
  }

  const chronology: ExpenseRevision[] = [];
  const visited = new Set<string>();
  let current: ExpenseRevision | undefined = roots[0];

  while (current && !visited.has(current.id)) {
    chronology.push(current);
    visited.add(current.id);

    const successors = fallback.filter(
      (candidate) =>
        !visited.has(candidate.id) &&
        candidate.beforeSnapshot === current?.afterSnapshot
    );
    if (successors.length > 1) {
      return fallback;
    }
    current = successors[0];
  }

  return chronology.length === fallback.length ? chronology : fallback;
}

function sortActivityEvents(
  events: ActivityEvent[],
  revisionChronologyByExpenseId: Map<string, ExpenseRevision[]>,
  revisionSequenceById: Map<string, number>
): ActivityEvent[] {
  const buckets = new Map<number, ActivityEvent[]>();
  for (const event of events) {
    const timestamp = toTimestampMs(event.occurredAt);
    const bucket = buckets.get(timestamp) ?? [];
    bucket.push(event);
    buckets.set(timestamp, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => b - a)
    .flatMap(([, bucket]) =>
      sortActivityTimestampBucket(
        bucket,
        revisionChronologyByExpenseId,
        revisionSequenceById
      )
    );
}

function sortActivityTimestampBucket(
  events: ActivityEvent[],
  revisionChronologyByExpenseId: Map<string, ExpenseRevision[]>,
  revisionSequenceById: Map<string, number>
): ActivityEvent[] {
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const outgoing = new Map(events.map((event) => [event.id, new Set<string>()]));
  const indegree = new Map(events.map((event) => [event.id, 0]));
  const expenseEvents = new Map<string, ExpenseActivityEvent[]>();

  for (const event of events) {
    if (!isExpenseActivityEvent(event)) {
      continue;
    }

    const group = expenseEvents.get(event.expenseId) ?? [];
    group.push(event);
    expenseEvents.set(event.expenseId, group);
  }

  for (const lifecycleEvents of expenseEvents.values()) {
    const newestFirst = [...lifecycleEvents].sort((a, b) => {
      const rankDifference =
        getExpenseLifecycleRank(
          b,
          revisionChronologyByExpenseId,
          revisionSequenceById
        ) -
        getExpenseLifecycleRank(
          a,
          revisionChronologyByExpenseId,
          revisionSequenceById
        );
      return rankDifference || compareActivityBaseline(a, b);
    });

    for (let index = 0; index < newestFirst.length - 1; index += 1) {
      const newer = newestFirst[index];
      const older = newestFirst[index + 1];
      const newerRank = getExpenseLifecycleRank(
        newer,
        revisionChronologyByExpenseId,
        revisionSequenceById
      );
      const olderRank = getExpenseLifecycleRank(
        older,
        revisionChronologyByExpenseId,
        revisionSequenceById
      );
      if (newerRank === olderRank || outgoing.get(newer.id)?.has(older.id)) {
        continue;
      }

      outgoing.get(newer.id)?.add(older.id);
      indegree.set(older.id, (indegree.get(older.id) ?? 0) + 1);
    }
  }

  const available = events.filter((event) => indegree.get(event.id) === 0);
  const sorted: ActivityEvent[] = [];

  while (available.length > 0) {
    available.sort(compareActivityBaseline);
    const next = available.shift();
    if (!next) {
      break;
    }

    sorted.push(next);
    for (const targetId of outgoing.get(next.id) ?? []) {
      const nextIndegree = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, nextIndegree);
      if (nextIndegree === 0) {
        const target = eventsById.get(targetId);
        if (target) {
          available.push(target);
        }
      }
    }
  }

  if (sorted.length === events.length) {
    return sorted;
  }

  const sortedIds = new Set(sorted.map((event) => event.id));
  return [
    ...sorted,
    ...events
      .filter((event) => !sortedIds.has(event.id))
      .sort(compareActivityBaseline),
  ];
}

function compareActivityBaseline(a: ActivityEvent, b: ActivityEvent): number {
  const businessDateDifference =
    toTimestampMs(getActivitySortDate(b)) -
    toTimestampMs(getActivitySortDate(a));
  return businessDateDifference || b.id.localeCompare(a.id);
}

type ExpenseActivityEvent = Extract<
  ActivityEvent,
  { type: "expense_created" | "expense_deleted" | "expense_edited" }
>;

function isExpenseActivityEvent(
  event: ActivityEvent
): event is ExpenseActivityEvent {
  return "expenseId" in event;
}

function getExpenseLifecycleRank(
  event: ExpenseActivityEvent,
  revisionChronologyByExpenseId: Map<string, ExpenseRevision[]>,
  revisionSequenceById: Map<string, number>
): number {
  switch (event.type) {
    case "expense_created":
      return 0;
    case "expense_edited":
      return (revisionSequenceById.get(event.revisionId) ?? -1) + 1;
    case "expense_deleted":
      return (revisionChronologyByExpenseId.get(event.expenseId)?.length ?? 0) + 1;
  }
}
