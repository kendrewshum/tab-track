export function areGroupMemberIds(
  groupMemberIds: Set<string>,
  submittedMemberIds: string[]
): boolean {
  const uniqueSubmittedIds = new Set(submittedMemberIds);

  if (uniqueSubmittedIds.size !== submittedMemberIds.length) {
    return false;
  }

  return submittedMemberIds.every((memberId) => groupMemberIds.has(memberId));
}
