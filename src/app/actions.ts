"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
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
import { requireGroupAccess, requireGroupOwner, requireUser } from "@/lib/server/session";
import { formatDate, today } from "@/lib/format";
import { createExpenseSnapshot, serializeExpenseSnapshot } from "@/lib/history";
import {
  buildCreateRedirectPath,
  readSubmissionToken,
  type CreateActionKind,
} from "@/lib/idempotency";
import { parseExpenseForm, parseSettlementForm } from "@/lib/form-parsing";
import { generateId } from "@/lib/utils";
import { areGroupMemberIds } from "@/lib/group-member-ids";

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

async function getGroupMemberIdSet(groupId: string) {
  const rows = await db.select({ id: members.id }).from(members).where(eq(members.groupId, groupId));
  return new Set(rows.map((member) => member.id));
}

function areExpenseMemberReferencesValid(
  groupMemberIds: Set<string>,
  paidById: string,
  participantIds: string[]
) {
  return groupMemberIds.has(paidById) && areGroupMemberIds(groupMemberIds, participantIds);
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
  await requireGroupOwner(groupId);
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
  const parsedExpense = parseExpenseForm(formData);
  const actionKind = "createExpense" as const;
  const submissionToken = readSubmissionToken(formData);

  if (!parsedExpense.ok) return;
  const { description, amount, paidById, splitType, date, participantIds, splits } =
    parsedExpense.value;

  const groupMemberIds = await getGroupMemberIdSet(groupId);
  if (!areExpenseMemberReferencesValid(groupMemberIds, paidById, participantIds)) {
    return;
  }

  const expenseId = generateId();
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
        amount,
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
  const parsedExpense = parseExpenseForm(formData);
  if (!parsedExpense.ok) return;
  const { description, amount, paidById, splitType, date, participantIds, splits } =
    parsedExpense.value;

  const groupMemberIds = await getGroupMemberIdSet(groupId);
  if (!areExpenseMemberReferencesValid(groupMemberIds, paidById, participantIds)) {
    return;
  }

  const [existingExpense, existingSplits] = await Promise.all([
    db.query.expenses.findFirst({
      where: and(
        eq(expenses.id, expenseId),
        eq(expenses.groupId, groupId),
        isNull(expenses.deletedAt)
      ),
    }),
    db.select().from(expenseSplits).where(eq(expenseSplits.expenseId, expenseId)),
  ]);
  if (!existingExpense) return;

  const beforeSnapshot = serializeExpenseSnapshot(
    createExpenseSnapshot(existingExpense, existingSplits)
  );
  const afterSnapshot = serializeExpenseSnapshot(
    createExpenseSnapshot(
      {
        description,
        amount,
        paidById,
        splitType,
        date,
      },
      splits
    )
  );

  await db.transaction(async (tx) => {
    const updatedExpenses = await tx
      .update(expenses)
      .set({
        description,
        amount,
        paidById,
        splitType,
        date,
      })
      .where(
        and(
          eq(expenses.id, expenseId),
          eq(expenses.groupId, groupId),
          isNull(expenses.deletedAt)
        )
      )
      .returning({ id: expenses.id });

    if (updatedExpenses.length === 0) {
      return;
    }

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
  const { user } = await requireGroupAccess(groupId);
  await db
    .update(expenses)
    .set({
      deletedAt: sql`datetime('now')`,
      deletedByUserId: user.id,
    })
    .where(
      and(
        eq(expenses.id, expenseId),
        eq(expenses.groupId, groupId),
        isNull(expenses.deletedAt)
      )
    );
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}`);
}

// ─── Settlements ─────────────────────────────────────────────────────────────

export async function createSettlement(groupId: string, formData: FormData) {
  const { user } = await requireGroupAccess(groupId);
  const parsedSettlement = parseSettlementForm(formData);
  const redirectTo = getSettleRedirectTarget(groupId, formData.get("redirectTo"));
  const actionKind = "createSettlement" as const;
  const submissionToken = readSubmissionToken(formData);

  if (!parsedSettlement.ok) return;
  const { paidById, paidToId, amount, note, date } = parsedSettlement.value;

  const groupMemberIds = await getGroupMemberIdSet(groupId);
  if (!areGroupMemberIds(groupMemberIds, [paidById, paidToId])) {
    return;
  }

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
        amount,
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
