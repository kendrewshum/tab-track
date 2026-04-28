import { test, expect } from "@playwright/test";
import { createTestGroup, signUpAndLogin } from "./helpers";

// Tests the full lifecycle of groups: creation, listing, member management,
// navigation, and deletion. Each test creates its own group so tests are
// independent and can be run in any order within this file.

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
});
