import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

import { db } from "@/db";
import { expenses, expenseSplits, groups, members } from "@/db/schema";
import { requireGroupAccess } from "@/lib/server/session";
import { ExpenseForm } from "../../new/expense-form";

export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string; expenseId: string }>;
}) {
  const { id, expenseId } = await params;
  await requireGroupAccess(id);

  const group = await db.query.groups.findFirst({ where: eq(groups.id, id) });
  if (!group) notFound();

  const [expense, splits, groupMembers] = await Promise.all([
    db.query.expenses.findFirst({
      where: and(
        eq(expenses.id, expenseId),
        eq(expenses.groupId, id),
        isNull(expenses.deletedAt)
      ),
    }),
    db.select().from(expenseSplits).where(eq(expenseSplits.expenseId, expenseId)),
    db.select().from(members).where(eq(members.groupId, id)),
  ]);

  if (!expense) notFound();

  return (
    <div className="space-y-6">
      <div>
        <a href={`/groups/${id}`} className="text-sm text-green-600 hover:text-green-700">
          ← {group.name}
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Edit Expense</h1>
      </div>
      <ExpenseForm
        groupId={id}
        members={groupMembers}
        expense={{
          id: expense.id,
          description: expense.description,
          amount: expense.amount,
          paidById: expense.paidById,
          splitType: expense.splitType as "equal" | "shares" | "percentage" | "exact",
          date: expense.date,
          splits,
        }}
      />
    </div>
  );
}
