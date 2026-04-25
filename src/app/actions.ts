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
import { computeSplits, type SplitInputs, type SplitType } from "@/lib/splits";
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

export async function createExpense(groupId: string, formData: FormData) {
  const description = (formData.get("description") as string).trim();
  const amount = parseFloat(formData.get("amount") as string);
  const paidById = formData.get("paidById") as string;
  const splitType = formData.get("splitType") as SplitType;
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

  // Extract per-participant values from FormData into a plain object so the
  // pure computeSplits function doesn't depend on browser APIs.
  const inputs: SplitInputs = {
    shares: Object.fromEntries(
      participantIds.map((id) => [id, parseFloat(formData.get(`share_${id}`) as string) || 0])
    ),
    percentages: Object.fromEntries(
      participantIds.map((id) => [id, parseFloat(formData.get(`pct_${id}`) as string) || 0])
    ),
    exact: Object.fromEntries(
      participantIds.map((id) => [id, parseFloat(formData.get(`exact_${id}`) as string) || 0])
    ),
  };

  const splits = computeSplits(splitType, Math.round(amount * 100) / 100, participantIds, inputs, paidById);
  if (splits.length === 0) return;

  const expenseId = generateId();
  await db.insert(expenses).values({
    id: expenseId,
    groupId,
    description,
    amount: Math.round(amount * 100) / 100,
    paidById,
    splitType,
    date,
  });

  await db.insert(expenseSplits).values(
    splits.map((s) => ({ id: generateId(), expenseId, ...s }))
  );

  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}`);
}

export async function updateExpense(groupId: string, expenseId: string, formData: FormData) {
  const description = (formData.get("description") as string).trim();
  const amount = parseFloat(formData.get("amount") as string);
  const paidById = formData.get("paidById") as string;
  const splitType = formData.get("splitType") as SplitType;
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

  const inputs: SplitInputs = {
    shares: Object.fromEntries(
      participantIds.map((id) => [id, parseFloat(formData.get(`share_${id}`) as string) || 0])
    ),
    percentages: Object.fromEntries(
      participantIds.map((id) => [id, parseFloat(formData.get(`pct_${id}`) as string) || 0])
    ),
    exact: Object.fromEntries(
      participantIds.map((id) => [id, parseFloat(formData.get(`exact_${id}`) as string) || 0])
    ),
  };

  const splits = computeSplits(splitType, Math.round(amount * 100) / 100, participantIds, inputs, paidById);
  if (splits.length === 0) return;

  await db.update(expenses).set({
    description,
    amount: Math.round(amount * 100) / 100,
    paidById,
    splitType,
    date,
  }).where(eq(expenses.id, expenseId));

  await db.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));

  await db.insert(expenseSplits).values(
    splits.map((s) => ({ id: generateId(), expenseId, ...s }))
  );

  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}`);
}

export async function deleteExpense(groupId: string, expenseId: string) {
  await db.delete(expenses).where(eq(expenses.id, expenseId));
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}`);
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
  revalidatePath(`/groups/${groupId}/settle`);
  redirect(`/groups/${groupId}/settle`);
}
