export type PendingInvitationRow = {
  id: string;
  email: string;
  memberName: string | null;
  expiresAt: number;
};

export function buildPendingInvitationRows(
  rows: PendingInvitationRow[]
): PendingInvitationRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const expiryDifference = left.row.expiresAt - right.row.expiresAt;
      if (expiryDifference !== 0) {
        return expiryDifference;
      }

      if (left.row.email < right.row.email) {
        return -1;
      }
      if (left.row.email > right.row.email) {
        return 1;
      }

      return left.index - right.index;
    })
    .map(({ row }) => ({
      id: row.id,
      email: row.email,
      memberName: row.memberName,
      expiresAt: row.expiresAt,
    }));
}
