import { describe, expect, it } from "vitest";

import {
  areSplitsValidForAmount,
  parseExpenseForm,
  parseSettlementForm,
} from "../form-parsing";

describe("areSplitsValidForAmount", () => {
  it("validates computed split integrity", () => {
    expect(
      areSplitsValidForAmount(
        [
          { memberId: "alice", amount: 0.1 },
          { memberId: "bob", amount: 0.2 },
        ],
        0.3,
        2
      )
    ).toBe(true);

    expect(
      areSplitsValidForAmount([{ memberId: "alice", amount: Number.POSITIVE_INFINITY }], 1, 1)
    ).toBe(false);
    expect(
      areSplitsValidForAmount(
        [
          { memberId: "alice", amount: 1.01 },
          { memberId: "bob", amount: -0.01 },
        ],
        1,
        2
      )
    ).toBe(false);
    expect(
      areSplitsValidForAmount([{ memberId: "alice", amount: 0.001 }], 0.01, 1)
    ).toBe(false);
    expect(
      areSplitsValidForAmount(
        [
          { memberId: "alice", amount: 0.49 },
          { memberId: "bob", amount: 0.5 },
        ],
        1,
        2
      )
    ).toBe(false);
    expect(areSplitsValidForAmount([{ memberId: "alice", amount: 1 }], 1, 2)).toBe(false);
  });

  it("rejects a one-cent total difference above the safe integer range", () => {
    expect(
      areSplitsValidForAmount(
        [
          { memberId: "alice", amount: 1e15 },
          { memberId: "bob", amount: 0.01 },
        ],
        1e15,
        2
      )
    ).toBe(false);
  });
});

function validExpenseForm(splitType = "equal") {
  const formData = new FormData();
  formData.set("description", "  Dinner  ");
  formData.set("amount", "10");
  formData.set("paidById", "alice");
  formData.set("splitType", splitType);
  formData.set("date", "2026-07-29");
  formData.append("participants", "alice");
  formData.append("participants", "bob");
  return formData;
}

function expectExpenseFailure(mutator: (formData: FormData) => void) {
  const formData = validExpenseForm();
  mutator(formData);
  expect(parseExpenseForm(formData)).toMatchObject({ ok: false });
}

describe("parseExpenseForm", () => {
  it("normalizes a valid equal split", () => {
    const result = parseExpenseForm(validExpenseForm());

    expect(result).toEqual({
      ok: true,
      value: {
        description: "Dinner",
        amount: 10,
        paidById: "alice",
        splitType: "equal",
        date: "2026-07-29",
        participantIds: ["alice", "bob"],
        splits: [
          { memberId: "alice", amount: 5 },
          { memberId: "bob", amount: 5 },
        ],
      },
    });
  });

  it("calculates shares from a two-decimal expense amount", () => {
    const formData = validExpenseForm("shares");
    formData.set("amount", "10.00");
    formData.set("share_alice", "2");
    formData.set("share_bob", "1");

    const result = parseExpenseForm(formData);

    expect(result).toMatchObject({
      ok: true,
      value: {
        amount: 10,
        splits: [
          { memberId: "alice", amount: 6.67 },
          { memberId: "bob", amount: 3.33 },
        ],
      },
    });
  });

  it("rejects a crafted shares expense whose cents exceed the safe integer range", () => {
    const formData = validExpenseForm("shares");
    formData.set("amount", "1e305");
    formData.set("share_alice", "1e308");
    formData.set("share_bob", "1");

    expect(parseExpenseForm(formData)).toEqual({
      ok: false,
      error: "Amount exceeds safe currency range",
    });
  });

  it("accepts percentages totaling 100", () => {
    const formData = validExpenseForm("percentage");
    formData.set("pct_alice", "70");
    formData.set("pct_bob", "30");

    expect(parseExpenseForm(formData)).toMatchObject({
      ok: true,
      value: {
        splits: [
          { memberId: "alice", amount: 7 },
          { memberId: "bob", amount: 3 },
        ],
      },
    });
  });

  it("accepts decimal percentages totaling exactly 100", () => {
    const formData = validExpenseForm("percentage");
    formData.append("participants", "charlie");
    formData.set("pct_alice", "0.01");
    formData.set("pct_bob", "64.04");
    formData.set("pct_charlie", "35.95");

    const result = parseExpenseForm(formData);

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.splits.reduce((total, split) => total + split.amount, 0)).toBe(10);
    }
  });

  it("accepts exact values totaling the expense amount", () => {
    const formData = validExpenseForm("exact");
    formData.set("amount", "10.00");
    formData.set("exact_alice", "4");
    formData.set("exact_bob", "6");

    expect(parseExpenseForm(formData)).toMatchObject({
      ok: true,
      value: {
        amount: 10,
        splits: [
          { memberId: "alice", amount: 4 },
          { memberId: "bob", amount: 6 },
        ],
      },
    });
  });

  it.each(["description", "amount", "paidById", "splitType", "date"])(
    "rejects a missing %s field",
    (field) => expectExpenseFailure((formData) => formData.delete(field))
  );

  it.each(["description", "amount", "paidById", "splitType", "date"])(
    "rejects a non-string %s field",
    (field) =>
      expectExpenseFailure((formData) =>
        formData.set(field, new Blob(["value"]), `${field}.txt`)
      )
  );

  it("rejects a blank description", () => {
    expectExpenseFailure((formData) => formData.set("description", "   "));
  });

  it.each(["not-a-number", "Infinity", "-Infinity", "NaN", "0", "-1"])(
    "rejects invalid expense amount %s",
    (amount) => expectExpenseFailure((formData) => formData.set("amount", amount))
  );

  it.each(["1.005", "0.145"])("rejects sub-cent expense amount %s", (amount) => {
    expectExpenseFailure((formData) => formData.set("amount", amount));
  });

  it("rejects an expense amount whose cents exceed the safe integer range", () => {
    const formData = validExpenseForm();
    formData.set("amount", "1e15");

    expect(parseExpenseForm(formData)).toEqual({
      ok: false,
      error: "Amount exceeds safe currency range",
    });
  });

  it.each(["10", "10.5", "10.50"])(
    "accepts expense amount with at most two fractional digits: %s",
    (amount) => {
      const formData = validExpenseForm();
      formData.set("amount", amount);

      expect(parseExpenseForm(formData)).toMatchObject({ ok: true });
    }
  );

  it.each([
    ["1.230", 1.23],
    ["0.0100", 0.01],
    ["100e-3", 0.1],
  ])("accepts numerically cent-aligned expense amount %s", (amount, normalizedAmount) => {
    const formData = validExpenseForm();
    formData.set("amount", amount);

    expect(parseExpenseForm(formData)).toMatchObject({
      ok: true,
      value: { amount: normalizedAmount },
    });
  });

  it("rejects an amount that rounds to zero cents", () => {
    expectExpenseFailure((formData) => formData.set("amount", "0.001"));
  });

  it("rejects an unknown split type", () => {
    expectExpenseFailure((formData) => formData.set("splitType", "custom"));
  });

  it("rejects an empty participant list", () => {
    expectExpenseFailure((formData) => formData.delete("participants"));
  });

  it("rejects an empty participant ID", () => {
    expectExpenseFailure((formData) => formData.append("participants", " "));
  });

  it("rejects a duplicate participant ID", () => {
    expectExpenseFailure((formData) => formData.append("participants", "alice"));
  });

  it("rejects a non-string participant ID", () => {
    expectExpenseFailure((formData) =>
      formData.append("participants", new Blob(["alice"]), "participant.txt")
    );
  });

  it.each([
    "2026-7-29",
    "2026-02-29",
    "2026-04-31",
    "0000-01-01",
    "10000-01-01",
    "not-a-date",
  ])("rejects invalid canonical date %s", (date) => {
    expectExpenseFailure((formData) => formData.set("date", date));
  });

  it("accepts February 29 in a Gregorian leap year", () => {
    const formData = validExpenseForm();
    formData.set("date", "2024-02-29");

    expect(parseExpenseForm(formData)).toMatchObject({
      ok: true,
      value: { date: "2024-02-29" },
    });
  });

  it.each([
    ["missing", undefined],
    ["negative", "-1"],
    ["non-finite", "Infinity"],
    ["malformed", "1share"],
  ])("rejects a %s shares input", (_label, value) => {
    const formData = validExpenseForm("shares");
    formData.set("share_alice", "1");
    formData.set("share_bob", "1");
    if (value === undefined) formData.delete("share_bob");
    else formData.set("share_bob", value);

    expect(parseExpenseForm(formData)).toMatchObject({ ok: false });
  });

  it("rejects shares with zero total weight", () => {
    const formData = validExpenseForm("shares");
    formData.set("share_alice", "0");
    formData.set("share_bob", "0");

    expect(parseExpenseForm(formData)).toMatchObject({ ok: false });
  });

  it.each([
    ["missing", undefined],
    ["negative", "-1"],
    ["non-finite", "Infinity"],
    ["malformed", "25percent"],
  ])("rejects a %s percentage input", (_label, value) => {
    const formData = validExpenseForm("percentage");
    formData.set("pct_alice", "50");
    formData.set("pct_bob", "50");
    if (value === undefined) formData.delete("pct_bob");
    else formData.set("pct_bob", value);

    expect(parseExpenseForm(formData)).toMatchObject({ ok: false });
  });

  it.each([
    ["below", "49.99"],
    ["above", "50.01"],
  ])("rejects percentage totals %s 100", (_label, secondPercentage) => {
    const formData = validExpenseForm("percentage");
    formData.set("pct_alice", "50");
    formData.set("pct_bob", secondPercentage);

    expect(parseExpenseForm(formData)).toMatchObject({ ok: false });
  });

  it.each([
    ["missing", undefined],
    ["negative", "-1"],
    ["non-finite", "Infinity"],
    ["malformed", "$5"],
  ])("rejects a %s exact input", (_label, value) => {
    const formData = validExpenseForm("exact");
    formData.set("exact_alice", "5");
    formData.set("exact_bob", "5");
    if (value === undefined) formData.delete("exact_bob");
    else formData.set("exact_bob", value);

    expect(parseExpenseForm(formData)).toMatchObject({ ok: false });
  });

  it("rejects a sub-cent exact input", () => {
    const formData = validExpenseForm("exact");
    formData.set("exact_alice", "5.004");
    formData.set("exact_bob", "4.996");

    expect(parseExpenseForm(formData)).toMatchObject({ ok: false });
  });

  it("rejects an exact input whose cents exceed the safe integer range", () => {
    const formData = validExpenseForm("exact");
    formData.set("exact_alice", "1e15");
    formData.set("exact_bob", "0");

    expect(parseExpenseForm(formData)).toEqual({
      ok: false,
      error: "Exact amount exceeds safe currency range",
    });
  });

  it("accepts exact inputs with insignificant trailing zeros", () => {
    const formData = validExpenseForm("exact");
    formData.set("exact_alice", "0.0100");
    formData.set("exact_bob", "9.9900");

    expect(parseExpenseForm(formData)).toMatchObject({
      ok: true,
      value: {
        splits: [
          { memberId: "alice", amount: 0.01 },
          { memberId: "bob", amount: 9.99 },
        ],
      },
    });
  });

  it.each([
    ["below", "4.99"],
    ["above", "5.01"],
  ])("rejects exact totals %s the rounded amount", (_label, secondExact) => {
    const formData = validExpenseForm("exact");
    formData.set("exact_alice", "5");
    formData.set("exact_bob", secondExact);

    expect(parseExpenseForm(formData)).toMatchObject({ ok: false });
  });
});

function validSettlementForm() {
  const formData = new FormData();
  formData.set("paidById", "bob");
  formData.set("paidToId", "alice");
  formData.set("amount", "5.67");
  formData.set("note", "  Venmo  ");
  formData.set("date", "2026-07-29");
  return formData;
}

function expectSettlementFailure(mutator: (formData: FormData) => void) {
  const formData = validSettlementForm();
  mutator(formData);
  expect(parseSettlementForm(formData)).toMatchObject({ ok: false });
}

describe("parseSettlementForm", () => {
  it("normalizes a valid settlement", () => {
    expect(parseSettlementForm(validSettlementForm())).toEqual({
      ok: true,
      value: {
        paidById: "bob",
        paidToId: "alice",
        amount: 5.67,
        note: "Venmo",
        date: "2026-07-29",
      },
    });
  });

  it.each(["paidById", "paidToId", "amount", "date"])(
    "rejects a missing %s field",
    (field) => expectSettlementFailure((formData) => formData.delete(field))
  );

  it.each(["paidById", "paidToId", "amount", "note", "date"])(
    "rejects a non-string %s field",
    (field) =>
      expectSettlementFailure((formData) =>
        formData.set(field, new Blob(["value"]), `${field}.txt`)
      )
  );

  it("rejects a settlement paid to the payer", () => {
    expectSettlementFailure((formData) => formData.set("paidToId", "bob"));
  });

  it.each(["not-a-number", "Infinity", "-Infinity", "NaN", "0", "-1", "0.001"])(
    "rejects invalid settlement amount %s",
    (amount) => expectSettlementFailure((formData) => formData.set("amount", amount))
  );

  it.each(["1.005", "0.145"])("rejects sub-cent settlement amount %s", (amount) => {
    expectSettlementFailure((formData) => formData.set("amount", amount));
  });

  it("rejects a settlement amount whose cents exceed the safe integer range", () => {
    const formData = validSettlementForm();
    formData.set("amount", "1e15");

    expect(parseSettlementForm(formData)).toEqual({
      ok: false,
      error: "Amount exceeds safe currency range",
    });
  });

  it("accepts a cent-aligned settlement amount with trailing zeros", () => {
    const formData = validSettlementForm();
    formData.set("amount", "1.230");

    expect(parseSettlementForm(formData)).toMatchObject({
      ok: true,
      value: { amount: 1.23 },
    });
  });

  it.each(["2026-02-29", "2026-04-31", "07/29/2026"])(
    "rejects invalid settlement date %s",
    (date) => expectSettlementFailure((formData) => formData.set("date", date))
  );

  it("turns a missing or blank note into null", () => {
    const missingNote = validSettlementForm();
    missingNote.delete("note");
    const blankNote = validSettlementForm();
    blankNote.set("note", "   ");

    expect(parseSettlementForm(missingNote)).toMatchObject({
      ok: true,
      value: { note: null },
    });
    expect(parseSettlementForm(blankNote)).toMatchObject({
      ok: true,
      value: { note: null },
    });
  });
});
