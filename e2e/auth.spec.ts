import { expect, test } from "@playwright/test";

import { signIn, signUpAndLogin } from "./helpers";

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
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();

    await signUpAndLogin(ownerPage, {
      displayName: "Share Owner",
      email: "share-owner@example.com",
    });

    await ownerPage.goto("/groups/new");
    await expect(ownerPage.getByRole("heading", { name: "New Group" })).toBeVisible();
    await ownerPage.getByPlaceholder("e.g. Tokyo Trip, Apartment").fill("Shared Weekend");
    await ownerPage.getByPlaceholder("Member 1").fill("Owner");
    await ownerPage.getByPlaceholder("Member 2").fill("Guest");
    await ownerPage.getByRole("button", { name: "Create Group" }).click();
    await expect(ownerPage).toHaveURL(/\/groups\/[^/]+$/);

    const guest = await signUpAndLogin(guestPage, {
      displayName: "Share Guest",
      email: "share-guest@example.com",
    });

    await ownerPage.getByPlaceholder("friend@example.com").fill(guest.email);
    await ownerPage.getByRole("button", { name: "Share Group" }).click();
    await expect(ownerPage.getByText(`Shared with ${guest.email}.`)).toBeVisible();

    await guestPage.goto("/");
    await expect(guestPage.getByRole("link", { name: /Shared Weekend/i })).toBeVisible();
    await guestPage.getByRole("link", { name: /Shared Weekend/i }).click();
    await expect(guestPage.getByRole("heading", { name: "Shared Weekend" })).toBeVisible();
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

    await ownerContext.close();
    await guestContext.close();
  });
});
