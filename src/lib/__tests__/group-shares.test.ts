import { describe, expect, test } from "vitest";

import { buildGroupShareList } from "@/lib/group-shares";

describe("buildGroupShareList", () => {
  test("sorts the owner first and member emails alphabetically", () => {
    expect(
      buildGroupShareList([
        { email: "zoe@example.com", role: "member" },
        { email: "owner@example.com", role: "owner" },
        { email: "amy@example.com", role: "member" },
      ])
    ).toEqual([
      { email: "owner@example.com", role: "owner" },
      { email: "amy@example.com", role: "member" },
      { email: "zoe@example.com", role: "member" },
    ]);
  });
});
