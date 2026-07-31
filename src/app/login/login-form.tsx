"use client";

import Link from "next/link";
import { useActionState } from "react";

import { type AuthFormState, loginAction } from "@/app/auth-actions";

const initialState: AuthFormState = {};

export function LoginForm({
  hasGroupInvitation,
}: {
  hasGroupInvitation: boolean;
}) {
  const [state, action, pending] = useActionState(loginAction, initialState);

  return (
    <form action={action} className="space-y-5">
      {hasGroupInvitation ? (
        <p
          className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
          role="status"
        >
          Sign in to accept your group invitation.
        </p>
      ) : null}

      <div>
        <label
          className="block text-sm font-medium text-slate-700 mb-1.5"
          htmlFor="login-email"
        >
          Email
        </label>
        <input
          id="login-email"
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
          htmlFor="login-password"
        >
          Password
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Your password"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
      </div>

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
        {pending ? "Signing In..." : "Sign In"}
      </button>

      <p className="text-sm text-slate-500 text-center">
        Need an account?{" "}
        <Link href="/signup" className="text-green-600 hover:text-green-700 font-medium">
          Create an account
        </Link>
      </p>
    </form>
  );
}
