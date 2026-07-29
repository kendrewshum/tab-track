export type GroupInvitationFormResult =
  | { success: true; data: { email: string; memberId: string | null } }
  | { success: false };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseGroupInvitationForm(
  formData: FormData
): GroupInvitationFormResult {
  const rawEmail = formData.get("email");
  const rawMemberId = formData.get("memberId");

  if (typeof rawEmail !== "string") {
    return { success: false };
  }

  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    return { success: false };
  }

  if (rawMemberId !== null && typeof rawMemberId !== "string") {
    return { success: false };
  }

  const memberId = rawMemberId?.trim() || null;

  return { success: true, data: { email, memberId } };
}
