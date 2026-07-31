import { createHmac, randomBytes } from "node:crypto";

export const GROUP_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const GROUP_INVITATION_COOKIE_TTL_SECONDS = 30 * 60;

export function generateGroupInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashGroupInvitationToken(rawToken: string, secret: string): string {
  return createHmac("sha256", secret).update(rawToken).digest("hex");
}

export function getGroupInvitationExpiry(now: number): number {
  return now + GROUP_INVITATION_TTL_MS;
}
