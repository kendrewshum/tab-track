export function getAccessManagementStatus(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  switch (value) {
    case "access-removed":
      return "Access removed.";
    case "invitation-cancelled":
      return "Invitation cancelled.";
    default:
      return undefined;
  }
}
