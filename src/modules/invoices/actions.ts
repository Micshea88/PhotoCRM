"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import type * as schema from "@/db/schema"
import { paymentInstallments } from "./schema"
import {
  createPaymentSchedule as createPaymentScheduleFn,
  recomputeProjectPaymentSchedule as recomputeProjectPaymentScheduleFn,
} from "./recompute-payment-schedule"
import {
  createPaymentScheduleInput,
  deletePaymentInstallmentInput,
  recomputeProjectPaymentScheduleInput,
  updatePaymentInstallmentInput,
} from "./types"

type DbHandle = NodePgDatabase<typeof schema>

async function assertInstallmentInOrg(db: DbHandle, installmentId: string, orgId: string) {
  const [row] = await db
    .select({ id: paymentInstallments.id })
    .from(paymentInstallments)
    .where(
      and(
        eq(paymentInstallments.id, installmentId),
        eq(paymentInstallments.organizationId, orgId),
        isNull(paymentInstallments.deletedAt),
      ),
    )
    .limit(1)
  if (!row) {
    throw new ActionError("NOT_FOUND", "Payment installment not found in this organization.")
  }
}

export const createPaymentScheduleAction = orgAction
  .metadata({ actionName: "payment_installments.create_schedule" })
  .inputSchema(createPaymentScheduleInput)
  .action(async ({ parsedInput, ctx }) => {
    let result
    try {
      result = await createPaymentScheduleFn(ctx.db, {
        organizationId: ctx.activeOrg.id,
        userId: ctx.session.user.id,
        ...parsedInput,
      })
    } catch (err) {
      throw new ActionError(
        "VALIDATION",
        err instanceof Error ? err.message : "Failed to create payment schedule",
      )
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "payment_installments.schedule_created",
      {
        resourceType: "project",
        resourceId: parsedInput.projectId,
        metadata: {
          method: parsedInput.method,
          installmentsCreated: result.installmentsCreated,
          totalCents: result.totalCents,
        },
      },
    )
    revalidatePath(`/events/${parsedInput.projectId}`)
    return result
  })

export const updatePaymentInstallment = orgAction
  .metadata({ actionName: "payment_installments.update" })
  .inputSchema(updatePaymentInstallmentInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertInstallmentInOrg(ctx.db, parsedInput.id, ctx.activeOrg.id)
    const { id, ...rest } = parsedInput

    type Patch = Partial<typeof paymentInstallments.$inferInsert>
    const patch: Patch = {
      updatedAt: new Date(),
      updatedBy: ctx.session.user.id,
    }
    // Setting amountCents flips amountOverridden — the orchestrator's
    // recompute will skip this row going forward (silent-corruption
    // mode B defense per the recompute README).
    if (rest.amountCents !== undefined) {
      patch.amountCents = rest.amountCents
      patch.amountOverridden = true
    }
    if (rest.dueDate !== undefined) {
      patch.dueDate = rest.dueDate
      patch.dueDateOverridden = true
    }
    if (rest.status !== undefined) {
      patch.status = rest.status
    }
    if (rest.billingContactId !== undefined) {
      patch.billingContactId = rest.billingContactId
    }

    const result = await ctx.db
      .update(paymentInstallments)
      .set(patch)
      .where(
        and(
          eq(paymentInstallments.id, id),
          eq(paymentInstallments.organizationId, ctx.activeOrg.id),
        ),
      )
      .returning({ id: paymentInstallments.id, projectId: paymentInstallments.projectId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Payment installment not found.")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "payment_installments.updated",
      { resourceType: "payment_installment", resourceId: id, metadata: rest },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id }
  })

export const recomputeProjectPaymentScheduleAction = orgAction
  .metadata({ actionName: "payment_installments.recompute" })
  .inputSchema(recomputeProjectPaymentScheduleInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await recomputeProjectPaymentScheduleFn(ctx.db, parsedInput.projectId)
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "payment_installments.recomputed",
      {
        resourceType: "project",
        resourceId: parsedInput.projectId,
        metadata: { ...result },
      },
    )
    revalidatePath(`/events/${parsedInput.projectId}`)
    return result
  })

export const deletePaymentInstallment = orgAction
  .metadata({ actionName: "payment_installments.delete" })
  .inputSchema(deletePaymentInstallmentInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(paymentInstallments)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(paymentInstallments.id, parsedInput.id),
          eq(paymentInstallments.organizationId, ctx.activeOrg.id),
          isNull(paymentInstallments.deletedAt),
        ),
      )
      .returning({ id: paymentInstallments.id, projectId: paymentInstallments.projectId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Payment installment not found or already deleted.")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "payment_installments.deleted",
      { resourceType: "payment_installment", resourceId: parsedInput.id },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id: parsedInput.id }
  })
