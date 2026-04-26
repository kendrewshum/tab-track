import { describe, expect, it } from "vitest";

import { extractCreatedGroupId } from "../group-url";

describe("extractCreatedGroupId", () => {
  it("returns the dynamic group id for a created group page", () => {
    expect(extractCreatedGroupId("http://localhost:3001/groups/abc-123")).toBe("abc-123");
  });

  it("rejects the static new-group route", () => {
    expect(extractCreatedGroupId("http://localhost:3001/groups/new")).toBeNull();
  });

  it("rejects nested expense routes", () => {
    expect(extractCreatedGroupId("http://localhost:3001/groups/abc-123/expenses/new")).toBeNull();
  });
});
