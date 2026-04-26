import { test, expect } from "@playwright/test";

// Must run before any other spec creates groups in the DB.
// Named 00-* so it sorts before expenses.spec.ts alphabetically.
test("shows empty state on first visit with branded icons", async ({ page, request }) => {
  await page.goto("/");

  await expect(page.getByText("No groups yet")).toBeVisible();
  await expect(page.getByRole("link", { name: /Create your first group/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "TabTrack" })).toBeVisible();
  await expect(page.getByTestId("tabtrack-logo")).toBeVisible();

  const iconHref = await page.locator('link[rel="icon"]').first().getAttribute("href");
  const appleHref = await page.locator('link[rel="apple-touch-icon"]').first().getAttribute("href");
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");

  expect(iconHref).toBe("/tabtrack-mark.svg");
  expect(appleHref).toBe("/apple-touch-icon.png");
  expect(manifestHref).toBe("/manifest.json");

  const [iconResponse, appleResponse, manifestResponse] = await Promise.all([
    request.get(iconHref!),
    request.get(appleHref!),
    request.get(manifestHref!),
  ]);

  expect(iconResponse.ok()).toBeTruthy();
  expect(appleResponse.ok()).toBeTruthy();
  expect(manifestResponse.ok()).toBeTruthy();

  const manifest = await manifestResponse.json();
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      }),
      expect.objectContaining({
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      }),
    ])
  );
});
