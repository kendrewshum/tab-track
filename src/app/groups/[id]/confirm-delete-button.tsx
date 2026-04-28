"use client";

import { ReactNode } from "react";
import { PendingSubmitButton } from "@/components/pending-submit-button";

interface ConfirmDeleteButtonProps {
  action: () => Promise<void>;
  message: string;
  pendingLabel: ReactNode;
  className?: string;
  title?: string;
  children: ReactNode;
}

export function ConfirmDeleteButton({
  action,
  message,
  pendingLabel,
  className,
  title,
  children,
}: ConfirmDeleteButtonProps) {
  return (
    <form action={action}>
      <PendingSubmitButton
        pendingLabel={pendingLabel}
        className={className}
        title={title}
        onClick={(e) => {
          if (!confirm(message)) {
            e.preventDefault();
          }
        }}
      >
        {children}
      </PendingSubmitButton>
    </form>
  );
}
