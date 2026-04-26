import { expect, type Page } from "@playwright/test";

import { extractCreatedGroupId } from "../src/lib/group-url";

// Creates a group via the UI and returns the group ID extracted from the URL.
export async function createTestGroup(
  page: Page,
  name: string,
  memberNames: string[]
): Promise<string> {
  await page.goto("/groups/new");
  await page.getByPlaceholder("e.g. Tokyo Trip, Apartment").fill(name);

  const existing = page.getByPlaceholder(/Member \d+/);
  const preRendered = await existing.count();

  for (let i = 0; i < memberNames.length; i++) {
    if (i < preRendered) {
      await existing.nth(i).fill(memberNames[i]);
    } else {
      await page.getByRole("button", { name: /Add another member/ }).click();
      await page.getByPlaceholder(/Member \d+/).last().fill(memberNames[i]);
    }
  }

  await page.getByRole("button", { name: "Create Group" }).click();
  await page.waitForURL((url) => extractCreatedGroupId(url.toString()) !== null);
  await expect(page.getByRole("heading", { name })).toBeVisible();

  const groupId = extractCreatedGroupId(page.url());
  if (!groupId) {
    throw new Error(`Expected a created group URL, got ${page.url()}`);
  }

  return groupId;
}

// Navigates to the add-expense form and fills in the basic fields.
// Returns without submitting so the caller can customise the split.
export async function fillExpenseBase(
  page: Page,
  groupId: string,
  opts: { description: string; amount: string; paidBy?: string }
) {
  await page.goto(`/groups/${groupId}/expenses/new`);
  await expect(page.getByRole("heading", { name: "Add Expense" })).toBeVisible();
  await page.getByPlaceholder("e.g. Dinner, Hotel, Uber").fill(opts.description);
  await page.getByPlaceholder("0.00").fill(opts.amount);
  if (opts.paidBy) {
    await page.getByRole("combobox", { name: /Paid by/i }).selectOption({ label: opts.paidBy });
  }
}
