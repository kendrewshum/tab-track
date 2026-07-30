import { expect, test, type Page } from "@playwright/test";

import { signIn, signUpAndLogin } from "./helpers";

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

async function createInvitationGroup(
  page: Page,
  groupName: string,
): Promise<string> {
  await page.goto("/groups/new");
  await expect(page.getByRole("heading", { name: "New Group" })).toBeVisible();
  await page
    .getByPlaceholder("e.g. Tokyo Trip, Apartment")
    .fill(groupName);
  await page.getByPlaceholder("Member 1").fill("Owner");
  await page.getByPlaceholder("Member 2").fill("Guest");
  await page.getByRole("button", { name: "Create Group" }).click();
  await page.waitForURL(
    (url) =>
      /^\/groups\/[^/]+$/.test(url.pathname) &&
      url.pathname !== "/groups/new",
  );

  return new URL(page.url()).pathname;
}

test.describe("Authentication and legacy group access", () => {
  test("unauthenticated users are redirected to the sign-in page", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  });

  test("signup creates an account and login works after signing out", async ({ page }) => {
    const account = await signUpAndLogin(page);

    await expect(page.getByText("No groups yet")).toBeVisible();
    await page.getByRole("button", { name: /Sign Out/i }).click();
    await expect(page).toHaveURL("/login");

    await signIn(page, account);
    await expect(page.getByText("No groups yet")).toBeVisible();
  });

  test("repeated failed logins are throttled without revealing account state", async ({
    page,
  }) => {
    const account = await signUpAndLogin(page);
    await page.getByRole("button", { name: /Sign Out/i }).click();
    await expect(page).toHaveURL("/login");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.goto("/login");
      await page.getByPlaceholder("you@example.com").fill(account.email);
      await page.getByPlaceholder("Your password").fill("wrong-password");
      await page.getByRole("button", { name: "Sign In" }).click();
      await expect(page.locator("form").getByRole("alert")).toContainText(
        "That email and password do not match",
      );
    }

    await page.goto("/login");
    await page.getByPlaceholder("you@example.com").fill(account.email);
    await page.getByPlaceholder("Your password").fill(account.password);
    await page.getByRole("button", { name: "Sign In" }).click();

    await expect(page).toHaveURL("/login");
    await expect(page.locator("form").getByRole("alert")).toContainText(
      "That email and password do not match",
    );
    await expect(page.locator("form").getByRole("alert")).not.toContainText(account.email);
  });

  test("repeated invalid invite attempts throttle signup", async ({ page }) => {
    const email = `throttled-signup-${Date.now()}@example.com`;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.goto("/signup");
      await page.getByPlaceholder("Your name").fill("Throttled Signup");
      await page.getByPlaceholder("you@example.com").fill(email);
      await page.getByPlaceholder("At least 8 characters").fill("password123");
      await page.getByPlaceholder("Enter invite code").fill("wrong-invite");
      await page.getByRole("button", { name: "Create Account" }).click();
      await expect(page.locator("form").getByRole("alert")).toHaveText(
        "That invite code is not valid.",
      );
    }

    await page.goto("/signup");
    await page.getByPlaceholder("Your name").fill("Throttled Signup");
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.getByPlaceholder("At least 8 characters").fill("password123");
    await page.getByPlaceholder("Enter invite code").fill("test-invite-code");
    await page.getByRole("button", { name: "Create Account" }).click();

    await expect(page).toHaveURL("/signup");
    await expect(page.locator("form").getByRole("alert")).toContainText(
      "We could not create an account with those details",
    );
    await expect(page.locator("form").getByRole("alert")).not.toContainText(email);
  });

  test("a mapped legacy user sees the existing Austin 2026 group and its expenses", async ({
    page,
  }) => {
    await signUpAndLogin(page, {
      displayName: "Austin Friend",
      email: "friend@example.com",
    });

    await expect(page.getByRole("link", { name: /Austin 2026/i })).toBeVisible();
    await page.getByRole("link", { name: /Austin 2026/i }).click();

    await expect(page.getByRole("heading", { name: "Austin 2026" })).toBeVisible();
    await expect(
      page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "Expenses" }) })
        .getByText("Flights", { exact: true })
    ).toBeVisible();
  });

  test("an unmapped user does not see the legacy Austin 2026 group", async ({ page }) => {
    await signUpAndLogin(page, {
      displayName: "Other Friend",
      email: "other@example.com",
    });

    await expect(page.getByRole("link", { name: /Austin 2026/i })).toHaveCount(0);
  });

  test("a registered user can share a new group with another registered user", async ({
    browser,
  }) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 10_000)}`;
    const ownerContext = await browser.newContext();
    const guestContext = await browser.newContext();

    try {
      const ownerPage = await ownerContext.newPage();
      const guestPage = await guestContext.newPage();
      const groupName = `Shared Weekend ${suffix}`;

      await signUpAndLogin(ownerPage, {
        displayName: `Share Owner ${suffix}`,
        email: `share-owner-${suffix}@example.com`,
      });

      await createInvitationGroup(ownerPage, groupName);

      const guest = await signUpAndLogin(guestPage, {
        displayName: `Share Guest ${suffix}`,
        email: `share-guest-${suffix}@example.com`,
      });

      await ownerPage.getByLabel("Email").fill(guest.email);
      await ownerPage.getByLabel("Ledger member (optional)").selectOption({
        label: "Guest",
      });
      await ownerPage.getByRole("button", { name: "Share Group" }).click();
      await expect(ownerPage.getByText(`Shared with ${guest.email}.`)).toBeVisible();
      await expect(
        ownerPage.getByRole("textbox", { name: "Invitation link" }),
      ).toHaveCount(0);
      await expect(pendingInvitationRow(ownerPage, guest.email)).toHaveCount(0);
      const guestAccountRow = accountAccessRow(ownerPage, guest.email);
      await expect(guestAccountRow.getByLabel("Ledger member")).toHaveValue(
        await guestAccountRow
          .getByRole("option", { name: "Guest" })
          .getAttribute("value"),
      );

      await guestPage.goto("/");
      await expect(
        guestPage.getByRole("link", { name: new RegExp(groupName) }),
      ).toBeVisible();
      await guestPage.getByRole("link", { name: new RegExp(groupName) }).click();
      await expect(guestPage.getByRole("heading", { name: groupName })).toBeVisible();
      await expect(guestPage.getByRole("heading", { name: "App Access" })).toHaveCount(0);
      await expect(guestPage.getByRole("button", { name: "Delete group" })).toHaveCount(0);
      await guestPage.getByPlaceholder("Add a member…").fill("Late Joiner");
      await guestPage.getByRole("button", { name: "Add" }).click();
      await expect(
        guestPage
          .locator("section")
          .filter({ has: guestPage.getByRole("heading", { name: "Members" }) })
          .getByText("Late Joiner", { exact: true })
      ).toBeVisible();
    } finally {
      await guestContext.close();
      await ownerContext.close();
    }
  });
});

test.describe("Pending group invitations", () => {
  test.describe.configure({ timeout: 60_000 });

  test("an unregistered recipient creates the invited account and joins the linked ledger member", async ({
    browser,
    browserName,
  }) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 10_000)}`;
    const ownerContext = await browser.newContext(
      browserName === "chromium"
        ? { permissions: ["clipboard-read", "clipboard-write"] }
        : {},
    );
    const recipientContext = await browser.newContext();

    try {
      const ownerPage = await ownerContext.newPage();
      const recipientPage = await recipientContext.newPage();
      const groupName = `Invited Cabin ${suffix}`;
      const recipientEmail = `invited-recipient-${suffix}@example.com`;

      await signUpAndLogin(ownerPage, {
        displayName: `Invitation Owner ${suffix}`,
        email: `invitation-owner-${suffix}@example.com`,
      });
      const groupPath = await createInvitationGroup(ownerPage, groupName);

      await ownerPage.getByLabel("Email").fill(recipientEmail);
      await ownerPage.getByLabel("Ledger member (optional)").selectOption({
        label: "Guest",
      });
      await ownerPage.getByRole("button", { name: "Share Group" }).click();

      await expect(
        ownerPage.getByText(`Invitation created for ${recipientEmail}.`),
      ).toBeVisible();
      const invitationPath = await ownerPage
        .getByRole("textbox", { name: "Invitation link" })
        .inputValue();
      expect(invitationPath).toMatch(/^\/invite\/[^/?#]+$/);
      if (browserName === "chromium") {
        await ownerPage.getByRole("button", { name: "Copy invitation link" }).click();
        await expect(
          ownerPage.getByRole("status").filter({ hasText: "Copied" }),
        ).toBeVisible();
        const copiedInvitationUrl = await ownerPage.evaluate(() =>
          navigator.clipboard.readText(),
        );
        expect(copiedInvitationUrl).toBe(
          new URL(invitationPath, ownerPage.url()).toString(),
        );
      }
      await expect(
        ownerPage.getByRole("button", { name: "Copy invitation link" }),
      ).toBeVisible();
      expect(
        await ownerPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);

      const pendingRow = pendingInvitationRow(ownerPage, recipientEmail);
      await expect(pendingRow.getByText(recipientEmail, { exact: true })).toBeVisible();
      await expect(pendingRow.getByText("Ledger member: Guest")).toBeVisible();
      await expect(pendingRow.getByText(/^Expires /)).toBeVisible();
      await expect(accountAccessRow(ownerPage, recipientEmail)).toHaveCount(0);
      await expect(pendingRow).not.toContainText(invitationPath);

      await recipientPage.goto(invitationPath);
      await expect(recipientPage).toHaveURL(/\/login\?invitation=1$/);
      await expect(
        recipientPage.getByText("Sign in to accept your group invitation."),
      ).toBeVisible();
      await expect(recipientPage).not.toHaveURL(/\/invite\//);

      await recipientPage.getByRole("link", { name: "Create an account" }).click();
      await expect(recipientPage).toHaveURL("/signup");
      await expect(
        recipientPage.getByText("Create an account to accept your group invitation."),
      ).toBeVisible();
      await expect(recipientPage.getByLabel("Invite Code")).toHaveCount(0);
      await expect(
        recipientPage.getByRole("button", { name: "Create Account" }),
      ).toBeVisible();
      expect(
        await recipientPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);

      await recipientPage.getByLabel("Name").fill(`Invitation Guest ${suffix}`);
      await recipientPage.getByLabel("Email").fill(recipientEmail);
      await recipientPage.getByLabel("Password").fill("password123");
      await recipientPage.getByRole("button", { name: "Create Account" }).click();

      await expect(recipientPage).toHaveURL(groupPath);
      await expect(recipientPage.getByRole("heading", { name: groupName })).toBeVisible();
      await expect(recipientPage.getByRole("heading", { name: "App Access" })).toHaveCount(0);
      await expect(recipientPage.getByRole("button", { name: "Delete group" })).toHaveCount(0);

      await ownerPage.reload();
      await expect(pendingInvitationRow(ownerPage, recipientEmail)).toHaveCount(0);
      const recipientAccountRow = accountAccessRow(ownerPage, recipientEmail);
      await expect(
        recipientAccountRow.getByText(recipientEmail, { exact: true }),
      ).toBeVisible();
      await expect(recipientAccountRow.getByLabel("Ledger member")).toHaveValue(
        await recipientAccountRow
          .getByRole("option", { name: "Guest" })
          .getAttribute("value"),
      );
      await expect(appAccessSection(ownerPage)).not.toContainText(invitationPath);
    } finally {
      await recipientContext.close();
      await ownerContext.close();
    }
  });

  test("consumed and rotated invitation paths cannot be replayed", async ({
    browser,
  }) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 10_000)}`;
    const ownerContext = await browser.newContext();
    const recipientContext = await browser.newContext();
    const consumedReplayContext = await browser.newContext();
    const rotatedOldContext = await browser.newContext();
    const rotatedNewContext = await browser.newContext();

    try {
      const ownerPage = await ownerContext.newPage();
      const recipientPage = await recipientContext.newPage();
      const consumedReplayPage = await consumedReplayContext.newPage();
      const rotatedOldPage = await rotatedOldContext.newPage();
      const rotatedNewPage = await rotatedNewContext.newPage();
      const groupName = `Replay Cabin ${suffix}`;
      const consumedEmail = `consumed-${suffix}@example.com`;
      const rotatedEmail = `rotated-${suffix}@example.com`;

      await signUpAndLogin(ownerPage, {
        displayName: `Replay Owner ${suffix}`,
        email: `replay-owner-${suffix}@example.com`,
      });
      await createInvitationGroup(ownerPage, groupName);

      await ownerPage.getByLabel("Email").fill(consumedEmail);
      await ownerPage.getByLabel("Ledger member (optional)").selectOption({
        label: "Guest",
      });
      await ownerPage.getByRole("button", { name: "Share Group" }).click();
      const consumedPath = await ownerPage
        .getByRole("textbox", { name: "Invitation link" })
        .inputValue();

      await recipientPage.goto(consumedPath);
      await recipientPage.getByRole("link", { name: "Create an account" }).click();
      await recipientPage.getByLabel("Name").fill(`Consumed Guest ${suffix}`);
      await recipientPage.getByLabel("Email").fill(consumedEmail);
      await recipientPage.getByLabel("Password").fill("password123");
      await recipientPage.getByRole("button", { name: "Create Account" }).click();
      await expect(recipientPage.getByRole("heading", { name: groupName })).toBeVisible();

      await consumedReplayPage.goto(consumedPath);
      await expect(
        consumedReplayPage.getByRole("heading", { name: "Invitation unavailable" }),
      ).toBeVisible();
      await expect(consumedReplayPage.locator("body")).not.toContainText(consumedEmail);
      await expect(consumedReplayPage.locator("body")).not.toContainText(groupName);
      await expect(consumedReplayPage.locator("body")).not.toContainText(consumedPath);

      await ownerPage.getByLabel("Email").fill(rotatedEmail);
      await ownerPage.getByLabel("Ledger member (optional)").selectOption({
        label: "No linked member",
      });
      await ownerPage.getByRole("button", { name: "Share Group" }).click();
      const oldPath = await ownerPage
        .getByRole("textbox", { name: "Invitation link" })
        .inputValue();

      await ownerPage.getByLabel("Email").fill(rotatedEmail.toUpperCase());
      await ownerPage.getByRole("button", { name: "Share Group" }).click();
      const newPath = await ownerPage
        .getByRole("textbox", { name: "Invitation link" })
        .inputValue();
      expect(newPath).not.toBe(oldPath);
      await expect(pendingInvitationRow(ownerPage, rotatedEmail)).toHaveCount(1);

      await rotatedOldPage.goto(oldPath);
      await expect(
        rotatedOldPage.getByRole("heading", { name: "Invitation unavailable" }),
      ).toBeVisible();
      await expect(rotatedOldPage.locator("body")).not.toContainText(rotatedEmail);
      await expect(rotatedOldPage.locator("body")).not.toContainText(groupName);
      await expect(rotatedOldPage.locator("body")).not.toContainText(oldPath);

      await rotatedNewPage.goto(newPath);
      await expect(rotatedNewPage).toHaveURL(/\/login\?invitation=1$/);
      await expect(
        rotatedNewPage.getByText("Sign in to accept your group invitation."),
      ).toBeVisible();
      await expect(rotatedNewPage.locator("body")).not.toContainText(newPath);
    } finally {
      await rotatedNewContext.close();
      await rotatedOldContext.close();
      await consumedReplayContext.close();
      await recipientContext.close();
      await ownerContext.close();
    }
  });

  test("a mismatched signed-in account can sign out without losing the invitation", async ({
    browser,
  }) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 10_000)}`;
    const ownerContext = await browser.newContext();
    const mismatchedContext = await browser.newContext();

    try {
      const ownerPage = await ownerContext.newPage();
      const mismatchedPage = await mismatchedContext.newPage();
      const groupName = `Mismatch Cabin ${suffix}`;
      const targetEmail = `mismatch-target-${suffix}@example.com`;

      await signUpAndLogin(ownerPage, {
        displayName: `Mismatch Owner ${suffix}`,
        email: `mismatch-owner-${suffix}@example.com`,
      });
      await createInvitationGroup(ownerPage, groupName);

      await ownerPage.getByLabel("Email").fill(targetEmail);
      await ownerPage.getByRole("button", { name: "Share Group" }).click();
      const invitationPath = await ownerPage
        .getByRole("textbox", { name: "Invitation link" })
        .inputValue();

      await signUpAndLogin(mismatchedPage, {
        displayName: `Wrong Account ${suffix}`,
        email: `wrong-account-${suffix}@example.com`,
      });
      await mismatchedPage.goto(invitationPath);

      await expect(mismatchedPage).toHaveURL(
        "/invite/result?status=account-mismatch",
      );
      await expect(
        mismatchedPage.getByRole("heading", { name: "Use the invited account" }),
      ).toBeVisible();
      await expect(mismatchedPage.locator("body")).not.toContainText(targetEmail);
      await expect(mismatchedPage.locator("body")).not.toContainText(groupName);
      await expect(mismatchedPage.locator("body")).not.toContainText(invitationPath);

      await mismatchedPage
        .getByRole("heading", { name: "Use the invited account" })
        .locator("xpath=ancestor::section")
        .getByRole("button", { name: "Sign Out" })
        .click();
      await expect(mismatchedPage).toHaveURL("/login");
      await expect(
        mismatchedPage.getByText("Sign in to accept your group invitation."),
      ).toBeVisible();
      await expect(mismatchedPage).not.toHaveURL(/\/invite\//);
      await expect(mismatchedPage.locator("body")).not.toContainText(invitationPath);
    } finally {
      await mismatchedContext.close();
      await ownerContext.close();
    }
  });

  test("an app invite code bypasses a stale group invitation cookie", async ({
    browser,
  }) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 10_000)}`;
    const ownerContext = await browser.newContext();
    const recipientContext = await browser.newContext();

    try {
      const ownerPage = await ownerContext.newPage();
      const recipientPage = await recipientContext.newPage();
      const groupName = `Fallback Cabin ${suffix}`;
      const recipientEmail = `fallback-recipient-${suffix}@example.com`;

      await signUpAndLogin(ownerPage, {
        displayName: `Fallback Owner ${suffix}`,
        email: `fallback-owner-${suffix}@example.com`,
      });
      await createInvitationGroup(ownerPage, groupName);

      await ownerPage.getByLabel("Email").fill(recipientEmail);
      await ownerPage.getByRole("button", { name: "Share Group" }).click();
      const oldPath = await ownerPage
        .getByRole("textbox", { name: "Invitation link" })
        .inputValue();

      await recipientPage.goto(oldPath);
      await recipientPage.getByRole("link", { name: "Create an account" }).click();
      await expect(recipientPage).toHaveURL("/signup");

      await ownerPage.getByLabel("Email").fill(recipientEmail.toUpperCase());
      await ownerPage.getByRole("button", { name: "Share Group" }).click();
      const newPath = await ownerPage
        .getByRole("textbox", { name: "Invitation link" })
        .inputValue();
      expect(newPath).not.toBe(oldPath);

      await recipientPage
        .getByRole("button", { name: "Use app invite code instead" })
        .click();
      await expect(recipientPage.getByLabel("Invite Code")).toBeVisible();
      await recipientPage.getByLabel("Name").fill(`Fallback Guest ${suffix}`);
      await recipientPage.getByLabel("Email").fill(recipientEmail);
      await recipientPage.getByLabel("Password").fill("password123");
      await recipientPage.getByLabel("Invite Code").fill("test-invite-code");
      await recipientPage.getByRole("button", { name: "Create Account" }).click();

      await expect(recipientPage).toHaveURL("/");
      await expect(recipientPage.getByText("No groups yet")).toBeVisible();
      await expect(recipientPage.locator("body")).not.toContainText(oldPath);
      await expect(recipientPage.locator("body")).not.toContainText(newPath);
    } finally {
      await recipientContext.close();
      await ownerContext.close();
    }
  });

  test("clipboard failure exposes an accessible absolute manual-copy field", async ({
    browser,
  }) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 10_000)}`;
    const ownerContext = await browser.newContext();
    await ownerContext.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
    });

    try {
      const ownerPage = await ownerContext.newPage();
      const recipientEmail = `manual-copy-${suffix}@example.com`;

      await signUpAndLogin(ownerPage, {
        displayName: `Manual Copy Owner ${suffix}`,
        email: `manual-copy-owner-${suffix}@example.com`,
      });
      await createInvitationGroup(
        ownerPage,
        `Manual Copy Cabin ${suffix}`,
      );

      await ownerPage.getByLabel("Email").fill(recipientEmail);
      await ownerPage.getByRole("button", { name: "Share Group" }).click();
      const invitationPath = await ownerPage
        .getByRole("textbox", { name: "Invitation link" })
        .inputValue();

      await ownerPage.getByRole("button", { name: "Copy invitation link" }).click();
      await expect(
        ownerPage.getByRole("alert").filter({
          hasText: "Copy the full invitation link manually.",
        }),
      ).toBeVisible();
      const manualCopyField = ownerPage.getByRole("textbox", {
        name: "Full invitation link",
      });
      await expect(manualCopyField).toBeVisible();
      await expect(manualCopyField).toHaveValue(
        new URL(invitationPath, ownerPage.url()).toString(),
      );
      expect(
        await ownerPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    } finally {
      await ownerContext.close();
    }
  });
});
