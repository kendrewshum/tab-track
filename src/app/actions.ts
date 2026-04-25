"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db";
import {
  expenseSplits,
  expenses,
  groups,
  members,
  settlements,
} from "@/db/schema";
import { generateId } from "@/lib/utils";

// ─── Groups ──────────────────────────────────────────────────────────────────

export async function createGroup(formData: FormData) {
  const name = (formData.get("name") as string).trim();
  const memberNames = (formData.getAll("members") as string[])
    .map((n) => n.trim())
    .filter(Boolean);

  if (!name || memberNames.length < 2) return;

  const groupId = generateId();
  await db.insert(groups).values({ id: groupId, name });
  await db.insert(members).values(
    memberNames.map((n) => ({ id: generateId(), groupId, name: n }))
  );

  redirect(`/groups/${groupId}`);
}

export async function deleteGroup(groupId: string) {
  await db.delete(groups).where(eq(groups.id, groupId));
  revalidatePath("/");
  redirect("/");
}

// ─── Members ─────────────────────────────────────────────────────────────────

export async function addMember(groupId: string, formData: FormData) {
  const name = (formData.get("name") as string).trim();
  if (!name) return;

  await db.insert(members).values({ id: generateId(), groupId, name });
  revalidatePath(`/groups/${groupId}`);
}

// ─── Expenses ────────────────────────────────────────────────────────────────

type SplitEntry = { memberId: string; amount: number };

function computeSplits(
  splitType: string,
  amount: number,
  participantIds: string[],
  formData: FormData
): SplitEntry[] {
  const count = participantIds.length;

  if (splitType === "equal") {
    const base = Math.round((amount / count) * 100) / 100;
    let remaining = amount;
    return participantIds.map((id, i) => {
      const a = i === count - 1 ? Math.round(remaining * 100) / 100 : base;
      remaining -= base;
      return { memberId: id, amount: a };
    });
  }

  if (splitType === "shares") {
    const shareNums = participantIds.map(
      (id) => parseFloat(formData.get(`share_${id}`) as string) || 0
    );
    const totalShares = shareNums.reduce((s, n) => s + n, 0);
    if (totalShares === 0) return [];
    let remaining = amount;
    return participantIds.map((id, i) => {
      const a =
        i === count - 1
          ? Math.round(remaining * 100) / 100
          : Math.round((amount * shareNums[i]) / totalShares * 100) / 100;
      remaining -= i === count - 1 ? 0 : a;
      return { memberId: id, amount: a };
    });
  }

  if (splitType === "percentage") {
    let remaining = amount;
    return participantIds.map((id, i) => {
      const pct = parseFloat(formData.get(`pct_${id}`) as string) || 0;
      const a =
        i === count - 1
          ? Math.round(remaining * 100) / 100
          : Math.round((amount * pct) / 100 * 100) / 100;
      remaining -= i === count - 1 ? 0 : a;
      return { memberId: id, amount: a };
    });
  }

  // exact
  return participantIds.map((id) => ({
    memberId: id,
    amount: parseFloat(formData.get(`exact_${id}`) as string) || 0,
  }));
}

export async function createExpense(groupId: string, formData: FormData) {
  const description = (formData.get("description") as string).trim();
  const amount = parseFloat(formData.get("amount") as string);
  const paidById = formData.get("paidById") as string;
  const splitType = formData.get("splitType") as string;
  const date = formData.get("date") as string;
  const participantIds = formData.getAll("participants") as string[];

  if (
    !description ||
    isNaN(amount) ||
    amount <= 0 ||
    !paidById ||
    !date ||
    participantIds.length === 0
  )
    return;

  const splits = computeSplits(splitType, amount, participantIds, formData);
  if (splits.length === 0) return;

  const expenseId = generateId();
  await db.insert(expenses).values({
    id: expenseId,
    groupId,
    description,
    amount: Math.round(amount * 100) / 100,
    paidById,
    splitType: splitType as "equal" | "shares" | "percentage" | "exact",
    date,
  });

  await db.insert(expenseSplits).values(
    splits.map((s) => ({ id: generateId(), expenseId, ...s }))
  );

  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}`);
}

export async function deleteExpense(groupId: string, expenseId: string) {
  await db.delete(expenses).where(eq(expenses.id, expenseId));
  revalidatePath(`/groups/${groupId}`);
}

// ─── Settlements ─────────────────────────────────────────────────────────────

export async function createSettlement(groupId: string, formData: FormData) {
  const paidById = formData.get("paidById") as string;
  const paidToId = formData.get("paidToId") as string;
  const amount = parseFloat(formData.get("amount") as string);
  const note = (formData.get("note") as string)?.trim() || null;
  const date = formData.get("date") as string;

  if (!paidById || !paidToId || paidById === paidToId || isNaN(amount) || amount <= 0 || !date)
    return;

  await db.insert(settlements).values({
    id: generateId(),
    groupId,
    paidById,
    paidToId,
    amount: Math.round(amount * 100) / 100,
    note,
    date,
  });

  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}/settle`);
}

export async function deleteSettlement(groupId: string, settlementId: string) {
  await db.delete(settlements).where(eq(settlements.id, settlementId));
  revalidatePath(`/groups/${groupId}`);
}
