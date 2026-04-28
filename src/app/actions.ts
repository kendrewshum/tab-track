"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db";
import {
  expenseRevisions,
  expenseSplits,
  expenses,
  groupAccess,
  groups,
  idempotentSubmissions,
  members,
  settlements,
} from "@/db/schema";
import { requireGroupAccess, requireUser } from "@/lib/server/session";
import { formatDate, today } from "@/lib/format";
import { createExpenseSnapshot, serializeExpenseSnapshot } from "@/lib/history";
import {
  buildCreateRedirectPath,
  readSubmissionToken,
  type CreateActionKind,
} from "@/lib/idempotency";
import { computeSplits, type SplitInputs, type SplitType } from "@/lib/splits";
import { generateId } from "@/lib/utils";

async function findIdempotentSubmission(
  userId: string,
  actionKind: CreateActionKind,
  submissionToken: string
) {
  const [submission] = await db
    .select({
      redirectPath: idempotentSubmissions.redirectPath,
    })
    .from(idempotentSubmissions)
    .where(
      and(
        eq(idempotentSubmissions.userId, userId),
        eq(idempotentSubmissions.actionKind, actionKind),
        eq(idempotentSubmissions.submissionToken, submissionToken)
      )
    )
    .limit(1);

  return submission ?? null;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Error && /unique|constraint/i.test(error.message);
}

function finishCreateAction(actionKind: CreateActionKind, redirectPath: string) {
  switch (actionKind) {
    case "createGroup":
      redirect(redirectPath);
    case "createExpense":
    case "createSettlement":
      revalidatePath(redirectPath);
      redirect(redirectPath);
    case "addMember":
      revalidatePath(redirectPath);
      return;
  }
}

async function replayExistingCreateAction(
  userId: string,
  actionKind: CreateActionKind,
  submissionToken: string
) {
  const existingSubmission = await findIdempotentSubmission(userId, actionKind, submissionToken);

  if (!existingSubmission) {
    return false;
  }

  finishCreateAction(actionKind, existingSubmission.redirectPath);
  return true;
}

// ─── Groups ──────────────────────────────────────────────────────────────────

export async function createGroup(formData: FormData) {
  const user = await requireUser();
  const name = (formData.get("name") as string).trim();
  const memberNames = (formData.getAll("members") as string[])
    .map((n) => n.trim())
    .filter(Boolean);
  const actionKind = "createGroup" as const;
  const submissionToken = readSubmissionToken(formData);

  if (!name || memberNames.length < 2) return;

  if (submissionToken && (await replayExistingCreateAction(user.id, actionKind, submissionToken))) {
    return;
  }

  const groupId = generateId();
  const redirectPath = buildCreateRedirectPath(actionKind, { groupId });

  try {
    await db.transaction(async (tx) => {
      await tx.insert(groups).values({ id: groupId, name, createdByUserId: user.id });
      await tx.insert(groupAccess).values({
        id: generateId(),
        groupId,
        userId: user.id,
        role: "owner",
      });
      await tx.insert(members).values(
        memberNames.map((memberName) => ({ id: generateId(), groupId, name: memberName }))
      );

      if (submissionToken) {
        await tx.insert(idempotentSubmissions).values({
          id: generateId(),
          userId: user.id,
          actionKind,
          submissionToken,
          redirectPath,
        });
      }
    });
  } catch (error) {
    if (
      submissionToken &&
      isUniqueConstraintError(error) &&
      (await replayExistingCreateAction(user.id, actionKind, submissionToken))
    ) {
      return;
    }

    throw error;
  }

  finishCreateAction(actionKind, redirectPath);
}

export async function deleteGroup(groupId: string) {
  await requireGroupAccess(groupId);
  await db.delete(groups).where(eq(groups.id, groupId));
  revalidatePath("/");
  redirect("/");
}

// ─── Members ─────────────────────────────────────────────────────────────────

export async function addMember(groupId: string, formData: FormData) {
  const { user } = await requireGroupAccess(groupId);
  const name = (formData.get("name") as string).trim();
  const actionKind = "addMember" as const;
  const submissionToken = readSubmissionToken(formData);
  if (!name) return;

  if (submissionToken && (await replayExistingCreateAction(user.id, actionKind, submissionToken))) {
    return;
  }

  const redirectPath = buildCreateRedirectPath(actionKind, { groupId });

  try {
    await db.transaction(async (tx) => {
      await tx.insert(members).values({ id: generateId(), groupId, name });

      if (submissionToken) {
        await tx.insert(idempotentSubmissions).values({
          id: generateId(),
          userId: user.id,
          actionKind,
          submissionToken,
          redirectPath,
        });
      }
    });
  } catch (error) {
    if (
      submissionToken &&
      isUniqueConstraintError(error) &&
      (await replayExistingCreateAction(user.id, actionKind, submissionToken))
    ) {
      return;
    }

    throw error;
  }

  finishCreateAction(actionKind, redirectPath);
}

// ─── Expenses ────────────────────────────────────────────────────────────────

export async function createExpense(groupId: string, formData: FormData) {
  const { user } = await requireGroupAccess(groupId);
  const description = (formData.get("description") as string).trim();
  const amount = parseFloat(formData.get("amount") as string);
  const paidById = formData.get("paidById") as string;
  const splitType = formData.get("splitType") as SplitType;
  const date = formData.get("date") as string;
  const participantIds = formData.getAll("participants") as string[];
  const actionKind = "createExpense" as const;
  const submissionToken = readSubmissionToken(formData);

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
  const roundedAmount = Math.round(amount * 100) / 100;
  const redirectPath = buildCreateRedirectPath(actionKind, { groupId });

  if (submissionToken && (await replayExistingCreateAction(user.id, actionKind, submissionToken))) {
    return;
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(expenses).values({
        id: expenseId,
        groupId,
        description,
        amount: roundedAmount,
        paidById,
        splitType,
        date,
      });

      await tx.insert(expenseSplits).values(
        splits.map((split) => ({ id: generateId(), expenseId, ...split }))
      );

      if (submissionToken) {
        await tx.insert(idempotentSubmissions).values({
          id: generateId(),
          userId: user.id,
          actionKind,
          submissionToken,
          redirectPath,
        });
      }
    });
  } catch (error) {
    if (
      submissionToken &&
      isUniqueConstraintError(error) &&
      (await replayExistingCreateAction(user.id, actionKind, submissionToken))
    ) {
      return;
    }

    throw error;
  }

  finishCreateAction(actionKind, redirectPath);
}

export async function updateExpense(groupId: string, expenseId: string, formData: FormData) {
  await requireGroupAccess(groupId);
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

  const [existingExpense, existingSplits] = await Promise.all([
    db.query.expenses.findFirst({
      where: and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId)),
    }),
    db.select().from(expenseSplits).where(eq(expenseSplits.expenseId, expenseId)),
  ]);
  if (!existingExpense) return;

  const roundedAmount = Math.round(amount * 100) / 100;
  const beforeSnapshot = serializeExpenseSnapshot(
    createExpenseSnapshot(existingExpense, existingSplits)
  );
  const afterSnapshot = serializeExpenseSnapshot(
    createExpenseSnapshot(
      {
        description,
        amount: roundedAmount,
        paidById,
        splitType,
        date,
      },
      splits
    )
  );

  await db.transaction(async (tx) => {
    await tx
      .update(expenses)
      .set({
        description,
        amount: roundedAmount,
        paidById,
        splitType,
        date,
      })
      .where(eq(expenses.id, expenseId));

    await tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));

    await tx.insert(expenseSplits).values(splits.map((s) => ({ id: generateId(), expenseId, ...s })));

    await tx.insert(expenseRevisions).values({
      id: generateId(),
      expenseId,
      beforeSnapshot,
      afterSnapshot,
    });
  });

  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}`);
}

export async function deleteExpense(groupId: string, expenseId: string) {
  await requireGroupAccess(groupId);
  await db.delete(expenses).where(eq(expenses.id, expenseId));
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}`);
}

// ─── Settlements ─────────────────────────────────────────────────────────────

export async function createSettlement(groupId: string, formData: FormData) {
  const { user } = await requireGroupAccess(groupId);
  const paidById = formData.get("paidById") as string;
  const paidToId = formData.get("paidToId") as string;
  const amount = parseFloat(formData.get("amount") as string);
  const note = (formData.get("note") as string)?.trim() || null;
  const date = formData.get("date") as string;
  const redirectTo = getSettleRedirectTarget(groupId, formData.get("redirectTo"));
  const actionKind = "createSettlement" as const;
  const submissionToken = readSubmissionToken(formData);

  if (!paidById || !paidToId || paidById === paidToId || isNaN(amount) || amount <= 0 || !date)
    return;

  if (submissionToken && (await replayExistingCreateAction(user.id, actionKind, submissionToken))) {
    return;
  }

  const redirectPath =
    redirectTo === `/groups/${groupId}/settle`
      ? buildCreateRedirectPath(actionKind, { groupId })
      : redirectTo;

  try {
    await db.transaction(async (tx) => {
      await tx.insert(settlements).values({
        id: generateId(),
        groupId,
        paidById,
        paidToId,
        amount: Math.round(amount * 100) / 100,
        note,
        reversalOfSettlementId: null,
        date,
      });

      if (submissionToken) {
        await tx.insert(idempotentSubmissions).values({
          id: generateId(),
          userId: user.id,
          actionKind,
          submissionToken,
          redirectPath,
        });
      }
    });
  } catch (error) {
    if (
      submissionToken &&
      isUniqueConstraintError(error) &&
      (await replayExistingCreateAction(user.id, actionKind, submissionToken))
    ) {
      return;
    }

    throw error;
  }

  finishCreateAction(actionKind, redirectPath);
}

export async function reverseSettlement(groupId: string, settlementId: string, redirectTo?: string) {
  await requireGroupAccess(groupId);
  const original = await db.query.settlements.findFirst({
    where: and(
      eq(settlements.id, settlementId),
      eq(settlements.groupId, groupId),
      isNull(settlements.reversalOfSettlementId)
    ),
  });
  if (!original) return;

  const existingReversal = await db.query.settlements.findFirst({
    where: eq(settlements.reversalOfSettlementId, settlementId),
  });
  if (existingReversal) return;

  await db.insert(settlements).values({
    id: generateId(),
    groupId,
    paidById: original.paidToId,
    paidToId: original.paidById,
    amount: original.amount,
    note: `Reversal of payment from ${formatDate(original.date)}`,
    reversalOfSettlementId: original.id,
    date: today(),
  });
  revalidatePath(`/groups/${groupId}/settle`);
  redirect(getSettleRedirectTarget(groupId, redirectTo));
}

function getSettleRedirectTarget(groupId: string, candidate: FormDataEntryValue | string | null | undefined) {
  const defaultTarget = `/groups/${groupId}/settle`;

  if (typeof candidate !== "string" || candidate.length === 0) {
    return defaultTarget;
  }

  return candidate.startsWith(`${defaultTarget}?activity=`) || candidate === defaultTarget
    ? candidate
    : defaultTarget;
}
