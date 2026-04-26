"use client";

import Link from "next/link";
import { useActionState } from "react";

import { type AuthFormState, loginAction } from "@/app/auth-actions";

const initialState: AuthFormState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState);

  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
        <input
          name="password"
          type="password"
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
