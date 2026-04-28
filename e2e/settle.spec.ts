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

    const suggestedPayments = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Suggested Payments" }) });

    await expect(suggestedPayments.getByText("Bob", { exact: true })).toBeVisible();
    await expect(suggestedPayments.getByText("Alice", { exact: true })).toBeVisible();
    await expect(suggestedPayments.getByText("$5.00", { exact: true })).toBeVisible();
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

    const participantToggle = (memberName: string) =>
      page
        .locator("div.border.rounded-xl")
        .filter({ has: page.getByText(memberName, { exact: true }) })
        .getByRole("button")
        .first();

    await fillExpenseBase(page, id, { description: "E1", amount: "10", paidBy: "Alice" });
    // Exclude Carol from first expense (Alice and Bob only)
    await participantToggle("Carol").click();
    await page.getByRole("button", { name: "Add Expense" }).click();

    await fillExpenseBase(page, id, { description: "E2", amount: "10", paidBy: "Bob" });
    // Exclude Alice from second expense (Bob and Carol only)
    await participantToggle("Alice").click();
    await page.getByRole("button", { name: "Add Expense" }).click();

    await page.goto(`/groups/${id}/settle`);
    const suggestedPayments = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Suggested Payments" }) });

    await expect(suggestedPayments.getByText("Carol", { exact: true })).toBeVisible();
    await expect(suggestedPayments.getByText("Alice", { exact: true })).toBeVisible();
    await expect(suggestedPayments.getByText("$5.00", { exact: true })).toBeVisible();
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

  test("double-clicking Record Payment only records one payment", async ({ page }) => {
    const id = await createTestGroup(page, "E2E History Double Submit", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Lunch", amount: "30", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    await page.goto(`/groups/${id}/settle`);

    await page.locator("select[name='paidById']").last().selectOption({ label: "Bob" });
    await page.locator("select[name='paidToId']").last().selectOption({ label: "Alice" });
    await page.locator("input[name='amount']").last().fill("15");
    await page.locator("input[name='note']").fill("Venmo");
    await page.getByRole("button", { name: "Record Payment" }).dblclick();

    await expect(page.getByText("Venmo")).toHaveCount(1);
    await expect(page.getByText("$15.00")).toHaveCount(1);
    await expect(page.getByText("Payment recorded")).toHaveCount(1);
  });

  test("Record Payment shows a pending state while submission is in flight", async ({ page }) => {
    const id = await createTestGroup(page, "E2E Pending Payment", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Lunch", amount: "30", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    await page.goto(`/groups/${id}/settle`);
    await page.locator("select[name='paidById']").last().selectOption({ label: "Bob" });
    await page.locator("select[name='paidToId']").last().selectOption({ label: "Alice" });
    await page.locator("input[name='amount']").last().fill("15");
    await page.locator("input[name='note']").fill("Pending Venmo");

    let releaseSubmit: () => void;
    const submitBlocked = new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    let sawSubmitRequest = false;

    await page.route("**/*", async (route) => {
      const request = route.request();

      if (
        !sawSubmitRequest &&
        request.method() === "POST" &&
        new URL(request.url()).pathname === `/groups/${id}/settle`
      ) {
        sawSubmitRequest = true;
        await submitBlocked;
      }

      await route.continue();
    });

    const manualPaymentSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Record a Payment" }) });
    const submit = manualPaymentSection.locator('button[type="submit"]');
    const clickPromise = submit.click();

    await expect.poll(() => sawSubmitRequest).toBe(true);
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText("Recording...");

    releaseSubmit!();
    await clickPromise;

    await expect(page.getByText("Pending Venmo")).toBeVisible();
    await expect(page.getByText("$15.00")).toBeVisible();
  });

  test("editing a settled expense reopens balances and shows a warning on settle up", async ({ page }) => {
    const id = await createTestGroup(page, "E2E Reopen Debt", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Museum", amount: "10", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    await page.goto(`/groups/${id}/settle`);
    await page.getByRole("button", { name: "Mark as Settled" }).click();
    await expect(page.getByText("All settled up!")).toBeVisible();

    await page.goto(`/groups/${id}`);
    await page.locator("a[title='Edit expense']").click();
    await page.getByPlaceholder("0.00").first().fill("20");
    await page.getByRole("button", { name: "Save Changes" }).click();

    await expect(page.getByText("Bob owes Alice")).toBeVisible();

    await page.goto(`/groups/${id}/settle`);
    await expect(
      page.getByText("Payments remain in your history, but edited expenses reopened the current ledger.")
    ).toBeVisible();
  });

  test("editing a split after settlement adds an expense-edited activity entry", async ({ page }) => {
    const id = await createTestGroup(page, "E2E Split Activity", ["Alice", "Bob", "Carol"]);
    await fillExpenseBase(page, id, { description: "Boat", amount: "30", paidBy: "Alice" });
    await page.getByRole("button", { name: "Exact" }).click();
    await page.locator("input[name^='exact_']").nth(0).fill("10");
    await page.locator("input[name^='exact_']").nth(1).fill("10");
    await page.locator("input[name^='exact_']").nth(2).fill("10");
    await page.getByRole("button", { name: "Add Expense" }).click();

    await page.goto(`/groups/${id}/settle`);
    await page.getByRole("button", { name: "Mark as Settled" }).nth(0).click();
    await page.getByRole("button", { name: "Mark as Settled" }).nth(0).click();
    await expect(page.getByText("All settled up!")).toBeVisible();

    await page.goto(`/groups/${id}`);
    await page.locator("a[title='Edit expense']").click();
    await page.locator("input[name^='exact_']").nth(0).fill("0");
    await page.locator("input[name^='exact_']").nth(1).fill("15");
    await page.locator("input[name^='exact_']").nth(2).fill("15");
    await page.getByRole("button", { name: "Save Changes" }).click();

    const activitySection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Activity", exact: true }) });

    await expect(activitySection.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
    await expect(activitySection.getByText("Expense edited")).toBeVisible();
    await expect(activitySection.getByText("Boat").first()).toBeVisible();
  });

  test("activity archive shows the newest chunk first and preserves load more state", async ({ page }) => {
    const id = await createTestGroup(page, "E2E Activity Archive", ["Alice", "Bob"]);

    for (let index = 1; index <= 21; index += 1) {
      const date = `2026-01-${String(index).padStart(2, "0")}`;
      await fillExpenseBase(page, id, {
        description: `Expense ${String(index).padStart(2, "0")}`,
        amount: "10",
        paidBy: "Alice",
      });
      await page.locator("input[name='date']").fill(date);
      await page.getByRole("button", { name: "Add Expense" }).click();
    }

    const activitySection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Activity", exact: true }) });

    await page.goto(`/groups/${id}?activity=40.5`);
    await expect(activitySection.getByText("Expense 21")).toBeVisible();
    await expect(activitySection.getByText("Expense 02")).toBeVisible();
    await expect(activitySection.getByText("Expense 01")).toHaveCount(0);
    await expect(activitySection.getByRole("link", { name: "Load more activity" })).toBeVisible();

    await page.goto(`/groups/${id}?activity=40xyz`);
    await expect(activitySection.getByText("Expense 21")).toBeVisible();
    await expect(activitySection.getByText("Expense 02")).toBeVisible();
    await expect(activitySection.getByText("Expense 01")).toHaveCount(0);

    await page.goto(`/groups/${id}?activity=20&activity=40`);
    await expect(activitySection.getByText("Expense 21")).toBeVisible();
    await expect(activitySection.getByText("Expense 02")).toBeVisible();
    await expect(activitySection.getByText("Expense 01")).toHaveCount(0);

    await activitySection.getByRole("link", { name: "Load more activity" }).click();

    await expect(page).toHaveURL(new RegExp(`/groups/${id}\\?activity=40$`));
    await expect(activitySection.getByText("Expense 01")).toBeVisible();
    await expect(activitySection.getByRole("link", { name: "Load more activity" })).toHaveCount(0);

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/groups/${id}\\?activity=40$`));
    await expect(activitySection.getByText("Expense 01")).toBeVisible();

    await page.getByRole("link", { name: /Settle up/i }).click();
    await expect(page).toHaveURL(`/groups/${id}/settle?activity=40`);
    await page.locator("select[name='paidById']").last().selectOption({ label: "Bob" });
    await page.locator("select[name='paidToId']").last().selectOption({ label: "Alice" });
    await page.locator("input[name='amount']").last().fill("5");
    await page.locator("input[name='note']").fill("Archive state check");
    await page.getByRole("button", { name: "Record Payment" }).click();
    await expect(page).toHaveURL(`/groups/${id}/settle?activity=40`);
    await expect(page.getByText("Archive state check")).toBeVisible();

    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Reverse payment" }).first().click();
    await expect(page).toHaveURL(`/groups/${id}/settle?activity=40`);
    await expect(page.getByText("Payment reversed")).toBeVisible();
    await expect(page.getByText("Reversal of payment")).toBeVisible();

    await page.getByRole("link", { name: new RegExp(`← E2E Activity Archive`) }).click();
    await expect(page).toHaveURL(new RegExp(`/groups/${id}\\?activity=40$`));
    await expect(activitySection.getByText("Expense 01")).toBeVisible();
  });

  test("can reverse a settlement record without erasing the original payment", async ({ page }) => {
    const id = await createTestGroup(page, "E2E Delete Settlement", ["Alice", "Bob"]);
    await fillExpenseBase(page, id, { description: "Taxi", amount: "10", paidBy: "Alice" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    await page.goto(`/groups/${id}/settle`);
    await page.getByRole("button", { name: "Mark as Settled" }).click();

    // Accept the confirmation dialog that appears before deletion
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Reverse payment" }).click();

    await expect(page.getByText("Payment recorded")).toBeVisible();
    await expect(page.getByText("Payment reversed")).toBeVisible();
    await expect(page.getByText("Reversal of payment")).toBeVisible();
    await expect(page.getByText("Mark as Settled")).toBeVisible();
  });
});
