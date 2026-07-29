"use client";

import { useActionState, useId } from "react";

import {
  setMemberAccountLinkAction,
  type MemberAccountLinkFormState,
} from "@/app/auth-actions";
import type { MemberLinkChoice } from "@/lib/member-account-links";

const initialState: MemberAccountLinkFormState = {};

export function MemberAccountLinkForm({
  groupId,
  accessId,
  memberId,
  choices,
}: {
  groupId: string;
  accessId: string;
  memberId: string | null;
  choices: MemberLinkChoice[];
}) {
  const selectId = useId();
  const [state, action, pending] = useActionState(
    setMemberAccountLinkAction.bind(null, groupId),
    initialState
  );

  return (
    <form
      key={`${accessId}:${memberId ?? ""}`}
      action={action}
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <input type="hidden" name="accessId" value={accessId} />
      <div className="min-w-0 flex-1">
        <label
          htmlFor={selectId}
          className="mb-1 block text-xs font-medium text-slate-600"
        >
          Ledger member
        </label>
        <select
          id={selectId}
          name="memberId"
          defaultValue={memberId ?? ""}
          disabled={pending}
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
      >
        {pending ? "Saving..." : "Save"}
      </button>
      {state.error ? (
        <p className="text-sm text-red-600 sm:basis-full" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="text-sm text-green-600 sm:basis-full" role="status">
          {state.success}
        </p>
      ) : null}
    </form>
  );
}
