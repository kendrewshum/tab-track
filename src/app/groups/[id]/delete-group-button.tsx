"use client";

import { deleteGroup } from "@/app/actions";
import { ConfirmDeleteButton } from "./confirm-delete-button";

export function DeleteGroupButton({ groupId }: { groupId: string }) {
  const action = deleteGroup.bind(null, groupId);

  return (
    <ConfirmDeleteButton
      action={action}
      message="Delete this group and all its expenses? This cannot be undone."
      pendingLabel="Deleting..."
      className="text-xs text-slate-400 hover:text-red-500 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
    >
      Delete group
    </ConfirmDeleteButton>
  );
}
