export type GroupShare = {
  email: string;
  role: "owner" | "member";
};

export function buildGroupShareList(shares: GroupShare[]): GroupShare[] {
  return [...shares].sort((left, right) => {
    if (left.role !== right.role) {
      return left.role === "owner" ? -1 : 1;
    }

    return left.email.localeCompare(right.email);
  });
}
