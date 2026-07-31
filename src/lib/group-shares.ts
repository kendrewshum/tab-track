export type GroupShare = {
  email: string;
  role: "owner" | "member";
};

export function compareGroupAccessRows(
  left: GroupShare,
  right: GroupShare
): number {
  if (left.role !== right.role) {
    return left.role === "owner" ? -1 : 1;
  }

  return left.email.localeCompare(right.email);
}

export function buildGroupShareList(shares: GroupShare[]): GroupShare[] {
  return [...shares].sort(compareGroupAccessRows);
}
