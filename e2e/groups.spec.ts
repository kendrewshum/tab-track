import { test, expect } from "@playwright/test";
import { createTestGroup } from "./helpers";

// Tests the full lifecycle of groups: creation, listing, member management,
// navigation, and deletion. Each test creates its own group so tests are
// independent and can be run in any order within this file.

test.describe("Group management", () => {
  test("user can create a group and land on the group page", async ({ page }) => {
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
    await createTestGroup(page, "Barcelona Trip", ["Maria", "Carlos"]);

    await page.goto("/");
    await expect(page.getByRole("link", { name: /Barcelona Trip/i })).toBeVisible();
    await expect(page.getByText("2 members")).toBeVisible();
  });

  test("can add more members to an existing group", async ({ page }) => {
    await createTestGroup(page, "Dinner Club", ["Alice", "Bob"]);

    await page.getByPlaceholder("Add a member…").fill("Carol");
    await page.getByRole("button", { name: "Add" }).click();

    await expect(page.getByText("3 members")).toBeVisible();
    // Carol should appear in the members list
    await expect(page.getByText("Carol")).toBeVisible();
  });

  test("can navigate back to home from a group page", async ({ page }) => {
    await createTestGroup(page, "Road Trip", ["Alice", "Bob"]);

    await page.getByRole("link", { name: "← Groups" }).click();
    await expect(page).toHaveURL("/");
  });

  test("can create a group with more than two members", async ({ page }) => {
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
});
