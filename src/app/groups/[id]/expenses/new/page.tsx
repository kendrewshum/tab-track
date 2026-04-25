import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

import { db } from "@/db";
import { groups, members } from "@/db/schema";
import { ExpenseForm } from "./expense-form";

export default async function NewExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const group = await db.query.groups.findFirst({ where: eq(groups.id, id) });
  if (!group) notFound();

  const groupMembers = await db.select().from(members).where(eq(members.groupId, id));
  if (groupMembers.length === 0) notFound();

  return (
    <div className="space-y-6">
      <div>
        <a href={`/groups/${id}`} className="text-sm text-green-600 hover:text-green-700">
          ← {group.name}
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Add Expense</h1>
      </div>
      <ExpenseForm groupId={id} members={groupMembers} />
    </div>
  );
}
