export function extractCreatedGroupId(url: string): string | null {
  const { pathname } = new URL(url, "http://localhost");
  const match = pathname.match(/^\/groups\/([^/]+)$/);

  if (!match) return null;

  const groupId = match[1];
  return groupId === "new" ? null : groupId;
}
