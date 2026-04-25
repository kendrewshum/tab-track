import { describe, expect, it } from "vitest";
import { computeSplits } from "../splits";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ids = ["alice", "bob", "carol", "dave"];
const amounts = (splits: ReturnType<typeof computeSplits>) => splits.map((s) => s.amount);
const total = (splits: ReturnType<typeof computeSplits>) =>
  Math.round(splits.reduce((s, x) => s + x.amount, 0) * 100) / 100;

// ─── Equal split ─────────────────────────────────────────────────────────────
// Business rule: each participant pays the same share.
// When the amount doesn't divide evenly the LAST participant absorbs the
// rounding remainder so splits always sum to exactly the expense total.

describe("equal split", () => {
  it("divides evenly when total divides cleanly", () => {
    const splits = computeSplits("equal", 12, ["alice", "bob", "carol"], {});
    expect(amounts(splits)).toEqual([4, 4, 4]);
    expect(total(splits)).toBe(12);
  });

  it("gives the rounding remainder to the last participant", () => {
    // $10 ÷ 3 = $3.33 repeating. First two pay $3.33, last pays $3.34.
    const splits = computeSplits("equal", 10, ["alice", "bob", "carol"], {});
    expect(amounts(splits)).toEqual([3.33, 3.33, 3.34]);
    expect(total(splits)).toBe(10);
  });

  it("handles two participants", () => {
    expect(amounts(computeSplits("equal", 9.99, ["alice", "bob"], {}))).toEqual([5, 4.99]);
    expect(total(computeSplits("equal", 9.99, ["alice", "bob"], {}))).toBe(9.99);
  });

  it("handles a single participant (edge case: full amount)", () => {
    const splits = computeSplits("equal", 42, ["alice"], {});
    expect(amounts(splits)).toEqual([42]);
  });

  it("handles four participants with an amount that does not divide evenly", () => {
    // $10 ÷ 4 = $2.50 each — divides exactly
    expect(amounts(computeSplits("equal", 10, ids, {}))).toEqual([2.5, 2.5, 2.5, 2.5]);

    // $11 ÷ 4 = $2.75 each — divides exactly
    expect(amounts(computeSplits("equal", 11, ids, {}))).toEqual([2.75, 2.75, 2.75, 2.75]);

    // $10.01 ÷ 4 = $2.5025 → rounds to $2.50 + $2.50 + $2.50 + $2.51
    const splits = computeSplits("equal", 10.01, ids, {});
    expect(amounts(splits)).toEqual([2.5, 2.5, 2.5, 2.51]);
    expect(total(splits)).toBe(10.01);
  });

  it("always sums to the exact total for amounts with difficult rounding", () => {
    const tricky = [0.1, 0.01, 1.99, 7.77, 99.99, 100.0];
    const counts = [2, 3, 4, 5];
    for (const amount of tricky) {
      for (const n of counts) {
        const participants = ids.slice(0, n);
        const splits = computeSplits("equal", amount, participants, {});
        expect(total(splits)).toBe(amount);
      }
    }
  });

  it("returns empty array when participant list is empty", () => {
    expect(computeSplits("equal", 10, [], {})).toEqual([]);
  });
});

// ─── Shares split ────────────────────────────────────────────────────────────
// Business rule: each participant pays in proportion to their share weight.
// E.g. weights 2:1 means the first person pays twice as much as the second.
// The last participant absorbs any rounding remainder.

describe("shares split", () => {
  it("equal weights produce equal splits", () => {
    const splits = computeSplits("shares", 12, ["alice", "bob", "carol"], {
      shares: { alice: 1, bob: 1, carol: 1 },
    });
    expect(amounts(splits)).toEqual([4, 4, 4]);
    expect(total(splits)).toBe(12);
  });

  it("2:1 weighting gives proportional amounts", () => {
    // alice pays 2/3, bob pays 1/3
    const splits = computeSplits("shares", 9, ["alice", "bob"], {
      shares: { alice: 2, bob: 1 },
    });
    expect(amounts(splits)).toEqual([6, 3]);
    expect(total(splits)).toBe(9);
  });

  it("last participant absorbs rounding remainder", () => {
    // $10 with shares 1:1:1 → $3.33 + $3.33 + $3.34
    const splits = computeSplits("shares", 10, ["alice", "bob", "carol"], {
      shares: { alice: 1, bob: 1, carol: 1 },
    });
    expect(amounts(splits)).toEqual([3.33, 3.33, 3.34]);
    expect(total(splits)).toBe(10);
  });

  it("handles non-integer weights (e.g. 2.5:1.5)", () => {
    // alice: 2.5/4 * $10 = $6.25, bob: 1.5/4 * $10 = $3.75
    const splits = computeSplits("shares", 10, ["alice", "bob"], {
      shares: { alice: 2.5, bob: 1.5 },
    });
    expect(total(splits)).toBe(10);
    expect(splits[0].amount).toBe(6.25);
    expect(splits[1].amount).toBe(3.75);
  });

  it("returns empty array when all share weights are zero", () => {
    // Prevents divide-by-zero; the caller should not submit this case.
    const splits = computeSplits("shares", 10, ["alice", "bob"], {
      shares: { alice: 0, bob: 0 },
    });
    expect(splits).toEqual([]);
  });

  it("missing weight for a participant defaults to zero", () => {
    // If a participant has no share entry they contribute nothing to the
    // weight total, so the entire amount goes to the participant with weight.
    const splits = computeSplits("shares", 10, ["alice", "bob"], {
      shares: { alice: 1 }, // bob has no entry → weight 0
    });
    expect(splits[0].amount).toBe(10);
    expect(splits[1].amount).toBe(0);
  });

  it("always sums to the exact total", () => {
    const splits = computeSplits("shares", 7.77, ["alice", "bob", "carol"], {
      shares: { alice: 3, bob: 2, carol: 1 },
    });
    expect(total(splits)).toBe(7.77);
  });
});

// ─── Percentage split ─────────────────────────────────────────────────────────
// Business rule: each participant specifies what percentage of the total they
// owe. Percentages should sum to 100 (validated client-side). The last
// participant absorbs floating-point rounding from the others.

describe("percentage split", () => {
  it("50/50 split", () => {
    const splits = computeSplits("percentage", 10, ["alice", "bob"], {
      percentages: { alice: 50, bob: 50 },
    });
    expect(amounts(splits)).toEqual([5, 5]);
    expect(total(splits)).toBe(10);
  });

  it("70/30 split", () => {
    const splits = computeSplits("percentage", 15, ["alice", "bob"], {
      percentages: { alice: 70, bob: 30 },
    });
    expect(amounts(splits)).toEqual([10.5, 4.5]);
    expect(total(splits)).toBe(15);
  });

  it("33% / 33% / 34% approximates equal thirds", () => {
    const splits = computeSplits("percentage", 10, ["alice", "bob", "carol"], {
      percentages: { alice: 33, bob: 33, carol: 34 },
    });
    expect(amounts(splits)).toEqual([3.3, 3.3, 3.4]);
    expect(total(splits)).toBe(10);
  });

  it("last participant absorbs the floating-point rounding from earlier splits", () => {
    // 33.33% + 33.33% = 66.66% → alice $3.33, bob $3.33, carol gets remainder $3.34
    const splits = computeSplits("percentage", 10, ["alice", "bob", "carol"], {
      percentages: { alice: 33.33, bob: 33.33, carol: 33.34 },
    });
    expect(total(splits)).toBe(10);
  });

  it("always sums to the exact total", () => {
    const splits = computeSplits("percentage", 99.99, ["alice", "bob", "carol", "dave"], {
      percentages: { alice: 25, bob: 25, carol: 25, dave: 25 },
    });
    expect(total(splits)).toBe(99.99);
  });
});

// ─── Exact split ─────────────────────────────────────────────────────────────
// Business rule: each participant specifies their exact dollar amount.
// This is a pure pass-through — the client form validates that the amounts
// sum to the expense total before allowing submission.

describe("exact split", () => {
  it("passes through each participant's specified amount", () => {
    const splits = computeSplits("exact", 10, ["alice", "bob"], {
      exact: { alice: 7, bob: 3 },
    });
    expect(amounts(splits)).toEqual([7, 3]);
  });

  it("defaults to 0 when a participant has no entry", () => {
    const splits = computeSplits("exact", 10, ["alice", "bob"], {
      exact: { alice: 10 },
    });
    expect(splits[1].amount).toBe(0);
  });
});
