"use client";

import { deleteGroup } from "@/app/actions";

export function DeleteGroupButton({ groupId }: { groupId: string }) {
  const action = deleteGroup.bind(null, groupId);
  return (
    <form action={action}>
      <button
        type="submit"
        className="text-xs text-slate-400 hover:text-red-500 transition-colors"
        onClick={(e) => {
          if (!confirm("Delete this group and all its expenses? This cannot be undone.")) {
            e.preventDefault();
          }
        }}
      >
        Delete group
      </button>
    </form>
  );
}
