// Business logic for dividing an expense amount among participants.
// Kept separate from server actions so it can be unit-tested without a
// database, HTTP context, or browser APIs (FormData).

export type SplitEntry = { memberId: string; amount: number };
export type SplitType = "equal" | "shares" | "percentage" | "exact";

// Per-participant values keyed by member ID.
// Only the fields relevant to the chosen SplitType need to be populated.
export type SplitInputs = {
  shares?: Record<string, number>;       // relative weight per participant
  percentages?: Record<string, number>;  // 0–100 per participant
  exact?: Record<string, number>;        // explicit dollar amount per participant
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compute per-participant split amounts for an expense.
 *
 * Rounding rule (equal / shares / percentage): amounts are rounded to
 * 2 decimal places; the LAST participant in the list absorbs any remainder
 * so the splits always sum to exactly `amount`. This prevents a $0.01 gap
 * when dividing amounts that don't divide evenly (e.g. $10 ÷ 3).
 *
 * "exact" mode is a pure pass-through — the caller (client form) is
 * responsible for validating that the entered amounts sum to the total.
 *
 * "percentage" mode uses the same last-person rule to handle floating-point
 * noise. The caller must validate that percentages sum to 100 before saving.
 */
export function computeSplits(
  splitType: SplitType,
  amount: number,
  participantIds: string[],
  inputs: SplitInputs = {}
): SplitEntry[] {
  const n = participantIds.length;
  if (n === 0) return [];

  if (splitType === "equal") {
    const perPerson = r2(amount / n);
    let allocated = 0;
    return participantIds.map((id, i) => {
      const a = i < n - 1 ? perPerson : r2(amount - allocated);
      if (i < n - 1) allocated = r2(allocated + a);
      return { memberId: id, amount: a };
    });
  }

  if (splitType === "shares") {
    const weights = participantIds.map((id) => inputs.shares?.[id] ?? 0);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    if (totalWeight === 0) return [];
    let allocated = 0;
    return participantIds.map((id, i) => {
      const a = i < n - 1 ? r2((amount * weights[i]) / totalWeight) : r2(amount - allocated);
      if (i < n - 1) allocated = r2(allocated + a);
      return { memberId: id, amount: a };
    });
  }

  if (splitType === "percentage") {
    let allocated = 0;
    return participantIds.map((id, i) => {
      const pct = inputs.percentages?.[id] ?? 0;
      const a = i < n - 1 ? r2((amount * pct) / 100) : r2(amount - allocated);
      if (i < n - 1) allocated = r2(allocated + a);
      return { memberId: id, amount: a };
    });
  }

  // "exact": caller provides the exact dollar amount per participant.
  return participantIds.map((id) => ({
    memberId: id,
    amount: inputs.exact?.[id] ?? 0,
  }));
}
