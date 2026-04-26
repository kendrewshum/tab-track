"use client";

import { ReactNode } from "react";

interface ConfirmDeleteButtonProps {
  action: () => Promise<void>;
  message: string;
  className?: string;
  title?: string;
  children: ReactNode;
}

export function ConfirmDeleteButton({
  action,
  message,
  className,
  title,
  children,
}: ConfirmDeleteButtonProps) {
  return (
    <form action={action}>
      <button
        type="submit"
        className={className}
        title={title}
        onClick={(e) => {
          if (!confirm(message)) {
            e.preventDefault();
          }
        }}
      >
        {children}
      </button>
    </form>
  );
}
