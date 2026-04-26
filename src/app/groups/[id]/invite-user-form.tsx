"use client";

import { useActionState } from "react";

import { inviteUserToGroupAction, type InviteFormState } from "@/app/auth-actions";

const initialState: InviteFormState = {};

export function InviteUserForm({ groupId }: { groupId: string }) {
  const [state, action, pending] = useActionState(
    inviteUserToGroupAction.bind(null, groupId),
    initialState
  );

  return (
    <form action={action} className="space-y-3">
      <div className="flex gap-2">
        <input
          name="email"
          type="email"
          placeholder="friend@example.com"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
        <button
          type="submit"
          disabled={pending}
          className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-70"
        >
          {pending ? "Sharing..." : "Share Group"}
        </button>
      </div>

      {state.error ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}

      {state.success ? <p className="text-sm text-green-600">{state.success}</p> : null}
    </form>
  );
}
