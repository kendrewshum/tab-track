export const GROUP_INVITATION_COOKIE_NAME =
  "tab-track-group-invitation";

export function getGroupInvitationCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge,
  };
}
