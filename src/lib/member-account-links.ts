import { compareGroupAccessRows } from "@/lib/group-shares";

export type AccountAccessRow = {
  accessId: string;
  userId: string;
  email: string;
  role: "owner" | "member";
};

export type LinkableMember = {
  id: string;
  name: string;
  userId: string | null;
};

export type MemberLinkChoice = {
  id: string;
  name: string;
};

export type AccountMemberLinkRow = AccountAccessRow & {
  memberId: string | null;
  choices: MemberLinkChoice[];
};

function compareMembers(left: LinkableMember, right: LinkableMember): number {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

export function buildAccountMemberLinkRows(
  accessRows: AccountAccessRow[],
  members: LinkableMember[]
): AccountMemberLinkRow[] {
  const sortedMembers = [...members].sort(compareMembers);

  return [...accessRows].sort(compareGroupAccessRows).map((accessRow) => {
    const availableMembers = sortedMembers.filter(
      (member) => member.userId === null || member.userId === accessRow.userId
    );
    const currentMember =
      availableMembers.find((member) => member.userId === accessRow.userId) ??
      null;

    return {
      ...accessRow,
      memberId: currentMember?.id ?? null,
      choices: [
        { id: "", name: "No linked member" },
        ...availableMembers.map(({ id, name }) => ({ id, name })),
      ],
    };
  });
}
