type MemberAccountLinkFormResult =
  | {
      success: true;
      data: {
        accessId: string;
        memberId: string | null;
      };
    }
  | { success: false };

export function parseMemberAccountLinkForm(
  formData: FormData
): MemberAccountLinkFormResult {
  const accessId = formData.get("accessId");
  const memberId = formData.get("memberId");

  if (
    typeof accessId !== "string" ||
    accessId.length === 0 ||
    typeof memberId !== "string"
  ) {
    return { success: false };
  }

  return {
    success: true,
    data: {
      accessId,
      memberId: memberId === "" ? null : memberId,
    },
  };
}
