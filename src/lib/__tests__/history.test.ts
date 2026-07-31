import { describe, expect, it } from "vitest";

import {
  DEFAULT_ACTIVITY_CHUNK_SIZE,
  buildActivityArchive,
  buildActivityEvents,
  createExpenseSnapshot,
  getActivityVisibleCount,
  getPostSettlementEditedExpenseIds,
  hasExpenseEditsAfterSettlementStarted,
  parseExpenseSnapshot,
  serializeExpenseSnapshot,
  type ExpenseSnapshot,
} from "../history";

describe("expense snapshot serialization", () => {
  it("builds a snapshot from an expense row and its current split rows", () => {
    expect(
      createExpenseSnapshot(
        {
          description: "Brunch",
          amount: 18,
          paidById: "alice",
          splitType: "equal",
          date: "2026-04-26",
        },
        [
          { memberId: "alice", amount: 9 },
          { memberId: "bob", amount: 9 },
        ]
      )
    ).toEqual({
      description: "Brunch",
      amount: 18,
      paidById: "alice",
      splitType: "equal",
      date: "2026-04-26",
      splits: [
        { memberId: "alice", amount: 9 },
        { memberId: "bob", amount: 9 },
      ],
    });
  });

  it("projects database rows to domain-only expense snapshot fields", () => {
    const expenseRow = {
      id: "expense-1",
      groupId: "group-1",
      description: "Brunch",
      amount: 18,
      paidById: "alice",
      splitType: "equal" as const,
      date: "2026-04-26",
      createdAt: "2026-04-26 09:00:00",
    };
    const splitRows = [
      {
        id: "split-1",
        expenseId: "expense-1",
        memberId: "alice",
        amount: 18,
      },
    ];

    const snapshot = createExpenseSnapshot(expenseRow, splitRows);

    expect(snapshot).toEqual({
      description: "Brunch",
      amount: 18,
      paidById: "alice",
      splitType: "equal",
      date: "2026-04-26",
      splits: [{ memberId: "alice", amount: 18 }],
    });
  });

  it("round-trips a full expense snapshot including split details", () => {
    const snapshot: ExpenseSnapshot = {
      description: "Dinner",
      amount: 42.75,
      paidById: "alice",
      splitType: "exact",
      date: "2026-04-25",
      splits: [
        { memberId: "alice", amount: 12.75 },
        { memberId: "bob", amount: 30 },
      ],
    };

    const serialized = serializeExpenseSnapshot(snapshot);

    expect(parseExpenseSnapshot(serialized)).toEqual(snapshot);
  });
});

describe("buildActivityEvents", () => {
  it("uses snapshot continuity to order same-second edits and recover the original expense", () => {
    const original = serializeExpenseSnapshot({
      description: "Dinner",
      amount: 40,
      paidById: "alice",
      splitType: "equal",
      date: "2026-04-20",
      splits: [],
    });
    const firstEdit = serializeExpenseSnapshot({
      description: "Dinner + drinks",
      amount: 50,
      paidById: "alice",
      splitType: "equal",
      date: "2026-05-01",
      splits: [],
    });
    const secondEdit = serializeExpenseSnapshot({
      description: "Dinner + drinks + tip",
      amount: 60,
      paidById: "alice",
      splitType: "equal",
      date: "2026-04-01",
      splits: [],
    });

    const events = buildActivityEvents({
      expenses: [
        {
          id: "expense-1",
          description: "Dinner + drinks + tip",
          amount: 60,
          paidById: "alice",
          splitType: "equal",
          date: "2026-04-01",
          createdAt: "2026-04-20 09:00:00",
        },
      ],
      revisions: [
        {
          id: "revision-a-second",
          expenseId: "expense-1",
          beforeSnapshot: firstEdit,
          afterSnapshot: secondEdit,
          createdAt: "2026-04-21 12:00:00",
        },
        {
          id: "revision-z-first",
          expenseId: "expense-1",
          beforeSnapshot: original,
          afterSnapshot: firstEdit,
          createdAt: "2026-04-21 12:00:00",
        },
      ],
      settlements: [],
    });

    expect(
      events
        .filter((event) => event.type === "expense_edited")
        .map((event) => event.revisionId)
    ).toEqual(["revision-a-second", "revision-z-first"]);
    expect(events.at(-1)).toMatchObject({
      type: "expense_created",
      expense: {
        description: "Dinner",
        amount: 40,
        date: "2026-04-20",
      },
    });
  });

  it("anchors same-second edit-and-revert cycles to the current expense state", () => {
    const original = serializeExpenseSnapshot({
      description: "Dinner",
      amount: 40,
      paidById: "alice",
      splitType: "equal",
      date: "2026-04-20",
      splits: [
        { memberId: "alice", amount: 20 },
        { memberId: "bob", amount: 20 },
      ],
    });
    const edited = serializeExpenseSnapshot({
      description: "Dinner + drinks",
      amount: 50,
      paidById: "alice",
      splitType: "equal",
      date: "2026-04-20",
      splits: [
        { memberId: "alice", amount: 25 },
        { memberId: "bob", amount: 25 },
      ],
    });

    const withDatabaseFields = (serialized: string, suffix: string) => {
      const snapshot = parseExpenseSnapshot(serialized);
      return JSON.stringify({
        ...snapshot,
        id: `expense-${suffix}`,
        groupId: "group-1",
        createdAt: "2026-04-20 09:00:00",
        splits: snapshot.splits.map((split, index) => ({
          ...split,
          id: `split-${suffix}-${index}`,
          expenseId: "expense-1",
        })),
      });
    };
    const events = buildActivityEvents({
      expenses: [
        {
          id: "expense-1",
          description: "Dinner",
          amount: 40,
          paidById: "alice",
          splitType: "equal",
          date: "2026-04-20",
          createdAt: "2026-04-20 09:00:00",
          splits: parseExpenseSnapshot(original).splits,
        },
      ],
      revisions: [
        {
          id: "revision-a-second",
          expenseId: "expense-1",
          beforeSnapshot: withDatabaseFields(edited, "edited"),
          afterSnapshot: withDatabaseFields(original, "reverted"),
          createdAt: "2026-04-21 12:00:00",
        },
        {
          id: "revision-z-first",
          expenseId: "expense-1",
          beforeSnapshot: withDatabaseFields(original, "original"),
          afterSnapshot: withDatabaseFields(edited, "first-edit"),
          createdAt: "2026-04-21 12:00:00",
        },
      ],
      settlements: [],
    });

    expect(
      events
        .filter((event) => event.type === "expense_edited")
        .map((event) => event.revisionId),
    ).toEqual(["revision-a-second", "revision-z-first"]);
    expect(events.at(-1)).toMatchObject({
      type: "expense_created",
      expense: {
        description: "Dinner",
        amount: 40,
      },
    });
  });

  it("reconstructs the original splits on the creation event", () => {
    const original = serializeExpenseSnapshot({
      description: "Dinner",
      amount: 40,
      paidById: "alice",
      splitType: "exact",
      date: "2026-04-20",
      splits: [
        { memberId: "alice", amount: 30 },
        { memberId: "bob", amount: 10 },
      ],
    });
    const edited = serializeExpenseSnapshot({
      description: "Dinner",
      amount: 40,
      paidById: "alice",
      splitType: "equal",
      date: "2026-04-20",
      splits: [
        { memberId: "alice", amount: 20 },
        { memberId: "bob", amount: 20 },
      ],
    });

    const events = buildActivityEvents({
      expenses: [
        {
          id: "expense-1",
          description: "Dinner",
          amount: 40,
          paidById: "alice",
          splitType: "equal",
          date: "2026-04-20",
          createdAt: "2026-04-20 09:00:00",
          splits: parseExpenseSnapshot(edited).splits,
        },
      ],
      revisions: [
        {
          id: "revision-1",
          expenseId: "expense-1",
          beforeSnapshot: original,
          afterSnapshot: edited,
          createdAt: "2026-04-21 12:00:00",
        },
      ],
      settlements: [],
    });

    expect(events.at(-1)).toMatchObject({
      type: "expense_created",
      expense: {
        splitType: "exact",
        splits: [
          { memberId: "alice", amount: 30 },
          { memberId: "bob", amount: 10 },
        ],
      },
    });
  });

  it("uses a total order when lifecycle and cross-expense baseline priorities form a comparator cycle", () => {
    const original = serializeExpenseSnapshot({
      description: "Dinner",
      amount: 40,
      paidById: "alice",
      splitType: "equal",
      date: "2026-04-01",
      splits: [],
    });
    const firstEdit = serializeExpenseSnapshot({
      description: "Dinner in March",
      amount: 50,
      paidById: "alice",
      splitType: "equal",
      date: "2026-03-01",
      splits: [],
    });
    const secondEdit = serializeExpenseSnapshot({
      description: "Dinner in January",
      amount: 60,
      paidById: "alice",
      splitType: "equal",
      date: "2026-01-01",
      splits: [],
    });
    const revisions = [
      {
        id: "revision-a-newer",
        expenseId: "expense-1",
        beforeSnapshot: firstEdit,
        afterSnapshot: secondEdit,
        createdAt: "2026-04-21 12:00:00",
      },
      {
        id: "revision-b-older",
        expenseId: "expense-1",
        beforeSnapshot: original,
        afterSnapshot: firstEdit,
        createdAt: "2026-04-21 12:00:00",
      },
    ];
    const expenses = [
      {
        id: "expense-2",
        description: "February expense",
        amount: 20,
        paidById: "bob",
        splitType: "equal" as const,
        date: "2026-02-01",
        createdAt: "2026-04-21 12:00:00",
      },
    ];
    const expectedOrder = [
      "expense-created-expense-2",
      "expense-edited-revision-a-newer",
      "expense-edited-revision-b-older",
    ];

    const forward = buildActivityEvents({ expenses, revisions, settlements: [] });
    const reversed = buildActivityEvents({
      expenses: [...expenses].reverse(),
      revisions: [...revisions].reverse(),
      settlements: [],
    });

    expect(forward.map((event) => event.id)).toEqual(expectedOrder);
    expect(reversed.map((event) => event.id)).toEqual(expectedOrder);
  });

  it("falls back deterministically when legacy revision chains are ambiguous", () => {
    const base = serializeExpenseSnapshot({
      description: "Dinner",
      amount: 40,
      paidById: "alice",
      splitType: "equal",
      date: "2026-04-20",
      splits: [],
    });
    const revisions = [
      {
        id: "revision-b",
        expenseId: "expense-1",
        beforeSnapshot: base,
        afterSnapshot: serializeExpenseSnapshot({
          ...parseExpenseSnapshot(base),
          description: "Branch B",
        }),
        createdAt: "2026-04-21 12:00:00",
      },
      {
        id: "revision-a",
        expenseId: "expense-1",
        beforeSnapshot: base,
        afterSnapshot: serializeExpenseSnapshot({
          ...parseExpenseSnapshot(base),
          description: "Branch A",
        }),
        createdAt: "2026-04-21 12:00:00",
      },
    ];
    const input = {
      expenses: [],
      settlements: [],
    };

    const forward = buildActivityEvents({ ...input, revisions });
    const reversed = buildActivityEvents({ ...input, revisions: [...revisions].reverse() });

    expect(forward.map((event) => event.id)).toEqual(reversed.map((event) => event.id));
    expect(forward).toHaveLength(2);
  });

  it("preserves deleted expense history and sorts its deletion event by deletion time", () => {
    const events = buildActivityEvents({
      expenses: [
        {
          id: "expense-1",
          description: "Dinner + tip",
          amount: 48,
          paidById: "alice",
          splitType: "equal",
          date: "2026-04-20",
          createdAt: "2026-04-20 09:00:00",
          deletedAt: "2026-04-21 12:00:00",
          deletedByUserId: "user-1",
        },
      ],
      revisions: [
        {
          id: "revision-1",
          expenseId: "expense-1",
          beforeSnapshot: serializeExpenseSnapshot({
            description: "Dinner",
            amount: 40,
            paidById: "alice",
            splitType: "equal",
            date: "2026-04-20",
            splits: [
              { memberId: "alice", amount: 20 },
              { memberId: "bob", amount: 20 },
            ],
          }),
          afterSnapshot: serializeExpenseSnapshot({
            description: "Dinner + tip",
            amount: 48,
            paidById: "alice",
            splitType: "equal",
            date: "2026-04-20",
            splits: [
              { memberId: "alice", amount: 24 },
              { memberId: "bob", amount: 24 },
            ],
          }),
          createdAt: "2026-04-21 12:00:00",
        },
      ],
      settlements: [],
    });

    expect(events.map((event) => event.type)).toEqual([
      "expense_deleted",
      "expense_edited",
      "expense_created",
    ]);
    expect(events[0]).toMatchObject({
      id: "expense-deleted-expense-1",
      expenseId: "expense-1",
      description: "Dinner + tip",
      deletedByUserId: "user-1",
    });
    expect(events[2]).toMatchObject({
      type: "expense_created",
      expense: {
        description: "Dinner",
        amount: 40,
      },
    });
  });

  it("merges expense, edit, settlement, and reversal events in descending time order", () => {
    const events = buildActivityEvents({
      expenses: [
        {
          id: "expense-1",
          description: "Cab",
          amount: 24,
          paidById: "alice",
          splitType: "equal",
          date: "2026-04-20",
          createdAt: "2026-04-20 09:00:00",
        },
      ],
      revisions: [
        {
          id: "revision-1",
          expenseId: "expense-1",
          beforeSnapshot: serializeExpenseSnapshot({
            description: "Cab",
            amount: 24,
            paidById: "alice",
            splitType: "equal",
            date: "2026-04-20",
            splits: [
              { memberId: "alice", amount: 12 },
              { memberId: "bob", amount: 12 },
            ],
          }),
          afterSnapshot: serializeExpenseSnapshot({
            description: "Cab + toll",
            amount: 30,
            paidById: "alice",
            splitType: "equal",
            date: "2026-04-20",
            splits: [
              { memberId: "alice", amount: 15 },
              { memberId: "bob", amount: 15 },
            ],
          }),
          createdAt: "2026-04-22 12:00:00",
        },
      ],
      settlements: [
        {
          id: "settlement-1",
          paidById: "bob",
          paidToId: "alice",
          amount: 12,
          note: "Venmo",
          date: "2026-04-21",
          createdAt: "2026-04-21 08:00:00",
          reversalOfSettlementId: null,
        },
        {
          id: "settlement-2",
          paidById: "alice",
          paidToId: "bob",
          amount: 12,
          note: "Reversal of payment from Apr 21, 2026",
          date: "2026-04-23",
          createdAt: "2026-04-23 09:30:00",
          reversalOfSettlementId: "settlement-1",
        },
      ],
    });

    expect(events.map((event) => event.type)).toEqual([
      "settlement_reversed",
      "expense_edited",
      "settlement_recorded",
      "expense_created",
    ]);
    expect(events[0]).toMatchObject({
      settlementId: "settlement-2",
      reversalOfSettlementId: "settlement-1",
    });
    expect(events[1]).toMatchObject({
      expenseId: "expense-1",
      before: { description: "Cab", amount: 24 },
      after: { description: "Cab + toll", amount: 30 },
    });
  });

  it("uses business dates and event ids to break same-second timestamp ties deterministically", () => {
    const events = buildActivityEvents({
      expenses: [
        {
          id: "expense-b",
          description: "Later expense",
          amount: 24,
          paidById: "alice",
          splitType: "equal",
          date: "2026-04-22",
          createdAt: "2026-04-23 09:30:00",
        },
        {
          id: "expense-a",
          description: "Earlier expense",
          amount: 24,
          paidById: "alice",
          splitType: "equal",
          date: "2026-04-21",
          createdAt: "2026-04-23 09:30:00",
        },
      ],
      revisions: [
        {
          id: "revision-a",
          expenseId: "expense-c",
          beforeSnapshot: serializeExpenseSnapshot({
            description: "Snack",
            amount: 8,
            paidById: "alice",
            splitType: "equal",
            date: "2026-04-22",
            splits: [
              { memberId: "alice", amount: 4 },
              { memberId: "bob", amount: 4 },
            ],
          }),
          afterSnapshot: serializeExpenseSnapshot({
            description: "Snack + tip",
            amount: 10,
            paidById: "alice",
            splitType: "equal",
            date: "2026-04-23",
            splits: [
              { memberId: "alice", amount: 5 },
              { memberId: "bob", amount: 5 },
            ],
          }),
          createdAt: "2026-04-23 09:30:00",
        },
      ],
      settlements: [
        {
          id: "settlement-b",
          paidById: "bob",
          paidToId: "alice",
          amount: 12,
          note: "Later payment",
          date: "2026-04-24",
          createdAt: "2026-04-23 09:30:00",
          reversalOfSettlementId: null,
        },
        {
          id: "settlement-a",
          paidById: "bob",
          paidToId: "alice",
          amount: 12,
          note: "Same date, smaller id",
          date: "2026-04-24",
          createdAt: "2026-04-23 09:30:00",
          reversalOfSettlementId: null,
        },
      ],
    });

    expect(events.map((event) => event.id)).toEqual([
      "settlement-settlement-b",
      "settlement-settlement-a",
      "expense-edited-revision-a",
      "expense-created-expense-b",
      "expense-created-expense-a",
    ]);
  });
});

describe("getActivityVisibleCount", () => {
  it("falls back to the default chunk size for missing, invalid, or undersized values", () => {
    expect(getActivityVisibleCount(undefined)).toBe(DEFAULT_ACTIVITY_CHUNK_SIZE);
    expect(getActivityVisibleCount(Number.NaN)).toBe(DEFAULT_ACTIVITY_CHUNK_SIZE);
    expect(getActivityVisibleCount(0)).toBe(DEFAULT_ACTIVITY_CHUNK_SIZE);
    expect(getActivityVisibleCount(19)).toBe(DEFAULT_ACTIVITY_CHUNK_SIZE);
  });

  it("snaps valid values up to the next chunk boundary", () => {
    expect(getActivityVisibleCount(20)).toBe(20);
    expect(getActivityVisibleCount(21)).toBe(40);
    expect(getActivityVisibleCount(41)).toBe(60);
  });

  it("treats decimal numeric values as invalid input", () => {
    expect(getActivityVisibleCount(20.5)).toBe(DEFAULT_ACTIVITY_CHUNK_SIZE);
    expect(getActivityVisibleCount(Number.NaN)).toBe(DEFAULT_ACTIVITY_CHUNK_SIZE);
  });
});

describe("buildActivityArchive", () => {
  it("returns the leading slice and the next visible count when older items remain", () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ id: `event-${index + 1}` }));

    expect(buildActivityArchive(items, 20)).toEqual({
      visibleItems: items.slice(0, 20),
      hasMore: true,
      nextVisibleCount: 40,
    });
  });

  it("returns the full slice when the archive fits within the visible window", () => {
    const items = Array.from({ length: 12 }, (_, index) => ({ id: `event-${index + 1}` }));

    expect(buildActivityArchive(items, 20)).toEqual({
      visibleItems: items,
      hasMore: false,
      nextVisibleCount: 40,
    });
  });
});

describe("hasExpenseEditsAfterSettlementStarted", () => {
  it("returns true when an expense revision was recorded after settlement activity began", () => {
    expect(
      hasExpenseEditsAfterSettlementStarted(
        [
          {
            id: "revision-1",
            expenseId: "expense-1",
            beforeSnapshot: "{}",
            afterSnapshot: "{}",
            createdAt: "2026-04-22 12:00:00",
          },
        ],
        [
          {
            id: "settlement-1",
            paidById: "bob",
            paidToId: "alice",
            amount: 5,
            note: null,
            date: "2026-04-21",
            createdAt: "2026-04-21 08:00:00",
            reversalOfSettlementId: null,
          },
        ]
      )
    ).toBe(true);
  });

  it("returns false when revisions all happened before the first settlement", () => {
    expect(
      hasExpenseEditsAfterSettlementStarted(
        [
          {
            id: "revision-1",
            expenseId: "expense-1",
            beforeSnapshot: "{}",
            afterSnapshot: "{}",
            createdAt: "2026-04-20 12:00:00",
          },
        ],
        [
          {
            id: "settlement-1",
            paidById: "bob",
            paidToId: "alice",
            amount: 5,
            note: null,
            date: "2026-04-21",
            createdAt: "2026-04-21 08:00:00",
            reversalOfSettlementId: null,
          },
        ]
      )
    ).toBe(false);
  });

  it("treats same-second edits as post-settlement when timestamps share SQLite precision", () => {
    expect(
      hasExpenseEditsAfterSettlementStarted(
        [
          {
            id: "revision-1",
            expenseId: "expense-1",
            beforeSnapshot: "{}",
            afterSnapshot: "{}",
            createdAt: "2026-04-21 08:00:00",
          },
        ],
        [
          {
            id: "settlement-1",
            paidById: "bob",
            paidToId: "alice",
            amount: 5,
            note: null,
            date: "2026-04-21",
            createdAt: "2026-04-21 08:00:00",
            reversalOfSettlementId: null,
          },
        ]
      )
    ).toBe(true);
  });

  it("returns the ids of expenses edited after settlement activity began", () => {
    expect(
      Array.from(
        getPostSettlementEditedExpenseIds(
          [
            {
              id: "revision-1",
              expenseId: "expense-1",
              beforeSnapshot: "{}",
              afterSnapshot: "{}",
              createdAt: "2026-04-22 12:00:00",
            },
            {
              id: "revision-2",
              expenseId: "expense-2",
              beforeSnapshot: "{}",
              afterSnapshot: "{}",
              createdAt: "2026-04-20 12:00:00",
            },
          ],
          [
            {
              id: "settlement-1",
              paidById: "bob",
              paidToId: "alice",
              amount: 5,
              note: null,
              date: "2026-04-21",
              createdAt: "2026-04-21 08:00:00",
              reversalOfSettlementId: null,
            },
          ]
        )
      )
    ).toEqual(["expense-1"]);
  });
});
