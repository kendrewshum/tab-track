"use client";

import * as React from "react";

import {
  cancelGroupInvitationAction,
  revokeGroupAccessAction,
  type AccessManagementFormState,
} from "@/app/auth-actions";

const initialState: AccessManagementFormState = {};

type AccessManagementActionProps =
  | {
      kind: "revoke";
      groupId: string;
      targetId: string;
      email: string;
    }
  | {
      kind: "cancel";
      groupId: string;
      targetId: string;
      email: string;
    };

const actionContent = {
  revoke: {
    triggerLabel: "Remove access",
    confirmLabel: "Confirm remove",
    keepLabel: "Keep access",
    pendingLabel: "Removing...",
  },
  cancel: {
    triggerLabel: "Cancel invitation",
    confirmLabel: "Confirm cancel",
    keepLabel: "Keep invitation",
    pendingLabel: "Cancelling...",
  },
} as const;

export function AccessManagementAction({
  kind,
  groupId,
  targetId,
  email,
}: AccessManagementActionProps) {
  const serverAction =
    kind === "revoke"
      ? revokeGroupAccessAction
      : cancelGroupInvitationAction;
  const [state, action, pending] = React.useActionState(
    serverAction.bind(null, groupId),
    initialState,
  );
  const [confirming, setConfirming] = React.useState(false);
  const [awaitingResult, setAwaitingResult] = React.useState(false);
  const triggerButtonRef = React.useRef<HTMLButtonElement>(null);
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);
  const submittedStateRef = React.useRef<AccessManagementFormState>(state);
  const restoreTriggerFocusRef = React.useRef(false);
  const wasConfirmingRef = React.useRef(false);
  const guidanceId = React.useId();
  const content = actionContent[kind];
  const currentSubmissionComplete =
    awaitingResult && !pending && state !== submittedStateRef.current;

  React.useEffect(() => {
    if (currentSubmissionComplete && state.success && confirming) {
      restoreTriggerFocusRef.current = false;
      setConfirming(false);
    }
  }, [currentSubmissionComplete, state.success, confirming]);

  React.useEffect(() => {
    if (confirming) {
      confirmButtonRef.current?.focus();
    } else if (
      wasConfirmingRef.current &&
      restoreTriggerFocusRef.current
    ) {
      triggerButtonRef.current?.focus();
      restoreTriggerFocusRef.current = false;
    }

    wasConfirmingRef.current = confirming;
  }, [confirming]);

  function openConfirmation() {
    setAwaitingResult(false);
    restoreTriggerFocusRef.current = false;
    setConfirming(true);
  }

  function markSubmissionStarted() {
    submittedStateRef.current = state;
    setAwaitingResult(true);
  }

  function keepAccessOrInvitation() {
    setAwaitingResult(false);
    restoreTriggerFocusRef.current = true;
    setConfirming(false);
  }

  const guidance =
    kind === "revoke"
      ? `Remove app access for ${email}? Their ledger member and history will remain.`
      : `Cancel the invitation for ${email}? The current link will stop working.`;

  return (
    <div className="min-w-0">
      {confirming ? (
        <form
          action={action}
          onSubmit={markSubmissionStarted}
          className="min-w-0 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
        >
          <input
            type="hidden"
            name={kind === "revoke" ? "accessId" : "invitationId"}
            value={targetId}
          />
          <p
            id={guidanceId}
            className="break-words text-sm text-slate-700"
          >
            {guidance}
          </p>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              ref={confirmButtonRef}
              type="submit"
              disabled={pending}
              aria-describedby={guidanceId}
              className="min-h-11 w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
            >
              {pending ? content.pendingLabel : content.confirmLabel}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={keepAccessOrInvitation}
              className="min-h-11 w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
            >
              {content.keepLabel}
            </button>
          </div>
          {currentSubmissionComplete && state.error ? (
            <p className="break-words text-sm text-red-600" role="alert">
              {state.error}
            </p>
          ) : null}
        </form>
      ) : (
        <button
          ref={triggerButtonRef}
          type="button"
          disabled={pending}
          onClick={openConfirmation}
          className="min-h-11 w-full rounded-lg px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-inset ring-red-200 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
        >
          {content.triggerLabel}
        </button>
      )}
      {currentSubmissionComplete && state.success ? (
        <p className="mt-2 break-words text-sm text-green-700" role="status">
          {state.success}
        </p>
      ) : null}
    </div>
  );
}
