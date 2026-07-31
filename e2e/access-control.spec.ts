import {
  expect,
  test,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { extractCreatedGroupId } from "../src/lib/group-url";
import { fillExpenseBase, signUpAndLogin } from "./helpers";

type OwnerFixture = {
  ownerContext: BrowserContext;
  ownerPage: Page;
  outsiderContext: BrowserContext;
  outsiderPage: Page;
  groupId: string;
  groupName: string;
  expenseId: string;
  expenseDescription: string;
};

type CapturedPost = {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
};

async function createGroupForSignedInUser(
  page: Page,
  name: string,
  memberNames: [string, string]
) {
  await page.goto("/groups/new");
  await page.getByPlaceholder("e.g. Tokyo Trip, Apartment").fill(name);
  await page.getByPlaceholder("Member 1").fill(memberNames[0]);
  await page.getByPlaceholder("Member 2").fill(memberNames[1]);
  await page.getByRole("button", { name: "Create Group" }).click();
  await page.waitForURL((url) => extractCreatedGroupId(url.toString()) !== null);

  return extractCreatedGroupId(page.url())!;
}

async function createOwnerFixture(browser: Browser): Promise<OwnerFixture> {
  const suffix = `${Date.now()}-${Math.round(Math.random() * 10_000)}`;
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();

  await signUpAndLogin(ownerPage, {
    displayName: `Access Owner ${suffix}`,
    email: `access-owner-${suffix}@example.com`,
  });
  await signUpAndLogin(outsiderPage, {
    displayName: `Access Outsider ${suffix}`,
    email: `access-outsider-${suffix}@example.com`,
  });

  await createGroupForSignedInUser(
    outsiderPage,
    `Outsider Group ${suffix}`,
    ["Outsider One", "Outsider Two"]
  );

  const groupName = `Owner Vault ${suffix}`;
  const expenseDescription = `Owner Secret Dinner ${suffix}`;
  const groupId = await createGroupForSignedInUser(ownerPage, groupName, ["Alice", "Bob"]);
  await fillExpenseBase(ownerPage, groupId, {
    description: expenseDescription,
    amount: "20",
    paidBy: "Alice",
  });
  await ownerPage.getByRole("button", { name: "Add Expense" }).click();
  await expect(ownerPage).toHaveURL(`/groups/${groupId}`);

  const editHref = await ownerPage.locator("a[title='Edit expense']").getAttribute("href");
  const expenseId = editHref?.match(/\/expenses\/([^/]+)\/edit$/)?.[1];
  if (!expenseId) {
    throw new Error(`Expected an expense edit URL, got ${editHref}`);
  }

  return {
    ownerContext,
    ownerPage,
    outsiderContext,
    outsiderPage,
    groupId,
    groupName,
    expenseId,
    expenseDescription,
  };
}

async function expectNotFoundWithoutDisclosure(
  page: Page,
  url: string,
  ownerOnlyText: string[]
) {
  const response = await page.goto(url);

  expect(response?.status()).toBe(404);
  await expect(page.getByText("404", { exact: true })).toBeVisible();
  await expect(page.getByText("Page not found", { exact: true })).toBeVisible();

  for (const secret of ownerOnlyText) {
    await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
  }
}

async function captureAbortedPost(
  page: Page,
  pathname: string,
  submit: () => Promise<void>
): Promise<CapturedPost> {
  let resolveCaptured!: (request: CapturedPost) => void;
  const captured = new Promise<CapturedPost>((resolve) => {
    resolveCaptured = resolve;
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || new URL(request.url()).pathname !== pathname) {
      await route.continue();
      return;
    }

    const body = request.postDataBuffer();
    if (!body) {
      await route.abort();
      throw new Error("Expected the server action request to have a body");
    }

    resolveCaptured({
      url: request.url(),
      headers: await request.allHeaders(),
      body,
    });
    await route.abort();
  });

  await submit();
  const request = await captured;
  await page.unroute("**/*");
  return request;
}

async function replayAsOutsider(
  outsiderContext: BrowserContext,
  request: CapturedPost
): Promise<APIResponse> {
  const excludedHeaders = new Set([
    "connection",
    "content-length",
    "cookie",
    "host",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
  ]);
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(([name]) => !excludedHeaders.has(name.toLowerCase()))
  );

  return outsiderContext.request.post(request.url, {
    headers,
    data: request.body,
    maxRedirects: 0,
  });
}

test.describe("Cross-account access control", () => {
  test("an outsider cannot open owner group pages or discover their contents", async ({
    browser,
  }) => {
    const fixture = await createOwnerFixture(browser);
    const secrets = [fixture.groupName, fixture.expenseDescription, "Alice", "Bob"];

    try {
      for (const url of [
        `/groups/${fixture.groupId}`,
        `/groups/${fixture.groupId}/expenses/new`,
        `/groups/${fixture.groupId}/expenses/${fixture.expenseId}/edit`,
        `/groups/${fixture.groupId}/settle`,
      ]) {
        await expectNotFoundWithoutDisclosure(fixture.outsiderPage, url, secrets);
      }
    } finally {
      await fixture.ownerContext.close();
      await fixture.outsiderContext.close();
    }
  });

  test("an outsider cannot replay a crafted settlement creation", async ({ browser }) => {
    const fixture = await createOwnerFixture(browser);
    const settlementNote = `Stolen settlement ${Date.now()}`;

    try {
      await fixture.ownerPage.goto(`/groups/${fixture.groupId}/settle`);
      const manualPayment = fixture.ownerPage
        .locator("section")
        .filter({ has: fixture.ownerPage.getByRole("heading", { name: "Record a Payment" }) });
      await manualPayment.locator("select[name='paidById']").selectOption({ label: "Bob" });
      await manualPayment.locator("select[name='paidToId']").selectOption({ label: "Alice" });
      await manualPayment.locator("input[name='amount']").fill("10");
      await manualPayment.locator("input[name='note']").fill(settlementNote);

      const craftedRequest = await captureAbortedPost(
        fixture.ownerPage,
        `/groups/${fixture.groupId}/settle`,
        () => manualPayment.getByRole("button", { name: "Record Payment" }).click()
      );
      const response = await replayAsOutsider(fixture.outsiderContext, craftedRequest);

      expect(response.status()).toBe(404);
      expect(await response.text()).not.toContain(fixture.groupName);
      expect(await response.text()).not.toContain(fixture.expenseDescription);

      await fixture.ownerPage.goto(`/groups/${fixture.groupId}/settle`);
      await expect(fixture.ownerPage.getByText(settlementNote, { exact: true })).toHaveCount(0);
      await expect(fixture.ownerPage.getByText("Payment recorded", { exact: true })).toHaveCount(0);
    } finally {
      await fixture.ownerContext.close();
      await fixture.outsiderContext.close();
    }
  });

  test("an outsider cannot replay a crafted expense update", async ({ browser }) => {
    const fixture = await createOwnerFixture(browser);
    const replacementDescription = `Outsider changed this ${Date.now()}`;

    try {
      await fixture.ownerPage.goto(
        `/groups/${fixture.groupId}/expenses/${fixture.expenseId}/edit`
      );
      await fixture.ownerPage
        .getByPlaceholder("e.g. Dinner, Hotel, Uber")
        .fill(replacementDescription);

      const craftedRequest = await captureAbortedPost(
        fixture.ownerPage,
        `/groups/${fixture.groupId}/expenses/${fixture.expenseId}/edit`,
        () => fixture.ownerPage.getByRole("button", { name: "Save Changes" }).click()
      );
      const response = await replayAsOutsider(fixture.outsiderContext, craftedRequest);

      expect(response.status()).toBe(404);
      expect(await response.text()).not.toContain(fixture.groupName);
      expect(await response.text()).not.toContain(fixture.expenseDescription);

      await fixture.ownerPage.goto(`/groups/${fixture.groupId}`);
      await expect(
        fixture.ownerPage.getByText(fixture.expenseDescription, { exact: true })
      ).toBeVisible();
      await expect(
        fixture.ownerPage.getByText(replacementDescription, { exact: true })
      ).toHaveCount(0);
    } finally {
      await fixture.ownerContext.close();
      await fixture.outsiderContext.close();
    }
  });
});
