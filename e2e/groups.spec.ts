import {
  test,
  expect,
  type APIResponse,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { extractCreatedGroupId } from "../src/lib/group-url";
import { createTestGroup, signUpAndLogin } from "./helpers";

// Tests the full lifecycle of groups: creation, listing, member management,
// navigation, and deletion. Each test creates its own group so tests are
// independent and can be run in any order within this file.

type CapturedPost = {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
};

function accountAccessRow(page: Page, email: string) {
  const appAccess = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "App Access" }) });

  return appAccess
    .locator("div")
    .filter({ has: page.getByText(email, { exact: true }) })
    .filter({ has: page.getByLabel("Ledger member") })
    .last();
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

  test("shows owner and shared account emails in app access", async ({ page, browser }) => {
    const owner = await signUpAndLogin(page);
    await page.goto("/groups/new");
    await page.getByPlaceholder("e.g. Tokyo Trip, Apartment").fill("Shared Cabin");
    await page.getByPlaceholder("Member 1").fill("Alice");
    await page.getByPlaceholder("Member 2").fill("Bob");
    await page.getByRole("button", { name: "Create Group" }).click();

    await expect(page).toHaveURL(/\/groups\/[^/]+$/);
    await expect(page.getByText(owner.email)).toBeVisible();

    const invitedContext = await browser.newContext();
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
  }) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 10_000)}`;
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const memberContext = await browser.newContext();
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
});
