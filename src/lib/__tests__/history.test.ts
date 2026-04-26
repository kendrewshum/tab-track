import { describe, expect, it } from "vitest";

import {
  buildActivityEvents,
  createExpenseSnapshot,
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
