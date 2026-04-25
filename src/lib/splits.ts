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
 * Rounding rule: amounts are rounded to 2 decimal places. One participant
 * absorbs the remainder so splits always sum to exactly `amount`.
 *
 * Remainder assignment (equal / shares / percentage modes):
 *   - If the payer (payerId) is in the participant list they receive the
 *     remainder, giving them the slightly higher share. This makes the
 *     person who laid out the money whole to the nearest cent.
 *   - If the payer is not a participant, the last participant gets it.
 *
 * "exact" mode is a pure pass-through — the caller is responsible for
 * validating that the entered amounts sum to the total.
 */
export function computeSplits(
  splitType: SplitType,
  amount: number,
  participantIds: string[],
  inputs: SplitInputs = {},
  payerId?: string
): SplitEntry[] {
  const n = participantIds.length;
  if (n === 0) return [];

  const payerIdx =
    payerId !== undefined && participantIds.includes(payerId)
      ? participantIds.indexOf(payerId)
      : n - 1;

  // Distribute any rounding gap (in whole cents) so the payer is never
  // shortchanged:
  //   +N cents remaining → payer gets the first extra cent, then others
  //   -N cents remaining → non-payers absorb the discount first, payer last
  //
  // Working in integer cents avoids floating-point accumulation errors.
  const applyRemainder = (base: number[]): number[] => {
    const amountCents = Math.round(amount * 100);
    const cents = base.map((a) => Math.round(a * 100));
    const diff = amountCents - cents.reduce((s, c) => s + c, 0);
    if (diff === 0) return base;

    const step = diff > 0 ? 1 : -1;
    const result = [...cents];
    const order =
      diff > 0
        ? [payerIdx, ...Array.from({ length: n }, (_, i) => i).filter((i) => i !== payerIdx)]
        : [...Array.from({ length: n }, (_, i) => i).filter((i) => i !== payerIdx), payerIdx];

    for (let i = 0; i < Math.abs(diff) && i < order.length; i++) {
      result[order[i]] += step;
    }
    return result.map((c) => c / 100);
  };

  if (splitType === "equal") {
    const perPerson = r2(amount / n);
    const amounts = applyRemainder(new Array<number>(n).fill(perPerson));
    return participantIds.map((id, i) => ({ memberId: id, amount: amounts[i] }));
  }

  if (splitType === "shares") {
    const weights = participantIds.map((id) => inputs.shares?.[id] ?? 0);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    if (totalWeight === 0) return [];
    const base = weights.map((w) => r2((amount * w) / totalWeight));
    const amounts = applyRemainder(base);
    return participantIds.map((id, i) => ({ memberId: id, amount: amounts[i] }));
  }

  if (splitType === "percentage") {
    const base = participantIds.map((id) => r2(((inputs.percentages?.[id] ?? 0) * amount) / 100));
    const amounts = applyRemainder(base);
    return participantIds.map((id, i) => ({ memberId: id, amount: amounts[i] }));
  }

  // "exact": caller provides the dollar amount for each participant.
  return participantIds.map((id) => ({
    memberId: id,
    amount: inputs.exact?.[id] ?? 0,
  }));
}
