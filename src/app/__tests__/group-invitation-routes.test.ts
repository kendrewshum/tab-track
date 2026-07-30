import { renderToStaticMarkup } from "react-dom/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  claimGroupInvitation: vi.fn(),
  createAuthAttemptStore: vi.fn(),
  createAuthRateLimiter: vi.fn(),
  createGroupInvitationClaimStore: vi.fn(),
  getCurrentUser: vi.fn(),
  getTrustedRequestSource: vi.fn(),
  inspectGroupInvitation: vi.fn(),
  limiterReserve: vi.fn(),
  limiterSucceed: vi.fn(),
  requestCookies: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mocks.requestCookies,
}));

vi.mock("@/app/auth-actions", () => ({
  logoutAction: "/logout",
}));

vi.mock("@/db", () => ({
  db: { kind: "mock-db" },
}));

vi.mock("@/lib/server/auth-attempt-store", () => ({
  createAuthAttemptStore: mocks.createAuthAttemptStore,
}));

vi.mock("@/lib/server/auth-rate-limit", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/lib/server/auth-rate-limit")
    >();
  return {
    ...original,
    createAuthRateLimiter: mocks.createAuthRateLimiter,
  };
});

vi.mock("@/lib/server/auth-request-source", () => ({
  getTrustedRequestSource: mocks.getTrustedRequestSource,
}));

vi.mock("@/lib/server/group-invitation-claims", () => ({
  claimGroupInvitation: mocks.claimGroupInvitation,
  createGroupInvitationClaimStore:
    mocks.createGroupInvitationClaimStore,
  inspectGroupInvitation: mocks.inspectGroupInvitation,
}));

vi.mock("@/lib/server/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

import { GET as claimInvitation } from "@/app/invite/claim/route";
import { GET as landInvitation } from "@/app/invite/[token]/route";
import InviteResultPage from "@/app/invite/result/page";

const requestUrl = "https://tabtrack.example/invite/raw-token";
const rawToken = "raw-token";
const reservation = {
  buckets: [
    {
      bucketKey: "a".repeat(64),
      kind: "identity" as const,
      limit: 5,
      windowMs: 900_000,
    },
  ],
};

function invitationCookie(value: string | null = rawToken) {
  return {
    get: vi.fn().mockReturnValue(
      value === null ? undefined : { name: "cookie", value },
    ),
  };
}

function expectPrivateRedirect(
  response: Response,
  expectedLocation: string,
) {
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(expectedLocation);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

function serializedResponse(response: Response) {
  return [
    response.headers.get("location"),
    response.headers.get("set-cookie"),
    ...Array.from(response.headers.entries()).flat(),
  ].join("\n");
}

describe("GET /invite/[token]", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "server-secret");
    vi.stubEnv("NODE_ENV", "test");
    mocks.createGroupInvitationClaimStore.mockReturnValue({
      kind: "claim-store",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    {
      label: "thirty minutes",
      remainingMs: 31 * 60 * 1_000,
      expectedMaxAge: 1_800,
    },
    {
      label: "the invitation remaining lifetime",
      remainingMs: 1_234_999,
      expectedMaxAge: 1_234,
    },
    {
      label: "one whole remaining second",
      remainingMs: 1_000,
      expectedMaxAge: 1,
    },
  ])(
    "sets the raw token cookie for no more than $label",
    async ({ remainingMs, expectedMaxAge }) => {
      const now = 1_800_000_000_000;
      vi.spyOn(Date, "now").mockReturnValue(now);
      mocks.inspectGroupInvitation.mockResolvedValue({
        kind: "active",
        expiresAt: now + remainingMs,
      });

      const response = await landInvitation(
        new Request(requestUrl, {
          headers: { "x-forwarded-host": "attacker.example" },
        }),
        { params: Promise.resolve({ token: rawToken }) },
      );

      expectPrivateRedirect(
        response,
        "https://tabtrack.example/invite/claim",
      );
      expect(response.headers.get("set-cookie")).toContain(
        `tab-track-group-invitation=${rawToken}`,
      );
      expect(response.headers.get("set-cookie")).toContain(
        `Max-Age=${expectedMaxAge}`,
      );
      expect(response.headers.get("set-cookie")).toContain("HttpOnly");
      expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
      expect(mocks.inspectGroupInvitation).toHaveBeenCalledWith(
        { kind: "claim-store" },
        { rawToken, secret: "server-secret", now },
      );
    },
  );

  it("does not set a cookie with less than one whole second remaining", async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    mocks.inspectGroupInvitation.mockResolvedValue({
      kind: "active",
      expiresAt: now + 999,
    });

    const response = await landInvitation(
      new Request(requestUrl),
      { params: Promise.resolve({ token: rawToken }) },
    );

    expectPrivateRedirect(
      response,
      "https://tabtrack.example/invite/result?status=unavailable",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns a sanitized result when the invitation is unavailable", async () => {
    mocks.inspectGroupInvitation.mockResolvedValue({
      kind: "unavailable",
    });

    const response = await landInvitation(
      new Request(requestUrl),
      { params: Promise.resolve({ token: rawToken }) },
    );

    expectPrivateRedirect(
      response,
      "https://tabtrack.example/invite/result?status=unavailable",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns the same sanitized result when configuration is missing", async () => {
    vi.stubEnv("AUTH_SECRET", "   ");

    const response = await landInvitation(
      new Request(requestUrl),
      { params: Promise.resolve({ token: rawToken }) },
    );

    expectPrivateRedirect(
      response,
      "https://tabtrack.example/invite/result?status=unavailable",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.inspectGroupInvitation).not.toHaveBeenCalled();
  });

  it("sanitizes inspection and database failures", async () => {
    mocks.inspectGroupInvitation.mockRejectedValue(
      new Error(`database failed for ${rawToken} with server-secret`),
    );

    const response = await landInvitation(
      new Request(requestUrl),
      { params: Promise.resolve({ token: rawToken }) },
    );

    expectPrivateRedirect(
      response,
      "https://tabtrack.example/invite/result?status=unavailable",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(serializedResponse(response)).not.toContain(rawToken);
    expect(serializedResponse(response)).not.toContain("server-secret");
    expect(serializedResponse(response)).not.toContain("database failed");
    const body = await response.text();
    expect(body).not.toContain(rawToken);
    expect(body).not.toContain("server-secret");
    expect(body).not.toContain("database failed");
  });
});

describe("GET /invite/claim", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "server-secret");
    vi.stubEnv("NODE_ENV", "test");
    mocks.requestCookies.mockResolvedValue(invitationCookie());
    mocks.getCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "friend@example.com",
      displayName: "Friend",
    });
    mocks.getTrustedRequestSource.mockResolvedValue("203.0.113.10");
    mocks.createGroupInvitationClaimStore.mockReturnValue({
      kind: "claim-store",
    });
    mocks.createAuthAttemptStore.mockReturnValue({
      kind: "attempt-store",
    });
    mocks.createAuthRateLimiter.mockReturnValue({
      reserve: mocks.limiterReserve,
      succeed: mocks.limiterSucceed,
    });
    mocks.limiterReserve.mockResolvedValue({
      allowed: true,
      reservation,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("retains the cookie and redirects signed-out visitors to login", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await claimInvitation(
      new Request("https://tabtrack.example/invite/claim"),
    );

    expectPrivateRedirect(
      response,
      "https://tabtrack.example/login?invitation=1",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.limiterReserve).not.toHaveBeenCalled();
    expect(mocks.claimGroupInvitation).not.toHaveBeenCalled();
  });

  it("deletes a present cookie when configuration is missing", async () => {
    vi.stubEnv("AUTH_SECRET", "");

    const response = await claimInvitation(
      new Request("https://tabtrack.example/invite/claim"),
    );

    expectPrivateRedirect(
      response,
      "https://tabtrack.example/invite/result?status=unavailable",
    );
    expect(response.headers.get("set-cookie")).toContain(
      "tab-track-group-invitation=;",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(mocks.limiterReserve).not.toHaveBeenCalled();
  });

  it("returns generic unavailable when the cookie is missing", async () => {
    mocks.requestCookies.mockResolvedValue(
      invitationCookie(null),
    );

    const response = await claimInvitation(
      new Request("https://tabtrack.example/invite/claim"),
    );

    expectPrivateRedirect(
      response,
      "https://tabtrack.example/invite/result?status=unavailable",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.limiterReserve).not.toHaveBeenCalled();
  });

  it("claims, succeeds the reservation, deletes the cookie, and uses a safe group path", async () => {
    mocks.claimGroupInvitation.mockResolvedValue({
      kind: "claimed",
      groupId: "group/../private?x=1",
    });

    const response = await claimInvitation(
      new Request("https://tabtrack.example/invite/claim"),
    );

    expect(mocks.limiterReserve).toHaveBeenCalledWith({
      action: "claim",
      identity: "friend@example.com",
      source: "203.0.113.10",
    });
    expect(mocks.createAuthAttemptStore).toHaveBeenCalledWith({
      kind: "mock-db",
    });
    expect(mocks.createAuthRateLimiter).toHaveBeenCalledWith({
      store: { kind: "attempt-store" },
      secret: "server-secret",
    });
    expect(mocks.claimGroupInvitation).toHaveBeenCalledWith(
      { kind: "claim-store" },
      {
        rawToken,
        secret: "server-secret",
        user: {
          id: "user-1",
          email: "friend@example.com",
          displayName: "Friend",
        },
        now: expect.any(Number),
      },
    );
    expect(mocks.limiterSucceed).toHaveBeenCalledWith(reservation);
    expectPrivateRedirect(
      response,
      "https://tabtrack.example/groups/group%2F..%2Fprivate%3Fx%3D1",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("retains the cookie and reservation after an account mismatch", async () => {
    mocks.claimGroupInvitation.mockResolvedValue({
      kind: "account-mismatch",
    });

    const response = await claimInvitation(
      new Request("https://tabtrack.example/invite/claim"),
    );

    expectPrivateRedirect(
      response,
      "https://tabtrack.example/invite/result?status=account-mismatch",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.limiterSucceed).not.toHaveBeenCalled();
  });

  it("deletes the cookie after an unavailable claim", async () => {
    mocks.claimGroupInvitation.mockResolvedValue({
      kind: "unavailable",
    });

    const response = await claimInvitation(
      new Request("https://tabtrack.example/invite/claim"),
    );

    expectPrivateRedirect(
      response,
      "https://tabtrack.example/invite/result?status=unavailable",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(mocks.limiterSucceed).not.toHaveBeenCalled();
  });

  it("blocks before the claim service, deletes the cookie, and supplies Retry-After", async () => {
    mocks.limiterReserve.mockResolvedValue({
      allowed: false,
      reservation,
      retryAfterSeconds: 417,
    });

    const response = await claimInvitation(
      new Request("https://tabtrack.example/invite/claim"),
    );

    expect(mocks.claimGroupInvitation).not.toHaveBeenCalled();
    expect(mocks.limiterSucceed).not.toHaveBeenCalled();
    expectPrivateRedirect(
      response,
      "https://tabtrack.example/invite/result?status=unavailable",
    );
    expect(response.headers.get("retry-after")).toBe("417");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it.each([
    {
      label: "limiter",
      arrange: () =>
        mocks.limiterReserve.mockRejectedValue(
          new Error(`limiter exposed ${rawToken} server-secret`),
        ),
    },
    {
      label: "claim service",
      arrange: () =>
        mocks.claimGroupInvitation.mockRejectedValue(
          new Error(`claim exposed ${rawToken} server-secret`),
        ),
    },
  ])(
    "sanitizes an unexpected $label error and retains the cookie",
    async ({ arrange }) => {
      arrange();

      const response = await claimInvitation(
        new Request("https://tabtrack.example/invite/claim"),
      );

      expectPrivateRedirect(
        response,
        "https://tabtrack.example/invite/result?status=unavailable",
      );
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(serializedResponse(response)).not.toContain(rawToken);
      expect(serializedResponse(response)).not.toContain("server-secret");
      expect(serializedResponse(response)).not.toContain("exposed");
      const body = await response.text();
      expect(body).not.toContain(rawToken);
      expect(body).not.toContain("server-secret");
      expect(body).not.toContain("exposed");
      expect(mocks.limiterSucceed).not.toHaveBeenCalled();
    },
  );
});

describe("invitation result page", () => {
  it("guides an account mismatch without revealing invitation details", async () => {
    const page = await InviteResultPage({
      searchParams: Promise.resolve({
        status: "account-mismatch",
        email: "invited@example.com",
        group: "Private Group",
        token: "secret-token",
      }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Use the invited account");
    expect(html).toContain("Sign Out");
    expect(html).toContain("Sign In");
    expect(html).toContain("Home");
    expect(html).not.toContain("invited@example.com");
    expect(html).not.toContain("Private Group");
    expect(html).not.toContain("secret-token");
  });

  it("uses generic content for every other status", async () => {
    const page = await InviteResultPage({
      searchParams: Promise.resolve({
        status: "database-failed-secret-token",
        email: "invited@example.com",
        group: "Private Group",
      }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Invitation unavailable");
    expect(html).toContain("ask the group owner for a new link");
    expect(html).not.toContain("database-failed-secret-token");
    expect(html).not.toContain("invited@example.com");
    expect(html).not.toContain("Private Group");
  });
});
