"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { type AuthFormState, signupAction } from "@/app/auth-actions";

const initialState: AuthFormState = {};

export function SignupForm({
  hasGroupInvitation,
}: {
  hasGroupInvitation: boolean;
}) {
  const [state, action, pending] = useActionState(signupAction, initialState);
  const [useAppInviteCode, setUseAppInviteCode] = useState(false);
  const showInviteCode = !hasGroupInvitation || useAppInviteCode;

  return (
    <form action={action} className="space-y-5">
      {hasGroupInvitation ? (
        <p
          className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
          role="status"
        >
          {useAppInviteCode
            ? "Use your app invite code to create your account. Your group invitation will remain available."
            : "Create an account to accept your group invitation."}
        </p>
      ) : null}

      <div>
        <label
          className="block text-sm font-medium text-slate-700 mb-1.5"
          htmlFor="signup-display-name"
        >
          Name
        </label>
        <input
          id="signup-display-name"
          name="displayName"
          autoComplete="name"
          required
          placeholder="Your name"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
      </div>

      <div>
        <label
          className="block text-sm font-medium text-slate-700 mb-1.5"
          htmlFor="signup-email"
        >
          Email
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
      </div>

      <div>
        <label
          className="block text-sm font-medium text-slate-700 mb-1.5"
          htmlFor="signup-password"
        >
          Password
        </label>
        <input
          id="signup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          placeholder="At least 8 characters"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
      </div>

      {hasGroupInvitation ? (
        <button
          type="button"
          aria-controls="signup-invite-code"
          aria-expanded={useAppInviteCode}
          onClick={() => setUseAppInviteCode(!useAppInviteCode)}
          className="text-sm font-medium text-green-700 hover:text-green-800"
        >
          {useAppInviteCode
            ? "Use group invitation instead"
            : "Use app invite code instead"}
        </button>
      ) : null}

      {showInviteCode ? (
        <div>
          <label
            className="block text-sm font-medium text-slate-700 mb-1.5"
            htmlFor="signup-invite-code"
          >
            Invite Code
          </label>
          <input
            id="signup-invite-code"
            name="inviteCode"
            autoComplete="off"
            required
            placeholder="Enter invite code"
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>
      ) : null}

      {state.error ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-green-600 text-white py-3 rounded-xl font-semibold hover:bg-green-700 transition-colors disabled:opacity-70"
      >
        {pending ? "Creating Account..." : "Create Account"}
      </button>

      <p className="text-sm text-slate-500 text-center">
        Already have an account?{" "}
        <Link href="/login" className="text-green-600 hover:text-green-700 font-medium">
          Sign in
        </Link>
      </p>
    </form>
  );
}
