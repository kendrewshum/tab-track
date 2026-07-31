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

export function getUrlWithoutAccessManagementStatus(
  currentUrl: string,
): string | undefined {
  const url = new URL(currentUrl);
  if (!url.searchParams.has("accessManagement")) {
    return undefined;
  }

  url.searchParams.delete("accessManagement");
  return `${url.pathname}${url.search}${url.hash}`;
}
