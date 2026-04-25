import { describe, expect, it } from "vitest";
import { computeSplits } from "../splits";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const amounts = (splits: ReturnType<typeof computeSplits>) => splits.map((s) => s.amount);
const total = (splits: ReturnType<typeof computeSplits>) =>
  Math.round(splits.reduce((s, x) => s + x.amount, 0) * 100) / 100;

// ─── Rounding rule ────────────────────────────────────────────────────────────
// When an amount doesn't divide evenly, one participant absorbs the $0.01
// remainder. That participant is the PAYER (if they are in the split), so the
// person who laid out the money is made whole to the nearest cent. If the
// payer is not a participant, the last participant in the list gets it.

describe("rounding remainder assignment", () => {
  it("gives the remainder to the payer when they are in the split", () => {
    // $10 ÷ 3 = $3.33 repeating. Alice paid, so Alice gets $3.34.
    const splits = computeSplits("equal", 10, ["alice", "bob", "carol"], {}, "alice");
    expect(amounts(splits)).toEqual([3.34, 3.33, 3.33]);
    expect(total(splits)).toBe(10);
  });

  it("gives the remainder to the payer even if they are not first in the list", () => {
    const splits = computeSplits("equal", 10, ["alice", "bob", "carol"], {}, "bob");
    expect(amounts(splits)).toEqual([3.33, 3.34, 3.33]);
    expect(total(splits)).toBe(10);
  });

  it("falls back to last participant when payer is not in the split", () => {
    // Dave paid but is not sharing in the split — last participant (carol) gets remainder.
    const splits = computeSplits("equal", 10, ["alice", "bob", "carol"], {}, "dave");
    expect(amounts(splits)).toEqual([3.33, 3.33, 3.34]);
    expect(total(splits)).toBe(10);
  });

  it("falls back to last participant when no payer is supplied", () => {
    const splits = computeSplits("equal", 10, ["alice", "bob", "carol"]);
    expect(amounts(splits)).toEqual([3.33, 3.33, 3.34]);
    expect(total(splits)).toBe(10);
  });
});

// ─── Equal split ─────────────────────────────────────────────────────────────
// Each participant pays an equal share. The payer absorbs any rounding
// remainder so splits always sum to exactly the expense total.

describe("equal split", () => {
  it("divides evenly when total divides cleanly", () => {
    const splits = computeSplits("equal", 12, ["alice", "bob", "carol"], {}, "alice");
    expect(amounts(splits)).toEqual([4, 4, 4]);
    expect(total(splits)).toBe(12);
  });

  it("payer gets the rounding remainder ($3.34, others get $3.33)", () => {
    const splits = computeSplits("equal", 10, ["alice", "bob", "carol"], {}, "alice");
    expect(amounts(splits)).toEqual([3.34, 3.33, 3.33]);
    expect(total(splits)).toBe(10);
  });

  it("handles two participants", () => {
    const splits = computeSplits("equal", 9.99, ["alice", "bob"], {}, "alice");
    expect(amounts(splits)).toEqual([5, 4.99]);
    expect(total(splits)).toBe(9.99);
  });

  it("handles a single participant (full amount to that person)", () => {
    expect(amounts(computeSplits("equal", 42, ["alice"], {}, "alice"))).toEqual([42]);
  });

  it("always sums to the exact total for amounts with difficult rounding", () => {
    const tricky = [0.1, 0.01, 1.99, 7.77, 99.99, 100.0];
    const counts = [2, 3, 4, 5];
    const ids = ["alice", "bob", "carol", "dave", "eve"];
    for (const amount of tricky) {
      for (const n of counts) {
        const participants = ids.slice(0, n);
        expect(total(computeSplits("equal", amount, participants, {}, "alice"))).toBe(amount);
      }
    }
  });

  it("returns empty array for an empty participant list", () => {
    expect(computeSplits("equal", 10, [], {})).toEqual([]);
  });
});

// ─── Shares split ────────────────────────────────────────────────────────────
// Each participant pays in proportion to their relative share weight.
// E.g. weights 2:1 means the first person pays twice as much as the second.

describe("shares split", () => {
  it("equal weights produce equal splits", () => {
    const splits = computeSplits(
      "shares", 12, ["alice", "bob", "carol"],
      { shares: { alice: 1, bob: 1, carol: 1 } },
      "alice"
    );
    expect(amounts(splits)).toEqual([4, 4, 4]);
    expect(total(splits)).toBe(12);
  });

  it("2:1 weighting — first person pays twice as much", () => {
    const splits = computeSplits(
      "shares", 9, ["alice", "bob"],
      { shares: { alice: 2, bob: 1 } },
      "alice"
    );
    expect(amounts(splits)).toEqual([6, 3]);
    expect(total(splits)).toBe(9);
  });

  it("payer absorbs rounding remainder with 1:1:1 shares on $10", () => {
    // alice paid → alice gets $3.34
    const splits = computeSplits(
      "shares", 10, ["alice", "bob", "carol"],
      { shares: { alice: 1, bob: 1, carol: 1 } },
      "alice"
    );
    expect(amounts(splits)).toEqual([3.34, 3.33, 3.33]);
    expect(total(splits)).toBe(10);
  });

  it("handles non-integer weights (2.5:1.5)", () => {
    const splits = computeSplits(
      "shares", 10, ["alice", "bob"],
      { shares: { alice: 2.5, bob: 1.5 } },
      "alice"
    );
    expect(total(splits)).toBe(10);
    expect(splits[0].amount).toBe(6.25);
    expect(splits[1].amount).toBe(3.75);
  });

  it("returns empty array when all share weights are zero (prevents divide-by-zero)", () => {
    expect(
      computeSplits("shares", 10, ["alice", "bob"], { shares: { alice: 0, bob: 0 } })
    ).toEqual([]);
  });

  it("always sums to the exact total", () => {
    const splits = computeSplits(
      "shares", 7.77, ["alice", "bob", "carol"],
      { shares: { alice: 3, bob: 2, carol: 1 } },
      "carol"
    );
    expect(total(splits)).toBe(7.77);
  });
});

// ─── Percentage split ─────────────────────────────────────────────────────────
// Each participant specifies what percentage of the total they owe.
// Percentages must sum to 100 (validated on the client before submission).

describe("percentage split", () => {
  it("50/50 split", () => {
    const splits = computeSplits(
      "percentage", 10, ["alice", "bob"],
      { percentages: { alice: 50, bob: 50 } },
      "alice"
    );
    expect(amounts(splits)).toEqual([5, 5]);
  });

  it("70/30 split", () => {
    const splits = computeSplits(
      "percentage", 15, ["alice", "bob"],
      { percentages: { alice: 70, bob: 30 } },
      "alice"
    );
    expect(amounts(splits)).toEqual([10.5, 4.5]);
  });

  it("33% / 33% / 34% — payer at index 0 gets the remainder", () => {
    const splits = computeSplits(
      "percentage", 10, ["alice", "bob", "carol"],
      { percentages: { alice: 33, bob: 33, carol: 34 } },
      "alice"
    );
    expect(total(splits)).toBe(10);
    // alice's 33% = $3.30, bob's 33% = $3.30, carol's 34% = $3.40
    // sum = $10.00 — no remainder needed here
    expect(amounts(splits)).toEqual([3.3, 3.3, 3.4]);
  });

  it("always sums to the exact total", () => {
    const splits = computeSplits(
      "percentage", 99.99, ["alice", "bob", "carol", "dave"],
      { percentages: { alice: 25, bob: 25, carol: 25, dave: 25 } },
      "bob"
    );
    expect(total(splits)).toBe(99.99);
  });
});

// ─── Exact split ─────────────────────────────────────────────────────────────
// Each participant specifies their exact dollar amount. Pure pass-through —
// the client form validates that amounts sum to the total before submitting.

describe("exact split", () => {
  it("passes through each participant's specified amount unchanged", () => {
    const splits = computeSplits(
      "exact", 10, ["alice", "bob"],
      { exact: { alice: 7, bob: 3 } }
    );
    expect(amounts(splits)).toEqual([7, 3]);
  });

  it("defaults to 0 for participants with no entry", () => {
    const splits = computeSplits("exact", 10, ["alice", "bob"], { exact: { alice: 10 } });
    expect(splits[1].amount).toBe(0);
  });
});
