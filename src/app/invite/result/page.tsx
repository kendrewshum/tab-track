import Link from "next/link";
import React from "react";

import { logoutAction } from "@/app/auth-actions";

export const dynamic = "force-dynamic";

type InviteResultPageProps = {
  searchParams: Promise<{
    status?: string | string[];
  }>;
};

export default async function InviteResultPage({
  searchParams,
}: InviteResultPageProps) {
  const { status } = await searchParams;
  const isAccountMismatch = status === "account-mismatch";

  return (
    <div className="max-w-md mx-auto pt-8">
      <section
        aria-labelledby="invitation-result-heading"
        className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6 shadow-sm"
      >
        <div className="space-y-2">
          <h1
            id="invitation-result-heading"
            className="text-2xl font-bold text-slate-900"
          >
            {isAccountMismatch
              ? "Use the invited account"
              : "Invitation unavailable"}
          </h1>
          <p className="text-sm text-slate-600">
            {isAccountMismatch
              ? "Sign out, then sign in with the account that received this invitation."
              : "This invitation cannot be used. Please ask the group owner for a new link."}
          </p>
        </div>

        {isAccountMismatch ? (
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700"
            >
              Sign Out
            </button>
          </form>
        ) : null}

        <nav
          aria-label="Invitation result actions"
          className="flex flex-col gap-3 sm:flex-row"
        >
          <Link
            href="/login"
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Sign In
          </Link>
          <Link
            href="/"
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Home
          </Link>
        </nav>
      </section>
    </div>
  );
}
