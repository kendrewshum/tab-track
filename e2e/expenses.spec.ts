import { test, expect } from "@playwright/test";
import { createTestGroup, fillExpenseBase } from "./helpers";

// Tests the full expense-entry flow: form submission with all four split
// modes, correct balance display, and expense deletion.
//
// Balance math is verified end-to-end here (form → server action → DB →
// calculateBalances → UI) as a complement to the unit tests in
// src/lib/__tests__/splits.test.ts and balances.test.ts.

test.describe("Adding expenses – equal split", () => {
  test("$10 split equally between two people shows +$5 / −$5", async ({ page }) => {
    const id = await createTestGroup(page, "E2E Equal 2", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Dinner", amount: "10", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    await expect(page).toHaveURL(`/groups/${id}`);
    await expect(page.getByText("+$5.00")).toBeVisible();
    await expect(page.getByText("-$5.00")).toBeVisible();
  });

  test("payer gets the higher cent when $10 splits 3 ways ($3.34 not $3.33)", async ({ page }) => {
    // Rounding rule: Alice paid → Alice owes $3.34, others $3.33 each.
    const id = await createTestGroup(page, "E2E Equal 3", ["Alice", "Bob", "Carol"]);
    await fillExpenseBase(page, id, { description: "Lunch", amount: "10", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    // Expense card should show the per-person splits
    await expect(page.getByText("Alice: $3.34")).toBeVisible();
    await expect(page.getByText("Bob: $3.33")).toBeVisible();
    await expect(page.getByText("Carol: $3.33")).toBeVisible();
  });

  test("expense appears in the list with payer and amount", async ({ page }) => {
    const id = await createTestGroup(page, "E2E List", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Hotel", amount: "120", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    await expect(page.getByText("Hotel")).toBeVisible();
    await expect(page.getByText("$120.00")).toBeVisible();
    await expect(page.getByText(/Paid by Alice/)).toBeVisible();
  });

  test("can delete an expense and balances reset to zero", async ({ page }) => {
    const id = await createTestGroup(page, "E2E Delete", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Coffee", amount: "5", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    // Delete the expense using the × button
    await page.locator("button[title='Delete expense']").click();

    // No expenses left — balances should show settled up
    await expect(page.getByText("All settled up!")).toBeVisible();
  });
});

test.describe("Adding expenses – shares split", () => {
  test("2:1 shares correctly allocates twice as much to the payer", async ({ page }) => {
    // Alice (payer) has 2 shares, Bob has 1 share. Total $9.
    // Alice owes $6, Bob owes $3.
    const id = await createTestGroup(page, "E2E Shares", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Groceries", amount: "9", paidBy: "Alice" });

    await page.getByRole("button", { name: "Shares" }).click();
    // The inputs are named share_<uuid> — target by position (Alice=first, Bob=second)
    await page.locator("input[name^='share_']").first().fill("2");
    await page.locator("input[name^='share_']").last().fill("1");

    await page.getByRole("button", { name: "Add Expense" }).click();

    await expect(page.getByText("Alice: $6.00")).toBeVisible();
    await expect(page.getByText("Bob: $3.00")).toBeVisible();
    // Alice paid $9 and owes $6 → net +$3
    await expect(page.getByText("+$3.00")).toBeVisible();
  });
});

test.describe("Adding expenses – percentage split", () => {
  test("70% / 30% split produces correct amounts", async ({ page }) => {
    const id = await createTestGroup(page, "E2E Pct", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Concert", amount: "40", paidBy: "Alice" });

    await page.getByRole("button", { name: "%" }).click();
    await page.locator("input[name^='pct_']").first().fill("70");
    await page.locator("input[name^='pct_']").last().fill("30");

    await page.getByRole("button", { name: "Add Expense" }).click();

    await expect(page.getByText("Alice: $28.00")).toBeVisible();
    await expect(page.getByText("Bob: $12.00")).toBeVisible();
  });
});

test.describe("Adding expenses – exact split", () => {
  test("exact amounts are stored and displayed as entered", async ({ page }) => {
    const id = await createTestGroup(page, "E2E Exact", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Taxi", amount: "17.50", paidBy: "Alice" });

    await page.getByRole("button", { name: "Exact" }).click();
    await page.locator("input[name^='exact_']").first().fill("10");
    await page.locator("input[name^='exact_']").last().fill("7.50");

    await page.getByRole("button", { name: "Add Expense" }).click();

    await expect(page.getByText("Alice: $10.00")).toBeVisible();
    await expect(page.getByText("Bob: $7.50")).toBeVisible();
  });
});
