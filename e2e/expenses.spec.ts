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

    const expensesSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Expenses" }) });

    await expect(expensesSection.getByText("Hotel")).toBeVisible();
    await expect(expensesSection.getByText("$120.00", { exact: true })).toBeVisible();
    await expect(expensesSection.getByText(/Paid by Alice/)).toBeVisible();
  });

  test("can delete an expense and balances reset to zero", async ({ page }) => {
    const id = await createTestGroup(page, "E2E Delete", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Coffee", amount: "5", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    // Accept the confirmation dialog that appears before deletion
    page.on("dialog", (dialog) => dialog.accept());
    await page.locator("button[title='Delete expense']").click();

    // No expenses left — expense list shows empty state
    await expect(page.getByText("No expenses yet")).toBeVisible();
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

test.describe("Editing expenses", () => {
  test("edit page pre-populates description and amount", async ({ page }) => {
    const id = await createTestGroup(page, "E2E Edit Prepop", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Original Dinner", amount: "20", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    await page.locator("a[title='Edit expense']").click();
    await expect(page).toHaveURL(/\/expenses\/[^/]+\/edit$/);

    await expect(page.getByPlaceholder("e.g. Dinner, Hotel, Uber")).toHaveValue("Original Dinner");
    await expect(page.getByPlaceholder("0.00")).toHaveValue("20");
  });

  test("can edit description and amount, changes appear on group page", async ({ page }) => {
    const id = await createTestGroup(page, "E2E Edit Save", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Dinner", amount: "20", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    await page.locator("a[title='Edit expense']").click();
    await page.getByPlaceholder("e.g. Dinner, Hotel, Uber").fill("Updated Dinner");
    await page.getByPlaceholder("0.00").fill("30");
    await page.getByRole("button", { name: "Save Changes" }).click();

    await expect(page).toHaveURL(`/groups/${id}`);
    const expensesSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Expenses" }) });

    await expect(expensesSection.getByText("Updated Dinner")).toBeVisible();
    await expect(expensesSection.getByText("$30.00", { exact: true })).toBeVisible();
  });

  test("editing amount recalculates balances", async ({ page }) => {
    const id = await createTestGroup(page, "E2E Edit Balances", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Hotel", amount: "100", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    await expect(page.getByText("+$50.00")).toBeVisible();

    await page.locator("a[title='Edit expense']").click();
    await page.getByPlaceholder("0.00").fill("200");
    await page.getByRole("button", { name: "Save Changes" }).click();

    await expect(page.getByText("+$100.00")).toBeVisible();
  });

  test("can change the payer on an existing expense", async ({ page }) => {
    const id = await createTestGroup(page, "E2E Edit Payer", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Taxi", amount: "40", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    await page.locator("a[title='Edit expense']").click();
    await page.getByRole("combobox", { name: /Paid by/i }).selectOption({ label: "Bob" });
    await page.getByRole("button", { name: "Save Changes" }).click();

    // Bob now paid — Bob is owed $20, Alice owes $20
    await expect(page.getByText(/Paid by Bob/)).toBeVisible();
  });
});
