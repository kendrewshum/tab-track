import { describe, expect, it } from "vitest";
import {
  calculateBalances,
  simplifyDebts,
  type Balance,
  type Expense,
  type Member,
  type Settlement,
} from "../balances";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const m = (id: string): Member => ({ id, name: id });

const exp = (paidById: string, amount: number, splits: [string, number][]): Expense => ({
  amount,
  paidById,
  splits: splits.map(([memberId, a]) => ({ memberId, amount: a })),
});

const settle = (paidById: string, paidToId: string, amount: number): Settlement => ({
  paidById,
  paidToId,
  amount,
});

const netOf = (balances: Balance[], id: string) =>
  balances.find((b) => b.memberId === id)?.net ?? 0;

// ─── calculateBalances ────────────────────────────────────────────────────────
// Core accounting model:
//   paying for an expense  → +amount to payer's net
//   being in a split       → -split_amount from that member's net
//   recording a settlement → +amount to payer's net, -amount from recipient's net
//
// Conservation law: the sum of all net balances is always zero.

describe("calculateBalances", () => {
  it("credits payer and debits split participants", () => {
    // Alice pays $10, split equally. Alice's net: +10 (credit) - 5 (her split) = +5.
    // Bob's net: 0 (credit) - 5 (his split) = -5.
    const balances = calculateBalances(
      [m("alice"), m("bob")],
      [exp("alice", 10, [["alice", 5], ["bob", 5]])],
      []
    );
    expect(netOf(balances, "alice")).toBe(5);
    expect(netOf(balances, "bob")).toBe(-5);
  });

  it("payer who is not a split participant is credited the full amount", () => {
    // Alice pays $30 for bob and carol only. Alice is owed $30 in full.
    const balances = calculateBalances(
      [m("alice"), m("bob"), m("carol")],
      [exp("alice", 30, [["bob", 15], ["carol", 15]])],
      []
    );
    expect(netOf(balances, "alice")).toBe(30);
    expect(netOf(balances, "bob")).toBe(-15);
    expect(netOf(balances, "carol")).toBe(-15);
  });

  it("accumulates balances across multiple expenses", () => {
    // Expense 1: Alice pays $10 split equally → alice +5, bob -5
    // Expense 2: Bob pays $6 split equally   → alice -3, bob +3
    // Net: alice +2, bob -2
    const balances = calculateBalances(
      [m("alice"), m("bob")],
      [
        exp("alice", 10, [["alice", 5], ["bob", 5]]),
        exp("bob", 6, [["alice", 3], ["bob", 3]]),
      ],
      []
    );
    expect(netOf(balances, "alice")).toBe(2);
    expect(netOf(balances, "bob")).toBe(-2);
  });

  it("settlements credit the payer and debit the recipient", () => {
    // After alice pays bob $5 to settle: alice -5, bob +5 from the settlement.
    // Combined with alice owing bob $5 from an expense, everything nets to 0.
    const balances = calculateBalances(
      [m("alice"), m("bob")],
      [exp("bob", 10, [["alice", 5], ["bob", 5]])],
      [settle("alice", "bob", 5)]
    );
    expect(netOf(balances, "alice")).toBe(0);
    expect(netOf(balances, "bob")).toBe(0);
  });

  it("partial settlement reduces but does not eliminate the debt", () => {
    const balances = calculateBalances(
      [m("alice"), m("bob")],
      [exp("bob", 10, [["alice", 5], ["bob", 5]])],
      [settle("alice", "bob", 3)] // only paid back $3 of $5 owed
    );
    expect(netOf(balances, "alice")).toBe(-2);
    expect(netOf(balances, "bob")).toBe(2);
  });

  it("all net balances sum to zero (conservation of money)", () => {
    // Money doesn't appear or disappear — every credit has a matching debit.
    const balances = calculateBalances(
      [m("alice"), m("bob"), m("carol"), m("dave")],
      [
        exp("alice", 120, [["alice", 30], ["bob", 30], ["carol", 30], ["dave", 30]]),
        exp("bob", 45, [["alice", 15], ["bob", 15], ["carol", 15]]),
        exp("carol", 10, [["carol", 5], ["dave", 5]]),
      ],
      [settle("dave", "alice", 10), settle("carol", "bob", 8)]
    );
    const sum = balances.reduce((s, b) => s + b.net, 0);
    expect(Math.round(sum * 100) / 100).toBe(0);
  });

  it("members with no activity have a net of zero", () => {
    // dave is a member but is not part of any expense or settlement.
    const balances = calculateBalances(
      [m("alice"), m("bob"), m("dave")],
      [exp("alice", 10, [["alice", 5], ["bob", 5]])],
      []
    );
    expect(netOf(balances, "dave")).toBe(0);
  });
});

// ─── simplifyDebts ────────────────────────────────────────────────────────────
// Reduces balances to the minimum number of payments to settle all debts.
// Uses a greedy algorithm: match the largest debtor to the largest creditor.
//
// Key property: the sum of all simplified payments equals the sum of all
// positive (creditor) balances — i.e. no money is lost or invented.

describe("simplifyDebts", () => {
  it("returns empty array when everyone is settled up", () => {
    const balances: Balance[] = [
      { memberId: "alice", memberName: "alice", net: 0 },
      { memberId: "bob", memberName: "bob", net: 0 },
    ];
    expect(simplifyDebts(balances)).toEqual([]);
  });

  it("produces a single payment for a simple two-person debt", () => {
    const balances: Balance[] = [
      { memberId: "alice", memberName: "alice", net: 10 },  // alice is owed $10
      { memberId: "bob", memberName: "bob", net: -10 },     // bob owes $10
    ];
    const debts = simplifyDebts(balances);
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({ fromId: "bob", toId: "alice", amount: 10 });
  });

  it("collapses A→B, B→C chain into a single direct A→C payment", () => {
    // If alice owes bob $5 and bob owes carol $5, simplification produces
    // alice → carol $5 directly, eliminating bob as intermediary.
    const balances: Balance[] = [
      { memberId: "alice", memberName: "alice", net: -5 },
      { memberId: "bob", memberName: "bob", net: 0 },
      { memberId: "carol", memberName: "carol", net: 5 },
    ];
    const debts = simplifyDebts(balances);
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({ fromId: "alice", toId: "carol", amount: 5 });
  });

  it("produces two payments for two independent debts to the same creditor", () => {
    // alice and bob both owe carol
    const balances: Balance[] = [
      { memberId: "alice", memberName: "alice", net: -3 },
      { memberId: "bob", memberName: "bob", net: -7 },
      { memberId: "carol", memberName: "carol", net: 10 },
    ];
    const debts = simplifyDebts(balances);
    expect(debts).toHaveLength(2);
    const totalPaid = debts.reduce((s, d) => s + d.amount, 0);
    expect(totalPaid).toBe(10);
    expect(debts.every((d) => d.toId === "carol")).toBe(true);
  });

  it("handles multiple creditors and debtors", () => {
    // alice owes $10 total; bob owes $5 total.
    // carol is owed $8; dave is owed $7.
    // Expected: 2–3 payments to clear all debts.
    const balances: Balance[] = [
      { memberId: "alice", memberName: "alice", net: -10 },
      { memberId: "bob", memberName: "bob", net: -5 },
      { memberId: "carol", memberName: "carol", net: 8 },
      { memberId: "dave", memberName: "dave", net: 7 },
    ];
    const debts = simplifyDebts(balances);
    const totalPaid = Math.round(debts.reduce((s, d) => s + d.amount, 0) * 100) / 100;
    expect(totalPaid).toBe(15); // = sum of all positive balances
    // Every creditor must be fully repaid
    expect(debts.filter((d) => d.toId === "carol").reduce((s, d) => s + d.amount, 0)).toBe(8);
    expect(debts.filter((d) => d.toId === "dave").reduce((s, d) => s + d.amount, 0)).toBe(7);
  });

  it("total payments equal the total positive balance (money is conserved)", () => {
    const balances: Balance[] = [
      { memberId: "alice", memberName: "alice", net: 37.5 },
      { memberId: "bob", memberName: "bob", net: -12.5 },
      { memberId: "carol", memberName: "carol", net: -15 },
      { memberId: "dave", memberName: "dave", net: -10 },
    ];
    const debts = simplifyDebts(balances);
    const totalPaid = Math.round(debts.reduce((s, d) => s + d.amount, 0) * 100) / 100;
    const totalOwed = Math.round(
      balances.filter((b) => b.net > 0).reduce((s, b) => s + b.net, 0) * 100
    ) / 100;
    expect(totalPaid).toBe(totalOwed);
  });

  it("ignores near-zero balances (floating-point noise below $0.01)", () => {
    // A balance of $0.001 should not generate a payment.
    const balances: Balance[] = [
      { memberId: "alice", memberName: "alice", net: 0.001 },
      { memberId: "bob", memberName: "bob", net: -0.001 },
    ];
    expect(simplifyDebts(balances)).toEqual([]);
  });
});
