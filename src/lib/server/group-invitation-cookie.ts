export const GROUP_INVITATION_COOKIE_NAME =
  "tab-track-group-invitation";
export const GROUP_INVITATION_COOKIE_TTL_SECONDS = 30 * 60;

type GroupInvitationCookieEnvironment = {
  NODE_ENV?: string;
  E2E_ALLOW_INSECURE_GROUP_INVITATION_COOKIE?: string;
};

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

export function getGroupInvitationCookieOptions(
  maxAge: number,
  requestUrl: string,
  environment: GroupInvitationCookieEnvironment = process.env,
) {
  const url = new URL(requestUrl);
  const allowInsecureE2E =
    environment.E2E_ALLOW_INSECURE_GROUP_INVITATION_COOKIE === "1" &&
    url.protocol === "http:" &&
    isLoopbackHostname(url.hostname);
  const secure =
    url.protocol === "https:" ||
    (environment.NODE_ENV === "production" && !allowInsecureE2E);

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure,
    maxAge,
  };
}
