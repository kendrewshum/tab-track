export const GROUP_INVITATION_COOKIE_NAME =
  "tab-track-group-invitation";
export const GROUP_INVITATION_COOKIE_TTL_SECONDS = 30 * 60;

export function getGroupInvitationCookieOptions(
  maxAge: number,
  secure: boolean,
) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure,
    maxAge,
  };
}
