import { describe, expect, it } from "vitest";

import {
  CREATE_ACTION_KINDS,
  buildCreateRedirectPath,
  readSubmissionToken,
} from "../idempotency";

describe("readSubmissionToken", () => {
  it("returns a trimmed token when the hidden field is present", () => {
    const formData = new FormData();
    formData.set("_submissionToken", "  token-123  ");

    expect(readSubmissionToken(formData)).toBe("token-123");
  });

  it("returns null when the hidden field is missing", () => {
    expect(readSubmissionToken(new FormData())).toBeNull();
  });
});

describe("buildCreateRedirectPath", () => {
  it("builds the redirect path for a created group", () => {
    expect(buildCreateRedirectPath("createGroup", { groupId: "group-1" })).toBe(
      "/groups/group-1"
    );
  });

  it("builds the redirect path for a created expense", () => {
    expect(buildCreateRedirectPath("createExpense", { groupId: "group-1" })).toBe(
      "/groups/group-1"
    );
  });

  it("builds the redirect path for a created settlement", () => {
    expect(buildCreateRedirectPath("createSettlement", { groupId: "group-1" })).toBe(
      "/groups/group-1/settle"
    );
  });

  it("keeps add-member redirects on the group page", () => {
    expect(buildCreateRedirectPath("addMember", { groupId: "group-1" })).toBe(
      "/groups/group-1"
    );
  });
});

describe("CREATE_ACTION_KINDS", () => {
  it("includes every idempotent create action", () => {
    expect(CREATE_ACTION_KINDS).toEqual([
      "createGroup",
      "createExpense",
      "createSettlement",
      "addMember",
    ]);
  });
});
