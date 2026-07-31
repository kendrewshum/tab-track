import { describe, expect, test } from "vitest";

import {
  buildPendingInvitationRows,
  type PendingInvitationRow,
} from "@/lib/group-invitations";

describe("buildPendingInvitationRows", () => {
  test("sorts rows by expiry and then email while preserving matching rows' order", () => {
    const rows: PendingInvitationRow[] = [
      {
        id: "invitation-1",
        email: "zoe@example.com",
        memberName: null,
        expiresAt: 2_000,
      },
      {
        id: "invitation-2",
        email: "b@example.com",
        memberName: "Bri",
        expiresAt: 1_000,
      },
      {
        id: "invitation-3",
        email: "a@example.com",
        memberName: "Ari",
        expiresAt: 1_000,
      },
      {
        id: "invitation-4",
        email: "a@example.com",
        memberName: null,
        expiresAt: 1_000,
      },
    ];

    expect(buildPendingInvitationRows(rows)).toEqual([
      {
        id: "invitation-3",
        email: "a@example.com",
        memberName: "Ari",
        expiresAt: 1_000,
      },
      {
        id: "invitation-4",
        email: "a@example.com",
        memberName: null,
        expiresAt: 1_000,
      },
      {
        id: "invitation-2",
        email: "b@example.com",
        memberName: "Bri",
        expiresAt: 1_000,
      },
      {
        id: "invitation-1",
        email: "zoe@example.com",
        memberName: null,
        expiresAt: 2_000,
      },
    ]);
  });

  test("returns a new array without mutating its input", () => {
    const rows: PendingInvitationRow[] = [
      {
        id: "invitation-1",
        email: "second@example.com",
        memberName: null,
        expiresAt: 2_000,
      },
      {
        id: "invitation-2",
        email: "first@example.com",
        memberName: "First",
        expiresAt: 1_000,
      },
    ];
    const originalRows = structuredClone(rows);

    const result = buildPendingInvitationRows(rows);

    expect(result).not.toBe(rows);
    expect(rows).toEqual(originalRows);
  });

  test("outputs only the safe pending invitation fields", () => {
    const rowWithInternalToken = {
      id: "invitation-1",
      email: "friend@example.com",
      memberName: null,
      expiresAt: 1_000,
      token: "raw-token",
      tokenHash: "hashed-token",
    } as PendingInvitationRow;

    expect(buildPendingInvitationRows([rowWithInternalToken])).toEqual([
      {
        id: "invitation-1",
        email: "friend@example.com",
        memberName: null,
        expiresAt: 1_000,
      },
    ]);
  });
});
