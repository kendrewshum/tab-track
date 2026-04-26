export type LegacyGroupAccessEntry = {
  groupName: string;
  ownerEmail: string;
  memberEmails: string[];
};

type LegacyUser = {
  id: string;
  email: string;
};

type LegacyGroup = {
  id: string;
  name: string;
  createdByUserId: string | null;
};

export type LegacyGroupAccessStore = {
  findGroupByName(name: string): Promise<LegacyGroup | null>;
  findUserByEmail(email: string): Promise<LegacyUser | null>;
  updateGroupOwner(groupId: string, userId: string): Promise<void>;
  ensureGroupAccess(groupId: string, userId: string, role: "owner" | "member"): Promise<void>;
};

export function parseLegacyGroupAccessMap(
  rawValue: string | undefined
): LegacyGroupAccessEntry[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof entry.groupName !== "string" ||
        typeof entry.ownerEmail !== "string" ||
        !Array.isArray(entry.memberEmails) ||
        !entry.memberEmails.every((email: unknown) => typeof email === "string")
      ) {
        return [];
      }

      return [
        {
          groupName: entry.groupName,
          ownerEmail: entry.ownerEmail.trim().toLowerCase(),
          memberEmails: entry.memberEmails.map((email: string) => email.trim().toLowerCase()),
        },
      ];
    });
  } catch {
    return [];
  }
}

export async function syncLegacyGroupAccessForUser(
  store: LegacyGroupAccessStore,
  currentUser: LegacyUser,
  entries: LegacyGroupAccessEntry[]
): Promise<void> {
  const email = currentUser.email.trim().toLowerCase();
  const relevantEntries = entries.filter((entry) =>
    [entry.ownerEmail, ...entry.memberEmails].includes(email)
  );

  for (const entry of relevantEntries) {
    const group = await store.findGroupByName(entry.groupName);
    if (!group) {
      continue;
    }

    const owner = await store.findUserByEmail(entry.ownerEmail);
    if (owner) {
      if (!group.createdByUserId) {
        await store.updateGroupOwner(group.id, owner.id);
      }

      await store.ensureGroupAccess(group.id, owner.id, "owner");
    }

    for (const memberEmail of entry.memberEmails) {
      const member = await store.findUserByEmail(memberEmail);
      if (member) {
        await store.ensureGroupAccess(group.id, member.id, "member");
      }
    }
  }
}
