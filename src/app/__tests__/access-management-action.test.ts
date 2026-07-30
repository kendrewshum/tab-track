import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelGroupInvitationAction: vi.fn(),
  revokeGroupAccessAction: vi.fn(),
  useActionState: vi.fn(),
  useEffect: vi.fn(),
  useState: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return {
    ...original,
    useActionState: mocks.useActionState,
    useEffect: mocks.useEffect,
    useState: mocks.useState,
  };
});

vi.mock("@/app/auth-actions", () => ({
  cancelGroupInvitationAction: mocks.cancelGroupInvitationAction,
  revokeGroupAccessAction: mocks.revokeGroupAccessAction,
}));

import { AccessManagementAction } from "@/app/groups/[id]/access-management-action";

type ElementLike = {
  type?: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

function collectElements(node: unknown): ElementLike[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectElements);
  }
  if (
    typeof node !== "object" ||
    node === null ||
    !("props" in node) ||
    typeof node.props !== "object" ||
    node.props === null
  ) {
    return [];
  }

  const element = node as ElementLike;
  return [element, ...collectElements(element.props.children)];
}

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textContent).join("");
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

function renderAction({
  kind,
  state = {},
  pending = false,
  confirming = false,
}: {
  kind: "revoke" | "cancel";
  state?: { error?: string; success?: string };
  pending?: boolean;
  confirming?: boolean;
}) {
  const setConfirming = vi.fn();
  const action = vi.fn();
  mocks.useActionState.mockReturnValue([state, action, pending]);
  mocks.useState.mockReturnValue([confirming, setConfirming]);

  const targetId = kind === "revoke" ? "access-1" : "invitation-1";
  const tree = AccessManagementAction({
    kind,
    groupId: "group-1",
    targetId,
    email: "friend@example.com",
  });

  return {
    action,
    elements: collectElements(tree),
    setConfirming,
    targetId,
  };
}

describe("AccessManagementAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("binds revoke submissions and opens the remove confirmation", async () => {
    const { elements, setConfirming } = renderAction({ kind: "revoke" });
    const removeButton = elements.find(
      (element) =>
        element.props.type === "button" &&
        textContent(element.props.children) === "Remove access",
    );

    expect(removeButton?.props.type).toBe("button");
    expect(removeButton?.props.disabled).toBe(false);
    (removeButton?.props.onClick as (() => void) | undefined)?.();
    expect(setConfirming).toHaveBeenCalledWith(true);

    const boundAction = mocks.useActionState.mock.calls[0][0];
    const formData = new FormData();
    await boundAction({}, formData);
    expect(mocks.revokeGroupAccessAction).toHaveBeenCalledWith(
      "group-1",
      {},
      formData,
    );
    expect(mocks.cancelGroupInvitationAction).not.toHaveBeenCalled();
  });

  test("renders the remove confirmation guidance and accessId payload", () => {
    const { elements, targetId } = renderAction({
      kind: "revoke",
      confirming: true,
    });

    expect(
      elements.some(
        (element) =>
          textContent(element.props.children) ===
          "Remove app access for friend@example.com? Their ledger member and history will remain.",
      ),
    ).toBe(true);
    expect(
      elements.find(
        (element) =>
          element.props.type === "hidden" &&
          element.props.name === "accessId",
      )?.props.value,
    ).toBe(targetId);
    expect(
      elements.some((element) => element.props.name === "invitationId"),
    ).toBe(false);
    expect(
      elements.some(
        (element) => textContent(element.props.children) === "Confirm remove",
      ),
    ).toBe(true);
    expect(
      elements.some(
        (element) => textContent(element.props.children) === "Keep access",
      ),
    ).toBe(true);
  });

  test("binds cancellation and disables its confirmation while pending", async () => {
    const { elements, targetId } = renderAction({
      kind: "cancel",
      confirming: true,
      pending: true,
    });

    expect(
      elements.some(
        (element) =>
          textContent(element.props.children) ===
          "Cancel the invitation for friend@example.com? The current link will stop working.",
      ),
    ).toBe(true);
    expect(
      elements.find(
        (element) =>
          element.props.type === "hidden" &&
          element.props.name === "invitationId",
      )?.props.value,
    ).toBe(targetId);
    expect(
      elements.some((element) => element.props.name === "accessId"),
    ).toBe(false);

    const cancellingButton = elements.find(
      (element) => textContent(element.props.children) === "Cancelling...",
    );
    const keepButton = elements.find(
      (element) => textContent(element.props.children) === "Keep invitation",
    );
    expect(cancellingButton?.props.disabled).toBe(true);
    expect(keepButton?.props.disabled).toBe(true);

    const boundAction = mocks.useActionState.mock.calls[0][0];
    const formData = new FormData();
    await boundAction({}, formData);
    expect(mocks.cancelGroupInvitationAction).toHaveBeenCalledWith(
      "group-1",
      {},
      formData,
    );
    expect(mocks.revokeGroupAccessAction).not.toHaveBeenCalled();
  });

  test("keeps confirmation open after an accessible error", () => {
    const { elements, setConfirming } = renderAction({
      kind: "revoke",
      confirming: true,
      state: { error: "We could not remove that access." },
    });

    const alert = elements.find((element) => element.props.role === "alert");
    expect(textContent(alert?.props.children)).toBe(
      "We could not remove that access.",
    );
    expect(
      elements.some(
        (element) => textContent(element.props.children) === "Confirm remove",
      ),
    ).toBe(true);

    const closeAfterSuccess = mocks.useEffect.mock.calls[0][0];
    closeAfterSuccess();
    expect(setConfirming).not.toHaveBeenCalled();
  });

  test("announces success and closes confirmation once it succeeds", () => {
    const { elements, setConfirming } = renderAction({
      kind: "cancel",
      confirming: true,
      state: { success: "Invitation cancelled." },
    });

    const status = elements.find((element) => element.props.role === "status");
    expect(textContent(status?.props.children)).toBe("Invitation cancelled.");

    const [closeAfterSuccess, dependencies] = mocks.useEffect.mock.calls[0];
    expect(dependencies).toEqual(["Invitation cancelled."]);
    closeAfterSuccess();
    expect(setConfirming).toHaveBeenCalledWith(false);
  });
});
