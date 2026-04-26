import { describe, expect, it } from "vitest";

// Logic extracted from ExpenseForm's initial state calculation for edit mode.
// When loading an existing expense, percentage and exact split values are
// reconstructed from the stored per-member amounts in expenseSplits.

function reconstructPct(splitAmount: number, total: number): number {
  return Math.round((splitAmount / total) * 10000) / 100;
}

describe("percentage reconstruction from stored split amounts", () => {
  it("reconstructs 50% from a half-total split", () => {
    expect(reconstructPct(5, 10)).toBe(50);
  });

  it("reconstructs 70% from a 70/30 split", () => {
    expect(reconstructPct(28, 40)).toBe(70);
    expect(reconstructPct(12, 40)).toBe(30);
  });

  it("reconstructs 33.33% from a three-way equal split", () => {
    // $3.33 of $10 → 33.30%; payer absorbs the remainder so 3.34/10 → 33.40%
    expect(reconstructPct(3.33, 10)).toBe(33.3);
    expect(reconstructPct(3.34, 10)).toBe(33.4);
  });

  it("reconstructs fractional percentages to two decimal places", () => {
    expect(reconstructPct(12.5, 40)).toBe(31.25);
  });

  it("reconstructs 100% when one member covers the full amount", () => {
    expect(reconstructPct(42, 42)).toBe(100);
  });

  it("returns 0 when split amount is 0", () => {
    expect(reconstructPct(0, 10)).toBe(0);
  });
});

describe("exact split pass-through in edit mode", () => {
  it("preserves stored amounts unchanged", () => {
    const splits = [
      { memberId: "alice", amount: 7 },
      { memberId: "bob", amount: 3 },
    ];
    const exactValues = Object.fromEntries(
      splits.map((s) => [s.memberId, String(s.amount)])
    );
    expect(exactValues).toEqual({ alice: "7", bob: "3" });
  });

  it("uses empty string for members not in the split", () => {
    const splits = [{ memberId: "alice", amount: 10 }];
    const members = ["alice", "bob"];
    const exactValues = Object.fromEntries(
      members.map((id) => {
        const s = splits.find((s) => s.memberId === id);
        return [id, s ? String(s.amount) : ""];
      })
    );
    expect(exactValues).toEqual({ alice: "10", bob: "" });
  });
});
