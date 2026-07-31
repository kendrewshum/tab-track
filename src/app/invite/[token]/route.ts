import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  GROUP_INVITATION_COOKIE_NAME,
  GROUP_INVITATION_COOKIE_TTL_SECONDS,
  getGroupInvitationCookieOptions,
} from "@/lib/server/group-invitation-cookie";
import {
  createGroupInvitationClaimStore,
  inspectGroupInvitation,
} from "@/lib/server/group-invitation-claims";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UNAVAILABLE_PATH = "/invite/result?status=unavailable";

function privateRedirect(request: Request, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const secret = process.env.AUTH_SECRET;
  if (!secret?.trim()) {
    return privateRedirect(request, UNAVAILABLE_PATH);
  }

  try {
    const { token } = await context.params;
    const now = Date.now();
    const inspection = await inspectGroupInvitation(
      createGroupInvitationClaimStore(db),
      { rawToken: token, secret, now },
    );
    if (inspection.kind !== "active") {
      return privateRedirect(request, UNAVAILABLE_PATH);
    }

    const remainingSeconds = Math.floor(
      (inspection.expiresAt - now) / 1_000,
    );
    if (remainingSeconds < 1) {
      return privateRedirect(request, UNAVAILABLE_PATH);
    }

    const maxAge = Math.min(
      GROUP_INVITATION_COOKIE_TTL_SECONDS,
      remainingSeconds,
    );
    const response = privateRedirect(request, "/invite/claim");
    response.cookies.set(
      GROUP_INVITATION_COOKIE_NAME,
      token,
      getGroupInvitationCookieOptions(maxAge, request.url),
    );
    return response;
  } catch {
    return privateRedirect(request, UNAVAILABLE_PATH);
  }
}
