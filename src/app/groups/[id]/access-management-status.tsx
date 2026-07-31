"use client";

import * as React from "react";

import { getUrlWithoutAccessManagementStatus } from "@/lib/access-management-status";

export function AccessManagementStatus({
  message,
}: {
  message: string | null;
}) {
  React.useEffect(() => {
    const cleanUrl = getUrlWithoutAccessManagementStatus(
      window.location.href,
    );
    if (cleanUrl === undefined) {
      return;
    }

    window.history.replaceState(window.history.state, "", cleanUrl);
  }, []);

  if (!message) {
    return null;
  }

  return (
    <p
      className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"
      role="status"
      aria-live="polite"
    >
      {message}
    </p>
  );
}
