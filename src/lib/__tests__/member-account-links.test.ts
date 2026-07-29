import { describe, expect, test } from "vitest";

import {
  buildAccountMemberLinkRows,
  type AccountAccessRow,
  type LinkableMember,
} from "@/lib/member-account-links";

describe("buildAccountMemberLinkRows", () => {
  test("sorts accounts owner-first and then by email without mutating the inputs", () => {
    const accessRows: AccountAccessRow[] = [
      {
        accessId: "access-z",
        userId: "user-z",
        email: "zoe@example.com",
        role: "member",
      },
      {
        accessId: "access-owner",
        userId: "user-owner",
        email: "owner@example.com",
        role: "owner",
      },
      {
        accessId: "access-a",
        userId: "user-a",
        email: "amy@example.com",
        role: "member",
      },
    ];
    const members: LinkableMember[] = [
      { id: "member-z", name: "Zoe", userId: null },
      { id: "member-a", name: "Amy", userId: null },
    ];
    const originalAccessRows = structuredClone(accessRows);
    const originalMembers = structuredClone(members);

    const rows = buildAccountMemberLinkRows(accessRows, members);

    expect(rows.map(({ accessId }) => accessId)).toEqual([
      "access-owner",
      "access-a",
      "access-z",
    ]);
    expect(accessRows).toEqual(originalAccessRows);
    expect(members).toEqual(originalMembers);
  });

  test("selects the current member solely from an exact user ID link", () => {
    const [row] = buildAccountMemberLinkRows(
      [
        {
          accessId: "access-owner",
          userId: "user-owner",
          email: "alex@example.com",
          role: "owner",
        },
      ],
      [
        { id: "member-name-match", name: "alex@example.com", userId: null },
        { id: "member-linked", name: "Different name", userId: "user-owner" },
      ]
    );

    expect(row.memberId).toBe("member-linked");
  });

  test("does not infer a current link from matching names or emails", () => {
    const [row] = buildAccountMemberLinkRows(
      [
        {
          accessId: "access-owner",
          userId: "user-owner",
          email: "matching@example.com",
          role: "owner",
        },
      ],
      [
        {
          id: "matching-name",
          name: "matching@example.com",
          userId: null,
        },
      ]
    );

    expect(row.memberId).toBeNull();
  });

  test("offers the empty choice, unclaimed members, and the current claimed member", () => {
    const [row] = buildAccountMemberLinkRows(
      [
        {
          accessId: "access-owner",
          userId: "user-owner",
          email: "owner@example.com",
          role: "owner",
        },
      ],
      [
        { id: "offline-z", name: "Zoe Offline", userId: null },
        { id: "claimed-other", name: "Amy Claimed", userId: "user-other" },
        { id: "current", name: "Current Member", userId: "user-owner" },
        { id: "offline-a", name: "Amy Offline", userId: null },
      ]
    );

    expect(row.choices).toEqual([
      { id: "", name: "No linked member" },
      { id: "offline-a", name: "Amy Offline" },
      { id: "current", name: "Current Member" },
      { id: "offline-z", name: "Zoe Offline" },
    ]);
    expect(row.memberId).toBe("current");
  });

  test("excludes members claimed by another account from every other account's choices", () => {
    const rows = buildAccountMemberLinkRows(
      [
        {
          accessId: "access-owner",
          userId: "user-owner",
          email: "owner@example.com",
          role: "owner",
        },
        {
          accessId: "access-member",
          userId: "user-member",
          email: "member@example.com",
          role: "member",
        },
      ],
      [
        { id: "owner-member", name: "Owner", userId: "user-owner" },
        { id: "other-member", name: "Other", userId: "user-member" },
      ]
    );

    expect(rows[0].choices.map(({ id }) => id)).toEqual(["", "owner-member"]);
    expect(rows[1].choices.map(({ id }) => id)).toEqual(["", "other-member"]);
  });

  test("uses member ID as a deterministic fallback for duplicate names", () => {
    const [row] = buildAccountMemberLinkRows(
      [
        {
          accessId: "access-owner",
          userId: "user-owner",
          email: "owner@example.com",
          role: "owner",
        },
      ],
      [
        { id: "member-z", name: "Same Name", userId: null },
        { id: "member-a", name: "Same Name", userId: null },
      ]
    );

    expect(row.choices.map(({ id }) => id)).toEqual([
      "",
      "member-a",
      "member-z",
    ]);
  });

  test("does not share the no-link choice between rows or helper calls", () => {
    const accessRows: AccountAccessRow[] = [
      {
        accessId: "access-owner",
        userId: "user-owner",
        email: "owner@example.com",
        role: "owner",
      },
      {
        accessId: "access-member",
        userId: "user-member",
        email: "member@example.com",
        role: "member",
      },
    ];
    const firstResult = buildAccountMemberLinkRows(accessRows, []);

    firstResult[0].choices[0].name = "Changed";
    const secondResult = buildAccountMemberLinkRows(accessRows, []);

    expect(firstResult[1].choices[0]).toEqual({
      id: "",
      name: "No linked member",
    });
    expect(secondResult[0].choices[0]).toEqual({
      id: "",
      name: "No linked member",
    });
  });

  test("handles zero accounts or zero members", () => {
    expect(buildAccountMemberLinkRows([], [])).toEqual([]);
    expect(
      buildAccountMemberLinkRows(
        [
          {
            accessId: "access-owner",
            userId: "user-owner",
            email: "owner@example.com",
            role: "owner",
          },
        ],
        []
      )
    ).toEqual([
      {
        accessId: "access-owner",
        userId: "user-owner",
        email: "owner@example.com",
        role: "owner",
        memberId: null,
        choices: [{ id: "", name: "No linked member" }],
      },
    ]);
  });
});
