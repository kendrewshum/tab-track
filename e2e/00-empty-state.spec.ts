import { test, expect } from "@playwright/test";
import { signUpAndLogin } from "./helpers";

// Must run before any other spec creates groups in the DB.
// Named 00-* so it sorts before expenses.spec.ts alphabetically.
test("shows empty state on first visit", async ({ page }) => {
  await signUpAndLogin(page);

  await expect(page.getByText("No groups yet")).toBeVisible();
  await expect(page.getByRole("link", { name: /Create your first group/i })).toBeVisible();
});
