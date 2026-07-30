import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { createAuthAttemptStore } from "@/lib/server/auth-attempt-store";
import { createAuthRateLimiter } from "@/lib/server/auth-rate-limit";
import { getTrustedRequestSource } from "@/lib/server/auth-request-source";
import {
  GROUP_INVITATION_COOKIE_NAME,
  getGroupInvitationCookieOptions,
} from "@/lib/server/group-invitation-cookie";
import {
  claimGroupInvitation,
  createGroupInvitationClaimStore,
} from "@/lib/server/group-invitation-claims";
import { getCurrentUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UNAVAILABLE_PATH = "/invite/result?status=unavailable";

type RedirectOptions = {
  deleteInvitationCookie?: boolean;
  retryAfterSeconds?: number;
};

function privateRedirect(
  request: Request,
  path: string,
  options: RedirectOptions = {},
) {
  const response = NextResponse.redirect(new URL(path, request.url));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");

  if (options.deleteInvitationCookie) {
    response.cookies.set(
      GROUP_INVITATION_COOKIE_NAME,
      "",
      getGroupInvitationCookieOptions(0),
    );
  }
  if (options.retryAfterSeconds !== undefined) {
    response.headers.set(
      "Retry-After",
      String(options.retryAfterSeconds),
    );
  }

  return response;
}

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const rawToken = cookieStore.get(
      GROUP_INVITATION_COOKIE_NAME,
    )?.value;
    const secret = process.env.AUTH_SECRET;
    if (!rawToken || !secret?.trim()) {
      return privateRedirect(request, UNAVAILABLE_PATH, {
        deleteInvitationCookie: Boolean(rawToken),
      });
    }

    const user = await getCurrentUser();
    if (!user) {
      return privateRedirect(request, "/login?invitation=1");
    }

    const limiter = createAuthRateLimiter({
      store: createAuthAttemptStore(db),
      secret,
    });
    const attempt = await limiter.reserve({
      action: "claim",
      identity: user.email,
      source: await getTrustedRequestSource(),
    });
    if (!attempt.allowed) {
      return privateRedirect(request, UNAVAILABLE_PATH, {
        deleteInvitationCookie: true,
        retryAfterSeconds: attempt.retryAfterSeconds,
      });
    }

    const result = await claimGroupInvitation(
      createGroupInvitationClaimStore(db),
      {
        rawToken,
        secret,
        user,
        now: Date.now(),
      },
    );

    if (result.kind === "claimed") {
      try {
        await limiter.succeed(attempt.reservation);
      } catch {
        // The invitation claim is already durable. Rate-limit cleanup is
        // best-effort and must not replace the successful claim response.
      }
      return privateRedirect(
        request,
        `/groups/${encodeURIComponent(result.groupId)}`,
        { deleteInvitationCookie: true },
      );
    }

    if (result.kind === "account-mismatch") {
      return privateRedirect(
        request,
        "/invite/result?status=account-mismatch",
      );
    }

    return privateRedirect(request, UNAVAILABLE_PATH, {
      deleteInvitationCookie: true,
    });
  } catch {
    // Operational failures are deliberately not retried here. Retaining the
    // cookie lets the visitor try the same link again later.
    return privateRedirect(request, UNAVAILABLE_PATH);
  }
}
