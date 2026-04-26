import { describe, expect, test } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/password";

describe("password helpers", () => {
  test("hashPassword stores a derived value instead of plain text", async () => {
    const hash = await hashPassword("super-secret-pass");

    expect(hash).not.toBe("super-secret-pass");
    expect(hash.length).toBeGreaterThan(20);
  });

  test("verifyPassword accepts the original password and rejects a different one", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("something else", hash)).resolves.toBe(false);
  });
});
