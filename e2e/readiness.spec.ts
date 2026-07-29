import { expect, test } from "@playwright/test";

test("reports database readiness without returning database details", async ({
  request,
}) => {
  const response = await request.get("/api/ready");
  const responseBody = await response.text();

  expect(response.status()).toBe(200);
  expect(JSON.parse(responseBody)).toEqual({ status: "ready" });
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(responseBody).not.toContain("e2e-test.db");
  expect(responseBody).not.toContain("TURSO");
  expect(responseBody).not.toContain("libsql");
  expect(responseBody).not.toContain("@example.com");
});
