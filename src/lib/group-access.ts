export type GroupAccessRecord = {
  groupId: string;
  userId: string;
  role: "owner" | "member";
};

export type GroupAccessStore = {
  findGroupAccess(userId: string, groupId: string): Promise<GroupAccessRecord | null>;
};

export async function findAuthorizedGroupAccess(
  store: GroupAccessStore,
  userId: string,
  groupId: string
): Promise<GroupAccessRecord | null> {
  return store.findGroupAccess(userId, groupId);
}
