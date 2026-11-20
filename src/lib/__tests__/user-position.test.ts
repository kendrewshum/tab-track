import { describe, expect, it } from "vitest";

import {
  computeGroupPositions,
  getGroupPosition,
  summarizePositions,
  toPosition,
} from "../user-position";

describe("toPosition", () => {
  it("treats a positive net as money owed to the user", () => {
    expect(toPosition(12.5)).toEqual({ kind: "owed", amount: 12.5 });
  });

  it("treats a negative net as money the user owes, as a positive amount", () => {
    expect(toPosition(-7.25)).toEqual({ kind: "owes", amount: 7.25 });
  });

  it("treats rounding dust as settled", () => {
    expect(toPosition(0.004)).toEqual({ kind: "settled" });
    expect(toPosition(-0.01)).toEqual({ kind: "settled" });
  });
});

describe("getGroupPosition", () => {
  const balances = [
    { memberId: "a", memberName: "A", net: 5 },
    { memberId: "b", memberName: "B", net: -5 },
  ];

  it("reads the balance of the member linked to the user", () => {
    expect(getGroupPosition(balances, "b")).toEqual({ kind: "owes", amount: 5 });
  });

  it("is unlinked when the user has no member in the group", () => {
    expect(getGroupPosition(balances, null)).toEqual({ kind: "unlinked" });
    expect(getGroupPosition(balances, "missing")).toEqual({ kind: "unlinked" });
  });
});

describe("summarizePositions", () => {
  it("nets money owed against money owing across groups", () => {
    expect(
      summarizePositions([
        { kind: "owed", amount: 62.15 },
        { kind: "owed", amount: 42.1 },
        { kind: "owes", amount: 17.85 },
        { kind: "settled" },
      ]),
    ).toEqual({ kind: "owed", amount: 86.4 });
  });

  it("can come out as owing overall", () => {
    expect(
      summarizePositions([
        { kind: "owed", amount: 10 },
        { kind: "owes", amount: 25 },
      ]),
    ).toEqual({ kind: "owes", amount: 15 });
  });

  it("ignores groups where the user is not linked", () => {
    expect(summarizePositions([{ kind: "unlinked" }, { kind: "owed", amount: 3 }])).toEqual({
      kind: "owed",
      amount: 3,
    });
  });

  it("returns null when the user is linked in no group", () => {
    expect(summarizePositions([])).toBeNull();
    expect(summarizePositions([{ kind: "unlinked" }])).toBeNull();
  });
});

describe("computeGroupPositions", () => {
  const members = [
    { id: "g1-me", groupId: "g1", name: "Me", userId: "user-1" },
    { id: "g1-rae", groupId: "g1", name: "Rae", userId: null },
    { id: "g2-me", groupId: "g2", name: "Me", userId: "user-1" },
    { id: "g2-jo", groupId: "g2", name: "Jo", userId: "user-2" },
    { id: "g3-jo", groupId: "g3", name: "Jo", userId: "user-2" },
  ];

  it("computes the user's net per group, ignoring deleted expenses", () => {
    const positions = computeGroupPositions({
      userId: "user-1",
      groupIds: ["g1", "g2", "g3"],
      members,
      expenses: [
        { id: "e1", groupId: "g1", amount: 30, paidById: "g1-me", deletedAt: null },
        { id: "e2", groupId: "g1", amount: 100, paidById: "g1-rae", deletedAt: "2026-11-01" },
        { id: "e3", groupId: "g2", amount: 20, paidById: "g2-jo", deletedAt: null },
      ],
      splits: [
        { expenseId: "e1", memberId: "g1-me", amount: 15 },
        { expenseId: "e1", memberId: "g1-rae", amount: 15 },
        { expenseId: "e2", memberId: "g1-me", amount: 50 },
        { expenseId: "e2", memberId: "g1-rae", amount: 50 },
        { expenseId: "e3", memberId: "g2-me", amount: 10 },
        { expenseId: "e3", memberId: "g2-jo", amount: 10 },
      ],
      settlements: [],
    });

    expect(positions.get("g1")).toEqual({ kind: "owed", amount: 15 });
    expect(positions.get("g2")).toEqual({ kind: "owes", amount: 10 });
    expect(positions.get("g3")).toEqual({ kind: "unlinked" });
  });

  it("counts recorded payments toward the balance", () => {
    const positions = computeGroupPositions({
      userId: "user-1",
      groupIds: ["g2"],
      members,
      expenses: [{ id: "e3", groupId: "g2", amount: 20, paidById: "g2-jo", deletedAt: null }],
      splits: [
        { expenseId: "e3", memberId: "g2-me", amount: 10 },
        { expenseId: "e3", memberId: "g2-jo", amount: 10 },
      ],
      settlements: [{ groupId: "g2", paidById: "g2-me", paidToId: "g2-jo", amount: 10 }],
    });

    expect(positions.get("g2")).toEqual({ kind: "settled" });
  });
});
