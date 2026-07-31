"use client";

import { useEffect } from "react";

const CLAIM_PATH = "/invite/claim";

export default function ContinueInvitationPage() {
  useEffect(() => {
    window.location.replace(CLAIM_PATH);
  }, []);

  return (
    <section
      aria-labelledby="invitation-continue-heading"
      className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h1
        id="invitation-continue-heading"
        className="text-2xl font-bold text-slate-900"
      >
        Accepting invitation
      </h1>
      <p className="mt-2 text-sm text-slate-600" role="status">
        Taking you to your shared group.
      </p>
      <a
        href={CLAIM_PATH}
        className="mt-5 inline-flex rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700"
      >
        Continue
      </a>
    </section>
  );
}
