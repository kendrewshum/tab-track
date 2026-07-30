import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelGroupInvitationAction: vi.fn(),
  revokeGroupAccessAction: vi.fn(),
  useActionState: vi.fn(),
  useEffect: vi.fn(),
  useId: vi.fn(),
  useRef: vi.fn(),
  useState: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return {
    ...original,
    useActionState: mocks.useActionState,
    useEffect: mocks.useEffect,
    useId: mocks.useId,
    useRef: mocks.useRef,
    useState: mocks.useState,
  };
});

vi.mock("@/app/auth-actions", () => ({
  cancelGroupInvitationAction: mocks.cancelGroupInvitationAction,
  revokeGroupAccessAction: mocks.revokeGroupAccessAction,
}));

import { AccessManagementAction } from "@/app/groups/[id]/access-management-action";

type ActionState = { error?: string; success?: string };

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
  awaitingResult = false,
  submittedState,
  restoreTriggerFocus = false,
  wasConfirming = false,
}: {
  kind: "revoke" | "cancel";
  state?: ActionState;
  pending?: boolean;
  confirming?: boolean;
  awaitingResult?: boolean;
  submittedState?: ActionState;
  restoreTriggerFocus?: boolean;
  wasConfirming?: boolean;
}) {
  const setConfirming = vi.fn();
  const setAwaitingResult = vi.fn();
  const action = vi.fn();
  const triggerFocus = vi.fn();
  const confirmFocus = vi.fn();
  const triggerRef = { current: { focus: triggerFocus } };
  const confirmRef = { current: { focus: confirmFocus } };
  const submittedStateRef = { current: submittedState ?? state };
  const restoreTriggerFocusRef = { current: restoreTriggerFocus };
  const wasConfirmingRef = { current: wasConfirming };

  mocks.useActionState.mockReturnValue([state, action, pending]);
  mocks.useState
    .mockReset()
    .mockReturnValueOnce([confirming, setConfirming])
    .mockReturnValueOnce([awaitingResult, setAwaitingResult]);
  mocks.useRef
    .mockReset()
    .mockReturnValueOnce(triggerRef)
    .mockReturnValueOnce(confirmRef)
    .mockReturnValueOnce(submittedStateRef)
    .mockReturnValueOnce(restoreTriggerFocusRef)
    .mockReturnValueOnce(wasConfirmingRef);
  mocks.useId.mockReturnValue("access-management-guidance");

  const targetId = kind === "revoke" ? "access-1" : "invitation-1";
  const tree = AccessManagementAction({
    kind,
    groupId: "group-1",
    targetId,
    email: "friend@example.com",
  });

  return {
    action,
    confirmFocus,
    elements: collectElements(tree),
    restoreTriggerFocusRef,
    setAwaitingResult,
    setConfirming,
    targetId,
    triggerFocus,
  };
}

function findEffectByDependencies(
  predicate: (dependencies: unknown[]) => boolean,
) {
  return mocks.useEffect.mock.calls.find(
    ([, dependencies]) =>
      Array.isArray(dependencies) && predicate(dependencies),
  )?.[0] as (() => void) | undefined;
}

describe("AccessManagementAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("binds revoke submissions and opens the remove confirmation", async () => {
    const { elements, setAwaitingResult, setConfirming } = renderAction({
      kind: "revoke",
    });
    const removeButton = elements.find(
      (element) =>
        element.props.type === "button" &&
        textContent(element.props.children) === "Remove access",
    );

    expect(removeButton?.props.disabled).toBe(false);
    (removeButton?.props.onClick as (() => void) | undefined)?.();
    expect(setAwaitingResult).toHaveBeenCalledWith(false);
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

  test("renders accessible remove confirmation markup and accessId payload", () => {
    const { elements, targetId } = renderAction({
      kind: "revoke",
      confirming: true,
    });

    const guidance = elements.find(
      (element) =>
        element.props.id === "access-management-guidance" &&
        textContent(element.props.children) ===
          "Remove app access for friend@example.com? Their ledger member and history will remain.",
    );
    const confirmButton = elements.find(
      (element) =>
        element.props.type === "submit" &&
        textContent(element.props.children) === "Confirm remove",
    );

    expect(guidance).toBeDefined();
    expect(confirmButton?.props["aria-describedby"]).toBe(
      "access-management-guidance",
    );
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

  test("renders an error only for a completed current submission", () => {
    const state = { error: "We could not remove that access." };
    const staleRender = renderAction({
      kind: "revoke",
      confirming: true,
      state,
      awaitingResult: false,
    });
    expect(
      staleRender.elements.find((element) => element.props.role === "alert"),
    ).toBeUndefined();

    const currentRender = renderAction({
      kind: "revoke",
      confirming: true,
      state,
      awaitingResult: true,
      submittedState: {},
    });
    const alert = currentRender.elements.find(
      (element) => element.props.role === "alert",
    );
    expect(textContent(alert?.props.children)).toBe(state.error);
    expect(
      currentRender.elements.some(
        (element) => textContent(element.props.children) === "Confirm remove",
      ),
    ).toBe(true);
  });

  test("uses contrast-compliant accessible success feedback for the current submission", () => {
    const { elements } = renderAction({
      kind: "cancel",
      confirming: true,
      state: { success: "Invitation cancelled." },
      awaitingResult: true,
      submittedState: {},
    });

    const status = elements.find((element) => element.props.role === "status");
    expect(textContent(status?.props.children)).toBe("Invitation cancelled.");
    expect(status?.props.className).toContain("text-green-700");
  });

  test("requests confirmation focus only after opening", () => {
    const collapsed = renderAction({ kind: "revoke" });
    findEffectByDependencies(
      (dependencies) =>
        dependencies.length === 1 && dependencies[0] === false,
    )?.();
    expect(collapsed.confirmFocus).not.toHaveBeenCalled();
    expect(collapsed.triggerFocus).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const open = renderAction({ kind: "revoke", confirming: true });
    findEffectByDependencies(
      (dependencies) =>
        dependencies.length === 1 && dependencies[0] === true,
    )?.();
    expect(open.confirmFocus).toHaveBeenCalledOnce();
    expect(open.triggerFocus).not.toHaveBeenCalled();
  });

  test("marks Keep for trigger restoration but not a successful submission", () => {
    const manualClose = renderAction({
      kind: "cancel",
      confirming: true,
    });
    const keepButton = manualClose.elements.find(
      (element) =>
        element.props.type === "button" &&
        textContent(element.props.children) === "Keep invitation",
    );
    (keepButton?.props.onClick as (() => void) | undefined)?.();
    expect(manualClose.restoreTriggerFocusRef.current).toBe(true);
    expect(manualClose.setAwaitingResult).toHaveBeenCalledWith(false);
    expect(manualClose.setConfirming).toHaveBeenCalledWith(false);

    vi.clearAllMocks();
    const successClose = renderAction({
      kind: "cancel",
      confirming: true,
      state: { success: "Invitation cancelled." },
      awaitingResult: true,
      submittedState: {},
      restoreTriggerFocus: true,
    });
    findEffectByDependencies(
      (dependencies) => dependencies.length === 3,
    )?.();
    expect(successClose.restoreTriggerFocusRef.current).toBe(false);
    expect(successClose.setConfirming).toHaveBeenCalledWith(false);
  });

  test("requests trigger focus after a manual confirmation close", () => {
    const closed = renderAction({
      kind: "revoke",
      restoreTriggerFocus: true,
      wasConfirming: true,
    });
    findEffectByDependencies(
      (dependencies) =>
        dependencies.length === 1 && dependencies[0] === false,
    )?.();
    expect(closed.triggerFocus).toHaveBeenCalledOnce();
    expect(closed.confirmFocus).not.toHaveBeenCalled();
  });
});
