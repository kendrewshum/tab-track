import { computeSplits, type SplitEntry, type SplitInputs, type SplitType } from "./splits";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type ParsedExpenseForm = {
  description: string;
  amount: number;
  paidById: string;
  splitType: SplitType;
  date: string;
  participantIds: string[];
  splits: SplitEntry[];
};

export type ParsedSettlementForm = {
  paidById: string;
  paidToId: string;
  amount: number;
  note: string | null;
  date: string;
};

const splitTypes = new Set<SplitType>(["equal", "shares", "percentage", "exact"]);
const htmlNumberPattern = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function failure(error: string): ParseResult<never> {
  return { ok: false, error };
}

function readString(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

function parseFiniteNumber(value: string | null): number | null {
  const normalized = value?.trim();
  if (!normalized || !htmlNumberPattern.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCurrencyNumber(value: string | null): number | null {
  const parsed = parseFiniteNumber(value);
  if (parsed === null) return null;

  const cents = Math.round(parsed * 100);
  return Number.isFinite(cents) && cents / 100 === parsed ? parsed : null;
}

function roundCurrency(value: number): number | null {
  const rounded = Math.round(value * 100) / 100;
  return Number.isFinite(rounded) ? rounded : null;
}

function safeCurrencyCents(value: number): number | null {
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) && cents / 100 === value ? cents : null;
}

export function areSplitsValidForAmount(
  splits: SplitEntry[],
  amount: number,
  expectedSplitCount: number
): boolean {
  const amountCents = safeCurrencyCents(amount);
  if (splits.length !== expectedSplitCount || amountCents === null) {
    return false;
  }

  let splitTotalCents = 0;
  for (const split of splits) {
    const splitCents = safeCurrencyCents(split.amount);
    if (!Number.isFinite(split.amount) || split.amount < 0 || splitCents === null) {
      return false;
    }

    const nextTotalCents = splitTotalCents + splitCents;
    if (!Number.isSafeInteger(nextTotalCents)) return false;
    splitTotalCents = nextTotalCents;
  }

  return splitTotalCents === amountCents;
}

/**
 * Dates are accepted only as canonical Gregorian calendar dates in
 * `YYYY-MM-DD` form, with years from 0001 through 9999.
 */
function isCanonicalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year === 0 || month < 1 || month > 12) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function parseSplitInputs(
  formData: FormData,
  splitType: SplitType,
  participantIds: string[],
  amount: number
): ParseResult<SplitInputs> {
  if (splitType === "equal") return { ok: true, value: {} };

  const prefix = splitType === "shares" ? "share" : splitType === "percentage" ? "pct" : "exact";
  const values: Record<string, number> = {};

  for (const participantId of participantIds) {
    const rawValue = readString(formData, `${prefix}_${participantId}`);
    const parsed =
      splitType === "exact" ? parseCurrencyNumber(rawValue) : parseFiniteNumber(rawValue);
    if (parsed === null || parsed < 0) {
      return failure(`Invalid ${splitType} value`);
    }

    if (splitType === "exact") {
      const rounded = roundCurrency(parsed);
      if (rounded === null) return failure("Invalid exact value");
      if (safeCurrencyCents(rounded) === null) {
        return failure("Exact amount exceeds safe currency range");
      }
      values[participantId] = rounded;
    } else {
      values[participantId] = parsed;
    }
  }

  if (splitType === "shares") {
    const totalWeight = Object.values(values).reduce((total, value) => total + value, 0);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      return failure("Share weight must be positive");
    }
    return { ok: true, value: { shares: values } };
  }

  if (splitType === "percentage") {
    const percentageTotal = Object.values(values).reduce((total, value) => total + value, 0);
    const roundingTolerance =
      Number.EPSILON * Math.max(100, Math.abs(percentageTotal)) * participantIds.length;
    if (Math.abs(percentageTotal - 100) > roundingTolerance) {
      return failure("Percentages must total 100");
    }
    return { ok: true, value: { percentages: values } };
  }

  const exactTotalCents = Object.values(values).reduce(
    (total, value) => total + Math.round(value * 100),
    0
  );
  if (exactTotalCents !== Math.round(amount * 100)) {
    return failure("Exact amounts must total the expense amount");
  }
  return { ok: true, value: { exact: values } };
}

export function parseExpenseForm(formData: FormData): ParseResult<ParsedExpenseForm> {
  const description = readString(formData, "description")?.trim();
  const rawAmount = parseCurrencyNumber(readString(formData, "amount"));
  const paidById = readString(formData, "paidById");
  const rawSplitType = readString(formData, "splitType");
  const date = readString(formData, "date");
  const rawParticipantIds = formData.getAll("participants");

  if (!description) return failure("Description is required");
  if (rawAmount === null || rawAmount <= 0) return failure("Amount must be positive");

  const amount = roundCurrency(rawAmount);
  if (amount === null || amount <= 0) return failure("Amount must round to at least one cent");
  if (safeCurrencyCents(amount) === null) {
    return failure("Amount exceeds safe currency range");
  }
  if (!paidById) return failure("Payer is required");
  if (!rawSplitType || !splitTypes.has(rawSplitType as SplitType)) {
    return failure("Unknown split type");
  }
  if (!date || !isCanonicalDate(date)) return failure("Invalid date");

  if (
    rawParticipantIds.length === 0 ||
    rawParticipantIds.some((participantId) => typeof participantId !== "string")
  ) {
    return failure("Participants are required");
  }

  const participantIds = (rawParticipantIds as string[]).map((participantId) =>
    participantId.trim()
  );
  if (
    participantIds.some((participantId) => participantId.length === 0) ||
    new Set(participantIds).size !== participantIds.length
  ) {
    return failure("Participants must be unique and non-empty");
  }

  const splitType = rawSplitType as SplitType;
  const parsedInputs = parseSplitInputs(formData, splitType, participantIds, amount);
  if (!parsedInputs.ok) return parsedInputs;

  const splits = computeSplits(splitType, amount, participantIds, parsedInputs.value, paidById);
  if (!areSplitsValidForAmount(splits, amount, participantIds.length)) {
    return failure("Invalid split");
  }

  return {
    ok: true,
    value: {
      description,
      amount,
      paidById,
      splitType,
      date,
      participantIds,
      splits,
    },
  };
}

export function parseSettlementForm(formData: FormData): ParseResult<ParsedSettlementForm> {
  const paidById = readString(formData, "paidById");
  const paidToId = readString(formData, "paidToId");
  const rawAmount = parseCurrencyNumber(readString(formData, "amount"));
  const rawNote = formData.get("note");
  const date = readString(formData, "date");

  if (!paidById || !paidToId || paidById === paidToId) {
    return failure("Settlement members must be different");
  }
  if (rawAmount === null || rawAmount <= 0) return failure("Amount must be positive");

  const amount = roundCurrency(rawAmount);
  if (amount === null || amount <= 0) return failure("Amount must round to at least one cent");
  if (safeCurrencyCents(amount) === null) {
    return failure("Amount exceeds safe currency range");
  }
  if (rawNote !== null && typeof rawNote !== "string") return failure("Invalid note");
  if (!date || !isCanonicalDate(date)) return failure("Invalid date");

  return {
    ok: true,
    value: {
      paidById,
      paidToId,
      amount,
      note: typeof rawNote === "string" ? rawNote.trim() || null : null,
      date,
    },
  };
}
