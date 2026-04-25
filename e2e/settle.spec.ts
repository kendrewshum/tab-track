import { test, expect } from "@playwright/test";
import { createTestGroup, fillExpenseBase } from "./helpers";

// Tests the full settle-up flow: suggested payments after expenses are added,
// marking debts as settled, recording manual payments, and the history log.

test.describe("Settle up", () => {
  test("suggested payment shows correct amount after an expense", async ({ page }) => {
    // Alice pays $10, split equally → Bob owes Alice $5.
    const id = await createTestGroup(page, "E2E Settle Basic", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Dinner", amount: "10", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    await page.getByRole("link", { name: /Settle up/i }).click();
    await expect(page).toHaveURL(`/groups/${id}/settle`);

    // Suggested payment: Bob pays Alice $5
    await expect(page.getByText("Bob")).toBeVisible();
    await expect(page.getByText("Alice")).toBeVisible();
    await expect(page.getByText("$5.00")).toBeVisible();
  });

  test("marking a debt as settled zeros out all balances", async ({ page }) => {
    const id = await createTestGroup(page, "E2E Settle Zero", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Drinks", amount: "20", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    await page.getByRole("link", { name: /Settle up/i }).click();
    await page.getByRole("button", { name: "Mark as Settled" }).click();

    // After settling, the page should show all clear
    await expect(page.getByText("All settled up!")).toBeVisible();

    // Group page should also show settled status
    await page.goto(`/groups/${id}`);
    await expect(page.getByText("✓ All settled up!")).toBeVisible();
  });

  test("simplified debts collapse a chain A→B→C into a single A→C payment", async ({ page }) => {
    // Expense 1: Alice pays $10 → Alice +$5, Bob -$5
    // Expense 2: Bob pays $10  → Bob +$5, Carol -$5
    // Net: Alice +$5, Bob $0, Carol -$5 → simplified: Carol pays Alice $5 directly.
    const id = await createTestGroup(page, "E2E Simplify", ["Alice", "Bob", "Carol"]);

    await fillExpenseBase(page, id, { description: "E1", amount: "10", paidBy: "Alice" });
    // Exclude Carol from first expense (Alice and Bob only)
    await page.locator("button.w-5.h-5.rounded").nth(2).click(); // uncheck Carol
    await page.getByRole("button", { name: "Add Expense" }).click();

    await fillExpenseBase(page, id, { description: "E2", amount: "10", paidBy: "Bob" });
    // Exclude Alice from second expense (Bob and Carol only)
    await page.locator("button.w-5.h-5.rounded").nth(0).click(); // uncheck Alice
    await page.getByRole("button", { name: "Add Expense" }).click();

    await page.goto(`/groups/${id}/settle`);
    // Should show exactly one suggested payment: Carol → Alice $5
    await expect(page.getByText("Carol")).toBeVisible();
    await expect(page.getByText("$5.00")).toBeVisible();
  });

  test("manual payment is recorded and appears in history", async ({ page }) => {
    const id = await createTestGroup(page, "E2E History", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Lunch", amount: "30", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    await page.goto(`/groups/${id}/settle`);

    // Record a manual payment via the "Record a Payment" form
    await page.locator("select[name='paidById']").last().selectOption({ label: "Bob" });
    await page.locator("select[name='paidToId']").last().selectOption({ label: "Alice" });
    await page.locator("input[name='amount']").last().fill("15");
    await page.locator("input[name='note']").fill("Venmo");
    await page.getByRole("button", { name: "Record Payment" }).click();

    await expect(page.getByText("Venmo")).toBeVisible();
    await expect(page.getByText("$15.00")).toBeVisible();
  });

  test("can delete a settlement record", async ({ page }) => {
    const id = await createTestGroup(page, "E2E Delete Settlement", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Taxi", amount: "10", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    await page.goto(`/groups/${id}/settle`);
    await page.getByRole("button", { name: "Mark as Settled" }).click();

    // Settlement appears in history — delete it
    await page.locator("button[title='Delete record']").click();

    // Debt should reappear now that settlement is removed
    await expect(page.getByText("Mark as Settled")).toBeVisible();
  });
});
