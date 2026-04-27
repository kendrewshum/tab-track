"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { createGroup } from "@/app/actions";

export function NewGroupForm() {
  const [memberInputs, setMemberInputs] = useState(["", ""]);
  const [submissionToken] = useState(() => crypto.randomUUID());

  const addMember = () => setMemberInputs((p) => [...p, ""]);
  const removeMember = (i: number) =>
    setMemberInputs((p) => p.filter((_, idx) => idx !== i));
  const updateMember = (i: number, val: string) =>
    setMemberInputs((p) => p.map((v, idx) => (idx === i ? val : v)));

  return (
    <form action={createGroup} className="space-y-5">
      <input type="hidden" name="_submissionToken" value={submissionToken} />
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Group Name
        </label>
        <input
          name="name"
          required
          placeholder="e.g. Tokyo Trip, Apartment"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Members</label>
        <div className="space-y-2">
          {memberInputs.map((val, i) => (
            <div key={i} className="flex gap-2">
              <input
                name="members"
                value={val}
                onChange={(e) => updateMember(i, e.target.value)}
                placeholder={`Member ${i + 1}`}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
              {memberInputs.length > 2 ? (
                <button
                  type="button"
                  onClick={() => removeMember(i)}
                  className="p-2.5 text-slate-400 hover:text-red-500 border border-slate-300 rounded-lg hover:border-red-300 transition-colors"
                >
                  <X size={16} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addMember}
          className="mt-2 flex items-center gap-1.5 text-sm text-green-600 font-medium hover:text-green-700"
        >
          <Plus size={15} />
          Add another member
        </button>
      </div>

      <button
        type="submit"
        className="w-full bg-green-600 text-white py-3 rounded-xl font-semibold hover:bg-green-700 transition-colors"
      >
        Create Group
      </button>
    </form>
  );
}
