import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useEffect: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return {
    ...original,
    useEffect: mocks.useEffect,
  };
});

import { AccessManagementStatus } from "@/app/groups/[id]/access-management-status";

type ElementLike = {
  props: Record<string, unknown> & { children?: unknown };
};

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (
    typeof node === "object" &&
    node !== null &&
    "props" in node &&
    typeof node.props === "object" &&
    node.props !== null &&
    "children" in node.props
  ) {
    return textContent(node.props.children);
  }
  return "";
}

describe("AccessManagementStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("renders the initial safe message in a polite live region", () => {
    const status = AccessManagementStatus({
      message: "Access removed.",
    }) as ElementLike;

    expect(status.props.role).toBe("status");
    expect(status.props["aria-live"]).toBe("polite");
    expect(textContent(status.props.children)).toBe("Access removed.");
    expect(mocks.useEffect).toHaveBeenCalledOnce();
    expect(mocks.useEffect.mock.calls[0][1]).toBeUndefined();
  });

  test("registers marker cleanup after every render, including identical messages", () => {
    AccessManagementStatus({ message: "Access removed." });
    AccessManagementStatus({ message: "Access removed." });

    expect(mocks.useEffect.mock.calls).toHaveLength(2);
    expect(mocks.useEffect.mock.calls[0]).toHaveLength(1);
    expect(mocks.useEffect.mock.calls[1]).toHaveLength(1);
  });

  test("cleans unknown markers idempotently without changing history state", () => {
    const historyState = { navigation: "preserved" };
    const replaceState = vi.fn(
      (_state: unknown, _unused: string, nextUrl: string) => {
        window.location.href = new URL(
          nextUrl,
          window.location.href,
        ).toString();
      },
    );
    vi.stubGlobal("window", {
      location: {
        href: "https://tab-track.example/groups/group-1?activity=40&accessManagement=%3Cscript%3E&view=all#activity",
      },
      history: {
        state: historyState,
        replaceState,
      },
    });

    expect(AccessManagementStatus({ message: null })).toBeNull();

    const removeMarker = mocks.useEffect.mock.calls[0][0];
    removeMarker();
    removeMarker();
    expect(replaceState).toHaveBeenCalledOnce();
    expect(replaceState).toHaveBeenCalledWith(
      historyState,
      "",
      "/groups/group-1?activity=40&view=all#activity",
    );
  });

  test("leaves clean URLs and history untouched", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      location: {
        href: "https://tab-track.example/groups/group-1?activity=20#history",
      },
      history: {
        state: { navigation: "preserved" },
        replaceState,
      },
    });

    AccessManagementStatus({ message: null });
    const removeMarker = mocks.useEffect.mock.calls[0][0];
    removeMarker();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
