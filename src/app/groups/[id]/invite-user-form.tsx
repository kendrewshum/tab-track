"use client";

import * as React from "react";

import { inviteUserToGroupAction, type InviteFormState } from "@/app/auth-actions";

const initialState: InviteFormState = {};

export function InviteUserForm({
  groupId,
  choices,
}: {
  groupId: string;
  choices: { id: string; name: string }[];
}) {
  const [state, action, pending] = React.useActionState(
    inviteUserToGroupAction.bind(null, groupId),
    initialState
  );
  const [copied, setCopied] = React.useState(false);
  const formId = React.useId();

  React.useEffect(() => {
    setCopied(false);
  }, [state.invitationPath]);

  async function copyInvitationLink() {
    if (!state.invitationPath) {
      return;
    }

    const invitationUrl = new URL(
      state.invitationPath,
      window.location.origin,
    ).toString();
    await navigator.clipboard.writeText(invitationUrl);
    setCopied(true);
  }

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1" htmlFor={`${formId}-email`}>
          <span className="block text-sm font-medium text-slate-700">Email</span>
          <input
            id={`${formId}-email`}
            name="email"
            type="email"
            autoComplete="email"
            placeholder="friend@example.com"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </label>
        <label className="space-y-1" htmlFor={`${formId}-member`}>
          <span className="block text-sm font-medium text-slate-700">
            Ledger member <span className="font-normal text-slate-400">(optional)</span>
          </span>
          <select
            id={`${formId}-member`}
            name="memberId"
            defaultValue=""
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="">No linked member</option>
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <input
          type="submit"
          disabled={pending}
          value={pending ? "Sharing..." : "Share Group"}
          className="cursor-pointer rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
        />
      </div>

      {state.error ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}

      {state.success ? (
        <p className="text-sm text-green-600" role="status">
          {state.success}
        </p>
      ) : null}

      {state.invitationPath ? (
        <div className="space-y-2 rounded-lg border border-green-200 bg-green-50 p-3">
          <label
            className="block text-sm font-medium text-slate-700"
            htmlFor={`${formId}-invitation-path`}
          >
            Invitation link
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={`${formId}-invitation-path`}
              readOnly
              value={state.invitationPath}
              className="min-w-0 flex-1 rounded-lg border border-green-200 bg-white px-3 py-2 text-sm text-slate-700"
            />
            <button
              type="button"
              onClick={copyInvitationLink}
              className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
            >
              Copy invitation link
            </button>
          </div>
          {copied ? (
            <p className="text-sm font-medium text-green-700" role="status">
              Copied
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
