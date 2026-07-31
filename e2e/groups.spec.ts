import {
  test,
  expect,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type Route,
  type TestInfo,
} from "@playwright/test";
import { extractCreatedGroupId } from "../src/lib/group-url";
import { createTestGroup, fillExpenseBase, signUpAndLogin } from "./helpers";

// Tests the full lifecycle of groups: creation, listing, member management,
// navigation, and deletion. Each test creates its own group so tests are
// independent and can be run in any order within this file.

type CapturedPost = {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
};

function appAccessSection(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "App Access" }) });
}

function accountAccessRow(page: Page, email: string) {
  return appAccessSection(page)
    .getByRole("heading", { name: "Accounts" })
    .locator("xpath=following-sibling::div[1]")
    .locator(":scope > div")
    .filter({ has: page.getByText(email, { exact: true }) })
    .filter({ has: page.getByLabel("Ledger member") });
}

function pendingInvitationRow(page: Page, email: string) {
  return appAccessSection(page)
    .getByRole("heading", { name: "Pending invitations" })
    .locator("xpath=following-sibling::div[1]")
    .locator(":scope > div")
    .filter({ has: page.getByText(email, { exact: true }) });
}

async function expectFocusedConfirmation(
  confirmButton: Locator,
  guidance: string,
) {
  await expect(confirmButton).toBeFocused();
  const guidanceId = await confirmButton.getAttribute("aria-describedby");
  expect(guidanceId).toBeTruthy();
  await expect(confirmButton.page().locator(`#${guidanceId}`)).toHaveText(
    guidance,
  );
}

async function expectNoHorizontalOverflow(locator: Locator) {
  expect(
    await locator.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
}

async function expectProjectDeviceProfile(page: Page, testInfo: TestInfo) {
  const {
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
  } = testInfo.project.use;
  const runtimeProfile = await page.evaluate(() => ({
    deviceScaleFactor: window.devicePixelRatio,
    hasTouch: "ontouchstart" in window,
    hasCoarsePointer: window.matchMedia("(pointer: coarse)").matches,
    userAgent: navigator.userAgent,
  }));

  expect(page.viewportSize()).toEqual(viewport);
  expect(runtimeProfile.deviceScaleFactor).toBe(deviceScaleFactor);
  expect(runtimeProfile.hasTouch).toBe(hasTouch);
  expect(runtimeProfile.hasCoarsePointer).toBe(hasTouch);
  expect(runtimeProfile.userAgent).toBe(userAgent);

  if (testInfo.project.name === "iPhone 14") {
    expect({
      viewport,
      deviceScaleFactor,
      isMobile,
      hasTouch,
    }).toEqual({
      viewport: { width: 390, height: 664 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
  }
}

function projectBrowserContextOptions(
  testInfo: TestInfo,
): BrowserContextOptions {
  const {
    baseURL,
    deviceScaleFactor,
    hasTouch,
    isMobile,
    locale,
    timezoneId,
    userAgent,
    viewport,
  } = testInfo.project.use;

  return {
    ...(baseURL !== undefined ? { baseURL } : {}),
    ...(deviceScaleFactor !== undefined ? { deviceScaleFactor } : {}),
    ...(hasTouch !== undefined ? { hasTouch } : {}),
    ...(isMobile !== undefined ? { isMobile } : {}),
    ...(locale !== undefined ? { locale } : {}),
    ...(timezoneId !== undefined ? { timezoneId } : {}),
    ...(userAgent !== undefined ? { userAgent } : {}),
    ...(viewport !== undefined ? { viewport } : {}),
  };
}

function newProjectBrowserContext(browser: Browser, testInfo: TestInfo) {
  return browser.newContext(projectBrowserContextOptions(testInfo));
}

async function createNamedGroup(
  page: Page,
  groupName: string,
  memberNames: string[],
) {
  await page.goto("/groups/new");
  await page
    .getByPlaceholder("e.g. Tokyo Trip, Apartment")
    .fill(groupName);

  for (let index = 0; index < memberNames.length; index += 1) {
    if (index >= 2) {
      await page
        .getByRole("button", { name: /Add another member/i })
        .click();
    }
    await page
      .getByPlaceholder(`Member ${index + 1}`)
      .fill(memberNames[index]);
  }

  await page.getByRole("button", { name: "Create Group" }).click();
  await page.waitForURL((url) => extractCreatedGroupId(url.toString()) !== null);

  const groupId = extractCreatedGroupId(page.url());
  if (!groupId) {
    throw new Error(`Expected a created group URL, got ${page.url()}`);
  }

  return {
    groupId,
    groupPath: `/groups/${groupId}`,
  };
}

async function expectLedgerEvidence(
  page: Page,
  expenseDescription: string,
) {
  const membersSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Members" }) });
  const expensesSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Expenses" }) });
  const activitySection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Activity" }) });

  await expect(membersSection.getByText("Bob", { exact: true })).toBeVisible();
  await expect(
    expensesSection.getByText(expenseDescription, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("+$5.00", { exact: true })).toBeVisible();
  await expect(page.getByText("-$5.00", { exact: true })).toBeVisible();
  await expect(
    activitySection.getByText(`Expense added: ${expenseDescription}`, {
      exact: true,
    }),
  ).toBeVisible();
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
      throw new Error("Expected the member-link server action request to have a body");
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

async function replayWithMemberSession(
  memberContext: BrowserContext,
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

  return memberContext.request.post(request.url, {
    headers,
    data: request.body,
    maxRedirects: 0,
  });
}

test.describe("Group management", () => {
  test("user can create a group and land on the group page", async ({ page }) => {
    await signUpAndLogin(page);
    await page.goto("/groups/new");
    await page.getByPlaceholder("e.g. Tokyo Trip, Apartment").fill("Weekend Cabin");
    await page.getByPlaceholder("Member 1").fill("Alice");
    await page.getByPlaceholder("Member 2").fill("Bob");

    await page.getByRole("button", { name: "Create Group" }).click();

    await expect(page).toHaveURL(/\/groups\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Weekend Cabin" })).toBeVisible();
    await expect(page.getByText("2 members")).toBeVisible();
  });

  test("double-clicking Create Group only creates one group", async ({ page }) => {
    await signUpAndLogin(page);
    await page.goto("/groups/new");
    await page.getByPlaceholder("e.g. Tokyo Trip, Apartment").fill("One Cabin");
    await page.getByPlaceholder("Member 1").fill("Alice");
    await page.getByPlaceholder("Member 2").fill("Bob");

    const submit = page.getByRole("button", { name: "Create Group" });
    await submit.dblclick();

    await expect(page).toHaveURL(/\/groups\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "One Cabin" })).toBeVisible();

    await page.goto("/");
    await expect(page.locator("a").filter({ hasText: "One Cabin" })).toHaveCount(1);
  });

  test("Create Group shows a pending state while submission is in flight", async ({ page }) => {
    await signUpAndLogin(page);
    await page.goto("/groups/new");
    await page.getByPlaceholder("e.g. Tokyo Trip, Apartment").fill("Pending Cabin");
    await page.getByPlaceholder("Member 1").fill("Alice");
    await page.getByPlaceholder("Member 2").fill("Bob");

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
        new URL(request.url()).pathname === "/groups/new"
      ) {
        sawSubmitRequest = true;
        await submitBlocked;
      }

      await route.continue();
    });

    const form = page.locator("form").filter({
      has: page.getByPlaceholder("e.g. Tokyo Trip, Apartment"),
    });
    const submit = form.locator('button[type="submit"]');
    const clickPromise = submit.click();

    await expect.poll(() => sawSubmitRequest).toBe(true);
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText("Creating...");

    releaseSubmit!();
    await clickPromise;

    await expect(page).toHaveURL(/\/groups\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Pending Cabin" })).toBeVisible();
  });

  test("legitimate second group create after revisiting the form is not replayed", async ({
    page,
  }) => {
    await signUpAndLogin(page);

    await page.goto("/groups/new");
    await page.getByPlaceholder("e.g. Tokyo Trip, Apartment").fill("First Cabin");
    await page.getByPlaceholder("Member 1").fill("Alice");
    await page.getByPlaceholder("Member 2").fill("Bob");
    await page.getByRole("button", { name: "Create Group" }).click();
    await expect(page).toHaveURL(/\/groups\/[^/]+$/);

    await page.goto("/groups/new");
    await page.getByPlaceholder("e.g. Tokyo Trip, Apartment").fill("Second Cabin");
    await page.getByPlaceholder("Member 1").fill("Alice");
    await page.getByPlaceholder("Member 2").fill("Bob");
    await page.getByRole("button", { name: "Create Group" }).click();
    await expect(page).toHaveURL(/\/groups\/[^/]+$/);

    await page.goto("/");
    await expect(page.locator("a").filter({ hasText: "First Cabin" })).toHaveCount(1);
    await expect(page.locator("a").filter({ hasText: "Second Cabin" })).toHaveCount(1);
  });

  test("legitimate group create from a restored form gets a fresh token", async ({
    page,
  }) => {
    await signUpAndLogin(page);

    await page.goto("/groups/new");
    const firstToken = await page.locator('input[name="_submissionToken"]').inputValue();
    await page.getByPlaceholder("e.g. Tokyo Trip, Apartment").fill("Back Cabin");
    await page.getByPlaceholder("Member 1").fill("Alice");
    await page.getByPlaceholder("Member 2").fill("Bob");

    await page.goto("/");
    await expect(page).toHaveURL("/");

    await page.goBack();
    await expect(page).toHaveURL("/groups/new");
    await page.waitForFunction((token) => {
      const input = document.querySelector<HTMLInputElement>('input[name="_submissionToken"]');
      return input ? input.value !== token : false;
    }, firstToken);

    await page.getByPlaceholder("e.g. Tokyo Trip, Apartment").fill("Back Cabin");
    await page.getByPlaceholder("Member 1").fill("Alice");
    await page.getByPlaceholder("Member 2").fill("Bob");
    await page.getByRole("button", { name: "Create Group" }).click();
    await expect(page).toHaveURL(/\/groups\/[^/]+$/);

    await page.goto("/");
    await expect(page.locator("a").filter({ hasText: "Back Cabin" })).toHaveCount(1);
  });

  test("new group appears on the home page", async ({ page }) => {
    const id = await createTestGroup(page, "Barcelona Trip", ["Maria", "Carlos"]);

    await page.goto("/");
    const groupCard = page.locator(`a[href='/groups/${id}']`);
    await expect(groupCard).toBeVisible();
    await expect(groupCard).toContainText("Barcelona Trip");
    await expect(groupCard).toContainText("2 members");
  });

  test("can add more members to an existing group", async ({ page }) => {
    await createTestGroup(page, "Dinner Club", ["Alice", "Bob"]);

    await page.getByPlaceholder("Add a member…").fill("Carol");
    await page.getByRole("button", { name: "Add" }).click();

    await expect(page.getByText("3 members")).toBeVisible();
    await expect(
      page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "Members" }) })
        .getByText("Carol", { exact: true })
    ).toBeVisible();
  });

  test("double-clicking Add only adds one member", async ({ page }) => {
    await createTestGroup(page, "Dinner Club Double Add", ["Alice", "Bob"]);

    await page.getByPlaceholder("Add a member…").fill("Carol");
    await page.getByRole("button", { name: "Add" }).dblclick();

    await expect(page.getByText("3 members")).toBeVisible();
    await expect(
      page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "Members" }) })
        .getByText("Carol", { exact: true })
    ).toHaveCount(1);
  });

  test("Add member shows a pending state while submission is in flight", async ({ page }) => {
    const id = await createTestGroup(page, "Dinner Club Pending Add", ["Alice", "Bob"]);

    await page.getByPlaceholder("Add a member…").fill("Carol");

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
        new URL(request.url()).pathname === `/groups/${id}`
      ) {
        sawSubmitRequest = true;
        await submitBlocked;
      }

      await route.continue();
    });

    const membersSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Members" }) });
    const submit = membersSection.locator('button[type="submit"]');
    const clickPromise = submit.click();

    await expect.poll(() => sawSubmitRequest).toBe(true);
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText("Adding...");

    releaseSubmit!();
    await clickPromise;

    await expect(page.getByText("3 members")).toBeVisible();
    await expect(
      membersSection.getByText("Carol", { exact: true })
    ).toBeVisible();
  });

  test("can navigate back to home from a group page", async ({ page }) => {
    await createTestGroup(page, "Road Trip", ["Alice", "Bob"]);

    await page.getByRole("link", { name: "← Groups" }).click();
    await expect(page).toHaveURL("/");
  });

  test("can create a group with more than two members", async ({ page }) => {
    await signUpAndLogin(page);
    await page.goto("/groups/new");
    await page.getByPlaceholder("e.g. Tokyo Trip, Apartment").fill("Big Group");
    await page.getByPlaceholder("Member 1").fill("Alice");
    await page.getByPlaceholder("Member 2").fill("Bob");

    await page.getByRole("button", { name: /Add another member/i }).click();
    await page.getByPlaceholder("Member 3").fill("Carol");
    await page.getByRole("button", { name: /Add another member/i }).click();
    await page.getByPlaceholder("Member 4").fill("Dave");

    await page.getByRole("button", { name: "Create Group" }).click();
    await expect(page).toHaveURL(/\/groups\/[^/]+$/);
    await expect(page.getByText("4 members")).toBeVisible();
  });

  test("shows owner and shared account emails in app access", async ({
    page,
    browser,
  }, testInfo) => {
    const owner = await signUpAndLogin(page);
    await page.goto("/groups/new");
    await page.getByPlaceholder("e.g. Tokyo Trip, Apartment").fill("Shared Cabin");
    await page.getByPlaceholder("Member 1").fill("Alice");
    await page.getByPlaceholder("Member 2").fill("Bob");
    await page.getByRole("button", { name: "Create Group" }).click();

    await expect(page).toHaveURL(/\/groups\/[^/]+$/);
    await expect(page.getByText(owner.email)).toBeVisible();

    const invitedContext = await newProjectBrowserContext(browser, testInfo);
    const invitedPage = await invitedContext.newPage();
    const invited = await signUpAndLogin(invitedPage);
    await invitedContext.close();

    await page.getByPlaceholder("friend@example.com").fill(invited.email);
    await page.getByRole("button", { name: "Share Group" }).click();

    const appAccessSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "App Access" }) });

    await expect(page.getByText(`Shared with ${invited.email}.`)).toBeVisible();
    await expect(appAccessSection.getByText(invited.email, { exact: true })).toBeVisible();
  });

  test("owner manages account links while shared members cannot see or change them", async ({
    browser,
  }, testInfo) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 10_000)}`;
    const ownerContext = await newProjectBrowserContext(browser, testInfo);
    const ownerPage = await ownerContext.newPage();
    const memberContext = await newProjectBrowserContext(browser, testInfo);
    const memberPage = await memberContext.newPage();

    try {
      const owner = await signUpAndLogin(ownerPage, {
        displayName: `Link Owner ${suffix}`,
        email: `link-owner-${suffix}@example.com`,
      });
      const member = await signUpAndLogin(memberPage, {
        displayName: `Link Member ${suffix}`,
        email: `link-member-${suffix}@example.com`,
      });

      await ownerPage.goto("/groups/new");
      await ownerPage
        .getByPlaceholder("e.g. Tokyo Trip, Apartment")
        .fill(`Linked Cabin ${suffix}`);
      await ownerPage.getByPlaceholder("Member 1").fill("Alice");
      await ownerPage.getByPlaceholder("Member 2").fill("Bob");
      await ownerPage.getByRole("button", { name: "Create Group" }).click();
      await ownerPage.waitForURL((url) => extractCreatedGroupId(url.toString()) !== null);
      const groupPath = new URL(ownerPage.url()).pathname;

      await ownerPage.getByPlaceholder("friend@example.com").fill(member.email);
      await ownerPage.getByRole("button", { name: "Share Group" }).click();
      await expect(ownerPage.getByText(`Shared with ${member.email}.`)).toBeVisible();

      const membersSection = ownerPage
        .locator("section")
        .filter({ has: ownerPage.getByRole("heading", { name: "Members" }) });
      const ownerRow = accountAccessRow(ownerPage, owner.email);
      const memberRow = accountAccessRow(ownerPage, member.email);

      await expect(ownerRow.getByText("Owner", { exact: true })).toBeVisible();
      await expect(ownerRow.getByLabel("Ledger member")).toHaveValue("");
      await expect(memberRow.getByText("Member", { exact: true })).toBeVisible();
      await expect(memberRow.getByLabel("Ledger member")).toHaveValue("");

      let releaseSubmit!: () => void;
      const submitBlocked = new Promise<void>((resolve) => {
        releaseSubmit = resolve;
      });
      let sawSubmitRequest = false;
      await ownerPage.route("**/*", async (route) => {
        const request = route.request();
        if (
          !sawSubmitRequest &&
          request.method() === "POST" &&
          new URL(request.url()).pathname === groupPath
        ) {
          sawSubmitRequest = true;
          await submitBlocked;
        }
        await route.continue();
      });

      const memberSave = memberRow.locator('button[type="submit"]');
      const pendingSave = memberRow.getByLabel("Ledger member").selectOption({ label: "Bob" });
      await expect.poll(() => sawSubmitRequest).toBe(true);
      await expect(memberSave).toHaveText("Saving...");
      await expect(memberSave).toBeDisabled();
      await expect(memberRow.getByLabel("Ledger member")).toBeDisabled();
      releaseSubmit();
      await pendingSave;
      await ownerPage.unroute("**/*");

      await expect(memberRow.getByRole("status")).toHaveText("Ledger member updated.");
      await ownerPage.reload();
      await expect(accountAccessRow(ownerPage, member.email).getByLabel("Ledger member")).toHaveValue(
        await accountAccessRow(ownerPage, member.email)
          .getByRole("option", { name: "Bob" })
          .getAttribute("value")
      );

      await accountAccessRow(ownerPage, member.email)
        .getByLabel("Ledger member")
        .selectOption({ label: "Alice" });
      await expect(accountAccessRow(ownerPage, member.email).getByRole("status")).toHaveText(
        "Ledger member updated."
      );
      await ownerPage.reload();
      await expect(accountAccessRow(ownerPage, member.email).getByLabel("Ledger member")).toHaveValue(
        await accountAccessRow(ownerPage, member.email)
          .getByRole("option", { name: "Alice" })
          .getAttribute("value")
      );
      await expect(membersSection.getByText("Alice", { exact: true })).toBeVisible();
      await expect(membersSection.getByText("Bob", { exact: true })).toBeVisible();

      await accountAccessRow(ownerPage, member.email)
        .getByLabel("Ledger member")
        .selectOption({ label: "No linked member" });
      await expect(accountAccessRow(ownerPage, member.email).getByRole("status")).toHaveText(
        "Ledger member updated."
      );
      await ownerPage.reload();
      await expect(accountAccessRow(ownerPage, member.email).getByLabel("Ledger member")).toHaveValue(
        ""
      );
      await expect(membersSection.getByText("Alice", { exact: true })).toBeVisible();
      await expect(membersSection.getByText("Bob", { exact: true })).toBeVisible();

      await accountAccessRow(ownerPage, owner.email)
        .getByLabel("Ledger member")
        .selectOption({ label: "Alice" });
      await expect(accountAccessRow(ownerPage, owner.email).getByRole("status")).toHaveText(
        "Ledger member updated."
      );
      await accountAccessRow(ownerPage, owner.email)
        .getByLabel("Ledger member")
        .selectOption({ label: "No linked member" });
      await expect(accountAccessRow(ownerPage, owner.email).getByRole("status")).toHaveText(
        "Ledger member updated."
      );

      await memberPage.goto(groupPath);
      await expect(memberPage.getByRole("heading", { name: `Linked Cabin ${suffix}` })).toBeVisible();
      await expect(memberPage.getByRole("heading", { name: "App Access" })).toHaveCount(0);
      await expect(memberPage.getByLabel("Ledger member")).toHaveCount(0);
      await expect(memberPage.getByText(owner.email, { exact: true })).toHaveCount(0);
      await expect(memberPage.getByText(member.email, { exact: true })).toHaveCount(0);
      await expect(memberPage.getByText("No linked member", { exact: true })).toHaveCount(0);

      await ownerPage.goto(groupPath);
      const craftedOwnerRow = accountAccessRow(ownerPage, owner.email);
      const craftedRequest = await captureAbortedPost(ownerPage, groupPath, () =>
        craftedOwnerRow.getByLabel("Ledger member").selectOption({ label: "Bob" })
      );
      const response = await replayWithMemberSession(memberContext, craftedRequest);

      expect(response.status()).toBe(404);
      expect(await response.text()).not.toContain(owner.email);
      expect(await response.text()).not.toContain(member.email);

      await ownerPage.goto(groupPath);
      await expect(accountAccessRow(ownerPage, owner.email).getByLabel("Ledger member")).toHaveValue(
        ""
      );
      await expect(accountAccessRow(ownerPage, member.email).getByLabel("Ledger member")).toHaveValue(
        ""
      );
      await expect(membersSection.getByText("Alice", { exact: true })).toBeVisible();
      await expect(membersSection.getByText("Bob", { exact: true })).toBeVisible();
    } finally {
      await ownerContext.close();
      await memberContext.close();
    }
  });

  test("owner can remove access without changing the linked ledger and re-share it", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);

    const suffix = `${Date.now()}-${Math.round(Math.random() * 10_000)}`;
    const ownerContext = await newProjectBrowserContext(browser, testInfo);
    const targetContext = await newProjectBrowserContext(browser, testInfo);
    const peerContext = await newProjectBrowserContext(browser, testInfo);
    const ownerPage = await ownerContext.newPage();
    const targetPage = await targetContext.newPage();
    const peerPage = await peerContext.newPage();
    const groupName = `Revocation Cabin ${suffix}`;
    const expenseDescription = `Revocation Dinner ${suffix}`;

    try {
      const owner = await signUpAndLogin(ownerPage, {
        displayName: `Revocation Owner ${suffix}`,
        email: `revocation-owner-${suffix}@example.com`,
      });
      const target = await signUpAndLogin(targetPage, {
        displayName: `Revocation Target ${suffix}`,
        email: `revocation-target-${suffix}@example.com`,
      });
      const peer = await signUpAndLogin(peerPage, {
        displayName: `Revocation Peer ${suffix}`,
        email: `revocation-peer-${suffix}@example.com`,
      });
      await expectProjectDeviceProfile(ownerPage, testInfo);
      await expectProjectDeviceProfile(targetPage, testInfo);
      await expectProjectDeviceProfile(peerPage, testInfo);

      const { groupId, groupPath } = await createNamedGroup(
        ownerPage,
        groupName,
        ["Alice", "Bob"],
      );
      await fillExpenseBase(ownerPage, groupId, {
        description: expenseDescription,
        amount: "10",
        paidBy: "Alice",
      });
      await ownerPage.getByRole("button", { name: "Add Expense" }).click();
      await expect(ownerPage).toHaveURL(groupPath);

      await ownerPage.getByLabel("Email").fill(peer.email);
      await ownerPage.getByRole("button", { name: "Share Group" }).click();
      await expect(
        ownerPage.getByText(`Shared with ${peer.email}.`),
      ).toBeVisible();

      await ownerPage.getByLabel("Email").fill(target.email);
      await ownerPage
        .getByLabel("Ledger member (optional)")
        .selectOption({ label: "Bob" });
      await ownerPage.getByRole("button", { name: "Share Group" }).click();
      await expect(
        ownerPage.getByText(`Shared with ${target.email}.`),
      ).toBeVisible();

      await targetPage.goto(groupPath);
      await expect(
        targetPage.getByRole("heading", { name: groupName }),
      ).toBeVisible();
      await expect(
        targetPage.getByRole("heading", { name: "App Access" }),
      ).toHaveCount(0);
      await expect(
        targetPage.getByRole("button", { name: "Remove access" }),
      ).toHaveCount(0);
      await expect(
        targetPage.getByRole("button", { name: "Cancel invitation" }),
      ).toHaveCount(0);

      await ownerPage.goto(groupPath);
      const appAccess = appAccessSection(ownerPage);
      await expect(appAccess).toBeVisible();
      await expectNoHorizontalOverflow(appAccess);
      expect(
        await ownerPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      expect(
        await appAccess.evaluate(
          (section) => !section.contains(document.activeElement),
        ),
      ).toBe(true);

      const ownerRow = accountAccessRow(ownerPage, owner.email);
      const targetRow = accountAccessRow(ownerPage, target.email);
      const peerRow = accountAccessRow(ownerPage, peer.email);
      const ownerAccessId = await ownerRow
        .locator('input[name="accessId"]')
        .inputValue();
      const targetAccessId = await targetRow
        .locator('input[name="accessId"]')
        .first()
        .inputValue();
      const targetMemberId = await targetRow
        .getByRole("option", { name: "Bob" })
        .getAttribute("value");

      await expect(ownerRow.getByText("Owner", { exact: true })).toBeVisible();
      await expect(
        ownerRow.getByRole("button", { name: "Remove access" }),
      ).toHaveCount(0);
      await expect(targetRow.getByLabel("Ledger member")).toHaveValue(
        targetMemberId!,
      );
      await expect(
        peerRow.getByRole("button", { name: "Remove access" }),
      ).toBeVisible();

      const targetTrigger = targetRow.getByRole("button", {
        name: "Remove access",
      });
      await targetTrigger.click();
      let targetConfirm = targetRow.getByRole("button", {
        name: "Confirm remove",
      });
      await expectFocusedConfirmation(
        targetConfirm,
        `Remove app access for ${target.email}? Their ledger member and history will remain.`,
      );
      await expect(
        peerRow.getByRole("button", { name: "Remove access" }),
      ).toBeVisible();
      await expect(
        peerRow.getByRole("button", { name: "Confirm remove" }),
      ).toHaveCount(0);

      await targetRow.getByRole("button", { name: "Keep access" }).click();
      await expect(targetTrigger).toBeFocused();
      await expect(
        targetRow.getByRole("button", { name: "Confirm remove" }),
      ).toHaveCount(0);

      await targetTrigger.click();
      targetConfirm = targetRow.getByRole("button", {
        name: "Confirm remove",
      });
      const targetConfirmationForm = targetRow.locator("form").last();
      await targetConfirmationForm
        .locator('input[name="accessId"]')
        .evaluate(
          (input, accessId) => {
            (input as HTMLInputElement).value = accessId;
          },
          ownerAccessId,
        );
      await targetConfirm.click();
      await expect(targetConfirmationForm.getByRole("alert")).toHaveText(
        "The group owner cannot be removed.",
      );
      await expect(targetRow.getByLabel("Ledger member")).toHaveValue(
        targetMemberId!,
      );
      await expect(
        peerRow.getByRole("button", { name: "Remove access" }),
      ).toBeVisible();

      await targetRow.getByRole("button", { name: "Keep access" }).click();
      await expect(targetTrigger).toBeFocused();
      await expect(targetRow.getByRole("alert")).toHaveCount(0);

      await targetTrigger.click();
      targetConfirm = targetRow.getByRole("button", {
        name: "Confirm remove",
      });
      await expectFocusedConfirmation(
        targetConfirm,
        `Remove app access for ${target.email}? Their ledger member and history will remain.`,
      );
      await expect(targetRow.getByRole("alert")).toHaveCount(0);

      const retryForm = targetRow.locator("form").last();
      await retryForm
        .locator('input[name="accessId"]')
        .evaluate(
          (input, accessId) => {
            (input as HTMLInputElement).value = accessId;
          },
          targetAccessId,
        );

      let resolveHeldPost!: () => void;
      const postBlocked = new Promise<void>((resolve) => {
        resolveHeldPost = resolve;
      });
      let heldPostReleased = false;
      function releaseHeldPost() {
        if (heldPostReleased) {
          return;
        }
        heldPostReleased = true;
        resolveHeldPost();
      }
      let resolvePostObserved!: () => void;
      const postObserved = new Promise<void>((resolve) => {
        resolvePostObserved = resolve;
      });
      let postCount = 0;
      const heldPostHandler = async (route: Route) => {
        const request = route.request();
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === groupPath
        ) {
          postCount += 1;
          resolvePostObserved();
          await postBlocked;
        }
        await route.continue();
      };
      await ownerPage.route("**/*", heldPostHandler);

      const pendingSubmit = retryForm.locator('button[type="submit"]');
      const pendingKeep = retryForm.getByRole("button", {
        name: "Keep access",
      });
      let removePromise: Promise<void> | undefined;
      try {
        removePromise = pendingSubmit.click();
        await postObserved;
        await expect(pendingSubmit).toHaveText("Removing...");
        await expect(pendingSubmit).toBeDisabled();
        await expect(pendingKeep).toBeDisabled();
        await expect(retryForm.getByRole("alert")).toHaveCount(0);

        // Native activation attempts on disabled controls must be no-ops while
        // the first Server Action request is held.
        await pendingSubmit.evaluate((button) => {
          (button as HTMLButtonElement).click();
          (button as HTMLButtonElement).click();
        });
        await pendingKeep.evaluate((button) => {
          (button as HTMLButtonElement).click();
        });
        expect(postCount).toBe(1);
        await expect(
          peerRow.getByRole("button", { name: "Remove access" }),
        ).toBeEnabled();

        releaseHeldPost();
        await removePromise;
        await expect(accountAccessRow(ownerPage, target.email)).toHaveCount(0);
        const accessRemovedStatus = appAccessSection(ownerPage).locator(
          ':scope > [role="status"]',
        );
        await expect(accessRemovedStatus).toHaveText("Access removed.");
        await expect
          .poll(
            () =>
              new URL(ownerPage.url()).searchParams.has("accessManagement"),
          )
          .toBe(false);
        await expect(ownerPage).toHaveURL(groupPath);
        await expect(accessRemovedStatus).toHaveText("Access removed.");
        await expect(
          appAccessSection(ownerPage).locator(':scope > [role="status"]'),
        ).toHaveCount(1);
        await expect(accountAccessRow(ownerPage, peer.email)).toBeVisible();
        await expect(
          accountAccessRow(ownerPage, peer.email).getByRole("button", {
            name: "Remove access",
          }),
        ).not.toBeFocused();
        expect(postCount).toBe(1);
      } finally {
        releaseHeldPost();
        await removePromise?.catch(() => undefined);
        await ownerPage.unroute("**/*", heldPostHandler);
      }

      const revokedResponse = await targetPage.goto(groupPath);
      expect(revokedResponse?.status()).toBe(404);
      await expect(targetPage.getByText("404", { exact: true })).toBeVisible();
      await expect(targetPage.locator("body")).not.toContainText(groupName);

      await ownerPage.reload();
      await expect(
        appAccessSection(ownerPage).locator(':scope > [role="status"]'),
      ).toHaveCount(0);
      await expect(accountAccessRow(ownerPage, target.email)).toHaveCount(0);
      await expect(accountAccessRow(ownerPage, peer.email)).toBeVisible();
      await expectLedgerEvidence(ownerPage, expenseDescription);
      await expect(
        ownerPage
          .getByLabel("Ledger member (optional)")
          .getByRole("option", { name: "Bob" }),
      ).toHaveCount(0);

      await ownerPage.getByLabel("Email").fill(target.email);
      await ownerPage.getByRole("button", { name: "Share Group" }).click();
      await expect(
        ownerPage.getByText(`Shared with ${target.email}.`),
      ).toBeVisible();
      await expect(
        appAccessSection(ownerPage).getByText("Access removed.", {
          exact: true,
        }),
      ).toHaveCount(0);
      const restoredTargetRow = accountAccessRow(ownerPage, target.email);
      await expect(restoredTargetRow.getByLabel("Ledger member")).toHaveValue(
        targetMemberId!,
      );
      await expectLedgerEvidence(ownerPage, expenseDescription);

      await targetPage.goto(groupPath);
      await expect(
        targetPage.getByRole("heading", { name: groupName }),
      ).toBeVisible();
      await expectLedgerEvidence(targetPage, expenseDescription);
      await expect(
        targetPage.getByRole("heading", { name: "App Access" }),
      ).toHaveCount(0);
      await expect(
        targetPage.getByRole("button", { name: "Remove access" }),
      ).toHaveCount(0);
    } finally {
      await peerContext.close();
      await targetContext.close();
      await ownerContext.close();
    }
  });

  test("owner can cancel invitation without affecting another pending invitation", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(90_000);

    const suffix = `${Date.now()}-${Math.round(Math.random() * 10_000)}`;
    const ownerContext = await newProjectBrowserContext(browser, testInfo);
    const cancelledLinkContext = await newProjectBrowserContext(
      browser,
      testInfo,
    );
    const unrelatedLinkContext = await newProjectBrowserContext(
      browser,
      testInfo,
    );
    const ownerPage = await ownerContext.newPage();
    const cancelledLinkPage = await cancelledLinkContext.newPage();
    const unrelatedLinkPage = await unrelatedLinkContext.newPage();
    const groupName = `Cancellation Cabin ${suffix}`;
    const cancelledEmail = `cancelled-${suffix}@example.com`;
    const unrelatedEmail = `unrelated-${suffix}@example.com`;

    try {
      await signUpAndLogin(ownerPage, {
        displayName: `Cancellation Owner ${suffix}`,
        email: `cancellation-owner-${suffix}@example.com`,
      });
      await expectProjectDeviceProfile(ownerPage, testInfo);
      const { groupPath } = await createNamedGroup(ownerPage, groupName, [
        "Owner",
        "Guest",
      ]);

      await ownerPage.getByLabel("Email").fill(cancelledEmail);
      await ownerPage
        .getByLabel("Ledger member (optional)")
        .selectOption({ label: "Guest" });
      await ownerPage.getByRole("button", { name: "Share Group" }).click();
      await expect(
        ownerPage.getByText(`Invitation created for ${cancelledEmail}.`),
      ).toBeVisible();
      const cancelledPath = await ownerPage
        .getByRole("textbox", { name: "Invitation link" })
        .inputValue();
      expect(cancelledPath).toMatch(/^\/invite\/[^/?#]+$/);

      await ownerPage.getByLabel("Email").fill(unrelatedEmail);
      await ownerPage
        .getByLabel("Ledger member (optional)")
        .selectOption({ label: "No linked member" });
      await ownerPage.getByRole("button", { name: "Share Group" }).click();
      await expect(
        ownerPage.getByText(`Invitation created for ${unrelatedEmail}.`),
      ).toBeVisible();
      const unrelatedPath = await ownerPage
        .getByRole("textbox", { name: "Invitation link" })
        .inputValue();
      expect(unrelatedPath).toMatch(/^\/invite\/[^/?#]+$/);
      expect(unrelatedPath).not.toBe(cancelledPath);

      await ownerPage.goto(groupPath);
      const appAccess = appAccessSection(ownerPage);
      await expect(appAccess).toBeVisible();
      await expectNoHorizontalOverflow(appAccess);
      expect(
        await ownerPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      expect(
        await appAccess.evaluate(
          (section) => !section.contains(document.activeElement),
        ),
      ).toBe(true);

      const cancelledRow = pendingInvitationRow(ownerPage, cancelledEmail);
      const unrelatedRow = pendingInvitationRow(ownerPage, unrelatedEmail);
      await expect(cancelledRow).toBeVisible();
      await expect(cancelledRow).toContainText("Ledger member: Guest");
      await expect(unrelatedRow).toBeVisible();

      const cancelTrigger = cancelledRow.getByRole("button", {
        name: "Cancel invitation",
      });
      await cancelTrigger.click();
      let cancelConfirm = cancelledRow.getByRole("button", {
        name: "Confirm cancel",
      });
      await expectFocusedConfirmation(
        cancelConfirm,
        `Cancel the invitation for ${cancelledEmail}? The current link will stop working.`,
      );
      await expect(
        unrelatedRow.getByRole("button", { name: "Cancel invitation" }),
      ).toBeVisible();
      await expect(
        unrelatedRow.getByRole("button", { name: "Confirm cancel" }),
      ).toHaveCount(0);

      await cancelledRow
        .getByRole("button", { name: "Keep invitation" })
        .click();
      await expect(cancelTrigger).toBeFocused();
      await expect(
        cancelledRow.getByRole("button", { name: "Confirm cancel" }),
      ).toHaveCount(0);

      await cancelTrigger.click();
      cancelConfirm = cancelledRow.getByRole("button", {
        name: "Confirm cancel",
      });
      await expectFocusedConfirmation(
        cancelConfirm,
        `Cancel the invitation for ${cancelledEmail}? The current link will stop working.`,
      );
      await cancelConfirm.click();

      await expect(
        pendingInvitationRow(ownerPage, cancelledEmail),
      ).toHaveCount(0);
      const invitationCancelledStatus = appAccessSection(ownerPage).locator(
        ':scope > [role="status"]',
      );
      await expect(invitationCancelledStatus).toHaveText(
        "Invitation cancelled.",
      );
      await expect
        .poll(
          () => new URL(ownerPage.url()).searchParams.has("accessManagement"),
        )
        .toBe(false);
      await expect(ownerPage).toHaveURL(groupPath);
      await expect(invitationCancelledStatus).toHaveText(
        "Invitation cancelled.",
      );
      await expect(
        pendingInvitationRow(ownerPage, unrelatedEmail),
      ).toBeVisible();
      await expect(
        pendingInvitationRow(ownerPage, unrelatedEmail).getByRole("button", {
          name: "Cancel invitation",
        }),
      ).not.toBeFocused();

      await ownerPage.reload();
      await expect(
        appAccessSection(ownerPage).locator(':scope > [role="status"]'),
      ).toHaveCount(0);
      await expect(
        pendingInvitationRow(ownerPage, cancelledEmail),
      ).toHaveCount(0);
      await expect(
        pendingInvitationRow(ownerPage, unrelatedEmail),
      ).toBeVisible();

      await cancelledLinkPage.goto(cancelledPath);
      await expectProjectDeviceProfile(cancelledLinkPage, testInfo);
      await expect(
        cancelledLinkPage.getByRole("heading", {
          name: "Invitation unavailable",
        }),
      ).toBeVisible();
      await expect(cancelledLinkPage.locator("body")).not.toContainText(
        cancelledEmail,
      );
      await expect(cancelledLinkPage.locator("body")).not.toContainText(
        groupName,
      );
      await expect(cancelledLinkPage.locator("body")).not.toContainText(
        cancelledPath,
      );

      await unrelatedLinkPage.goto(unrelatedPath);
      await expectProjectDeviceProfile(unrelatedLinkPage, testInfo);
      await expect(unrelatedLinkPage).toHaveURL(/\/login\?invitation=1$/);
      await expect(
        unrelatedLinkPage.getByText(
          "Sign in to accept your group invitation.",
        ),
      ).toBeVisible();
      await expect(unrelatedLinkPage.locator("body")).not.toContainText(
        unrelatedEmail,
      );
      await expect(unrelatedLinkPage.locator("body")).not.toContainText(
        groupName,
      );
      await expect(unrelatedLinkPage.locator("body")).not.toContainText(
        unrelatedPath,
      );
    } finally {
      await unrelatedLinkContext.close();
      await cancelledLinkContext.close();
      await ownerContext.close();
    }
  });
});
