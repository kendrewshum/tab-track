import { expect, type Page } from "@playwright/test";

import { extractCreatedGroupId } from "../src/lib/group-url";

export type TestAccount = {
  displayName: string;
  email: string;
  password: string;
};

const DEFAULT_INVITE_CODE = process.env.E2E_APP_INVITE_CODE ?? "test-invite-code";

function buildRandomAccount(overrides?: Partial<TestAccount>): TestAccount {
  const suffix = `${Date.now()}-${Math.round(Math.random() * 10_000)}`;

  return {
    displayName: overrides?.displayName ?? `Test User ${suffix}`,
    email: overrides?.email ?? `test-${suffix}@example.com`,
    password: overrides?.password ?? "password123",
  };
}

export async function signUpAndLogin(
  page: Page,
  overrides?: Partial<TestAccount>
): Promise<TestAccount> {
  const account = buildRandomAccount(overrides);

  await page.goto("/signup");
  await page.getByPlaceholder("Your name").fill(account.displayName);
  await page.getByPlaceholder("you@example.com").fill(account.email);
  await page.getByPlaceholder("At least 8 characters").fill(account.password);
  await page.getByPlaceholder("Enter invite code").fill(DEFAULT_INVITE_CODE);
  await page.getByRole("button", { name: "Create Account" }).click();

  await page.waitForURL("/");
  await expect(page.getByRole("button", { name: /Sign Out/i })).toBeVisible();

  return account;
}

export async function signIn(page: Page, account: TestAccount) {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(account.email);
  await page.getByPlaceholder("Your password").fill(account.password);
  await page.getByRole("button", { name: "Sign In" }).click();

  await page.waitForURL("/");
  await expect(page.getByRole("button", { name: /Sign Out/i })).toBeVisible();
}

// Creates a group via the UI and returns the group ID extracted from the URL.
export async function createTestGroup(
  page: Page,
  name: string,
  memberNames: string[]
): Promise<string> {
  await signUpAndLogin(page);
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
