"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { cn } from "@/lib/utils";

type PendingSubmitButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  children: ReactNode;
  pendingLabel: ReactNode;
};

export function PendingSubmitButton({
  children,
  pendingLabel,
  className,
  disabled,
  type = "submit",
  ...props
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  return (
    <button
      {...props}
      type={type}
      disabled={isDisabled}
      className={cn("disabled:cursor-not-allowed disabled:opacity-70", className)}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
