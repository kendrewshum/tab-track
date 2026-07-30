type GroupAccessManagementTargetResult<Key extends string> =
  | { success: true; data: Record<Key, string> }
  | { success: false };

function parseTarget<Key extends string>(
  formData: FormData,
  fieldName: Key,
  toData: (value: string) => Record<Key, string>
): GroupAccessManagementTargetResult<Key> {
  const rawValue = formData.get(fieldName);

  if (typeof rawValue !== "string") {
    return { success: false };
  }

  const value = rawValue.trim();
  if (value.length === 0) {
    return { success: false };
  }

  return { success: true, data: toData(value) };
}

export function parseGroupAccessTarget(formData: FormData) {
  return parseTarget(formData, "accessId", (accessId) => ({ accessId }));
}

export function parseGroupInvitationTarget(formData: FormData) {
  return parseTarget(formData, "invitationId", (invitationId) => ({ invitationId }));
}
