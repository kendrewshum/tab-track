import Link from "next/link";
import { requireUser } from "@/lib/server/session";
import { NewGroupForm } from "./new-group-form";

export default async function NewGroupPage() {
  await requireUser();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-green-600 hover:text-green-700">
          ← Groups
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">New Group</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Add at least 2 members to get started
        </p>
      </div>
      <NewGroupForm />
    </div>
  );
}
