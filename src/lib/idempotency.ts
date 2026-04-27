export const CREATE_ACTION_KINDS = [
  "createGroup",
  "createExpense",
  "createSettlement",
  "addMember",
] as const;

export type CreateActionKind = (typeof CREATE_ACTION_KINDS)[number];

export function readSubmissionToken(formData: FormData): string | null {
  const value = formData.get("_submissionToken");

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildCreateRedirectPath(
  actionKind: CreateActionKind,
  ids: { groupId: string }
): string {
  switch (actionKind) {
    case "createGroup":
    case "createExpense":
    case "createSettlement":
    case "addMember":
      return `/groups/${ids.groupId}`;
  }
}
