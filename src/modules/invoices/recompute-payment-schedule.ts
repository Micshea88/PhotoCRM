import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import type * as schema from "@/db/schema"
import {
  applyDiscount,
  applyTax,
  distributeIntegerCents,
  splitByPercentages,
  splitByFractions,
  validateManualSplit,
  type DiscountType,
  type TaxSign,
} from "@/lib/recompute/cents"
import { addDays } from "@/lib/recompute/dates"
import { projects } from "@/modules/projects/schema"
import { paymentInstallments } from "./schema"

/**
 * Payment-schedule orchestrator. Per Tech Arch §4: the recompute helper
 * shared with the task-plan instantiation engine. The PRIMITIVES are
 * shared (`src/lib/recompute/cents.ts` + `dates.ts` + `override.ts`);
 * the ORCHESTRATION is separate (this file vs.
 * `src/modules/projects/instantiation.ts`). The locked decision is
 * documented in `src/lib/recompute/README.md` §"Why primitives shared,
 * orchestration NOT shared."
 *
 * MONEY PIPELINE — order is mandatory per Tech Arch §4 line 207:
 *
 *   subtotal_cents  = Σ line_items[i].amountCents × quantity
 *                     (falls back to packageBasePriceCents when no line items)
 *   net_cents       = applyDiscount(subtotal_cents, discountType, discountValue)
 *   total_cents     = applyTax(net_cents, taxRateBps, taxSign)
 *   installments[*] = (per splitMethod) on total_cents
 *
 * The order is mandatory because tax-before-discount and tax-after-discount
 * produce different totals. See test #9 in
 * `tests/integration/payment-schedule-recompute.test.ts`.
 *
 * ROUNDING RULE — canonical, applies uniformly:
 *
 *   First `(total mod N)` items receive +1 cent; LAST items take floor.
 *   See `src/lib/recompute/cents.ts` header docblock for the canonical
 *   statement + plain-English client answer.
 *
 * OVERRIDE PROTECTION — silent-corruption mode B:
 *
 *   `amount_overridden=true` → that row's amount is NEVER recomputed.
 *   `due_date_overridden=true` → that row's due_date is NEVER recomputed.
 *   If neither is overridden, the row is updated; if both, the row is
 *   skipped entirely (no UPDATE issued, no updated_at bump).
 *
 *   The integration test in payment-schedule-recompute.test.ts asserts
 *   updated_at is UNCHANGED on overridden rows — the proof.
 */

type DbHandle = NodePgDatabase<typeof schema>

export const SPLIT_METHODS = [
  "pay_in_full",
  "even_by_count",
  "percentage",
  "fraction",
  "manual",
] as const
export type SplitMethod = (typeof SPLIT_METHODS)[number]

interface LineItem {
  amountCents: number
  quantity?: number
}

function isLineItem(x: unknown): x is LineItem {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as { amountCents?: unknown }).amountCents === "number"
  )
}

interface ProjectMoneyInputs {
  lineItems: unknown[] | null
  packageBasePriceCents: number | null
  discountType: string | null
  discountValue: number | null
  taxRateBps: number | null
  taxSign: string | null
}

export interface ProjectMoneyOutputs {
  subtotalCents: number
  taxAmountCents: number
  totalCents: number
}

/**
 * Pure money pipeline. Reads `lineItems` (or falls back to
 * `packageBasePriceCents`), applies discount, applies tax. Returns
 * the three computed values; caller persists them.
 */
export function computeProjectMoney(project: ProjectMoneyInputs): ProjectMoneyOutputs {
  let subtotalCents = 0
  if (Array.isArray(project.lineItems) && project.lineItems.length > 0) {
    for (const raw of project.lineItems) {
      if (!isLineItem(raw)) continue
      const qty =
        typeof raw.quantity === "number" && Number.isInteger(raw.quantity) && raw.quantity > 0
          ? raw.quantity
          : 1
      subtotalCents += raw.amountCents * qty
    }
  } else {
    subtotalCents = project.packageBasePriceCents ?? 0
  }
  const discountType: DiscountType = (project.discountType ?? "none") as DiscountType
  const netCents = applyDiscount(subtotalCents, discountType, project.discountValue ?? null)
  const taxRateBps = project.taxRateBps ?? 0
  const taxSign: TaxSign = (project.taxSign ?? "add") as TaxSign
  const totalCents = applyTax(netCents, taxRateBps, taxSign)
  const taxAmountCents = taxSign === "add" ? totalCents - netCents : netCents - totalCents
  return { subtotalCents, taxAmountCents, totalCents }
}

/**
 * Compute a single installment's `due_date` from its rule + the
 * project's primary_date. Returns null if either is missing.
 *
 * Rule shapes:
 *   { days_before_event: N } → primaryDate − N days
 *   { days_after_event:  N } → primaryDate + N days
 *   { fixed: "YYYY-MM-DD" }  → the fixed date verbatim
 *   null                     → no due_date
 */
export function computeInstallmentDueDate(
  rule: Record<string, unknown> | null,
  primaryDate: string | null,
): string | null {
  if (!rule) return null
  if (typeof rule.fixed === "string") return rule.fixed
  if (!primaryDate) return null
  if (typeof rule.days_before_event === "number") {
    return addDays(primaryDate, -rule.days_before_event)
  }
  if (typeof rule.days_after_event === "number") {
    return addDays(primaryDate, rule.days_after_event)
  }
  return null
}

export interface CreatePaymentScheduleArgs {
  organizationId: string
  userId: string
  projectId: string
  method: SplitMethod
  /** Required for even_by_count. */
  count?: number
  /** Required for percentage. Must sum to 10000 (validated by splitByPercentages). */
  bps?: number[]
  /** Required for fraction. Integer weights; recompute normalizes against their sum. */
  fractions?: number[]
  /** Required for manual. Integer cents; Σ must equal project.total_value_cents. */
  amounts?: number[]
  /** Per-installment due-date rules (parallel array). */
  dueDateRules?: (Record<string, unknown> | null)[]
  billingContactId?: string | null
}

export interface CreatePaymentScheduleResult {
  installmentsCreated: number
  totalCents: number
}

/**
 * Build a fresh payment schedule. Computes project money first
 * (persists `subtotal_cents` / `tax_amount_cents` / `total_value_cents`
 * on the project), then inserts N `payment_installments` rows.
 */
export async function createPaymentSchedule(
  db: DbHandle,
  args: CreatePaymentScheduleArgs,
): Promise<CreatePaymentScheduleResult> {
  const [project] = await db
    .select({
      id: projects.id,
      organizationId: projects.organizationId,
      primaryDate: projects.primaryDate,
      lineItems: projects.lineItems,
      packageBasePriceCents: projects.packageBasePriceCents,
      discountType: projects.discountType,
      discountValue: projects.discountValue,
      taxRateBps: projects.taxRateBps,
      taxSign: projects.taxSign,
    })
    .from(projects)
    .where(eq(projects.id, args.projectId))
    .limit(1)
  if (!project) {
    throw new Error("Project not found")
  }
  if (project.organizationId !== args.organizationId) {
    throw new Error("Project not found in this organization")
  }
  const money = computeProjectMoney(project)

  // Persist computed totals on the project.
  await db
    .update(projects)
    .set({
      subtotalCents: money.subtotalCents,
      taxAmountCents: money.taxAmountCents,
      totalValueCents: money.totalCents,
      updatedAt: new Date(),
      updatedBy: args.userId,
    })
    .where(eq(projects.id, args.projectId))

  // Compute per-installment amounts based on method.
  let amounts: number[]
  let splitParams: (Record<string, unknown> | null)[]

  switch (args.method) {
    case "pay_in_full":
      amounts = [money.totalCents]
      splitParams = [null]
      break
    case "even_by_count":
      if (!args.count || !Number.isInteger(args.count) || args.count < 1) {
        throw new Error("even_by_count requires a positive integer count")
      }
      amounts = distributeIntegerCents(money.totalCents, args.count)
      splitParams = amounts.map(() => ({ count: args.count }))
      break
    case "percentage":
      if (!args.bps) {
        throw new Error("percentage requires a bps array")
      }
      amounts = splitByPercentages(money.totalCents, args.bps)
      splitParams = args.bps.map((b) => ({ bps: b }))
      break
    case "fraction":
      if (!args.fractions) {
        throw new Error("fraction requires a fractions array")
      }
      amounts = splitByFractions(money.totalCents, args.fractions)
      splitParams = args.fractions.map((f) => ({ weight: f }))
      break
    case "manual":
      if (!args.amounts) {
        throw new Error("manual requires an amounts array")
      }
      validateManualSplit(money.totalCents, args.amounts)
      amounts = args.amounts
      splitParams = args.amounts.map(() => null)
      break
  }

  const rows = amounts.map((amountCents, idx) => ({
    id: createId(),
    organizationId: args.organizationId,
    projectId: args.projectId,
    sequenceNo: idx + 1,
    splitMethod: args.method,
    splitParam: splitParams[idx] ?? null,
    amountCents,
    amountOverridden: false,
    dueDate: computeInstallmentDueDate(args.dueDateRules?.[idx] ?? null, project.primaryDate),
    dueDateRule: args.dueDateRules?.[idx] ?? null,
    dueDateOverridden: false,
    status: "scheduled",
    billingContactId: args.billingContactId ?? null,
    createdBy: args.userId,
    updatedBy: args.userId,
  }))
  await db.insert(paymentInstallments).values(rows)

  return { installmentsCreated: rows.length, totalCents: money.totalCents }
}

export interface RecomputeProjectPaymentScheduleResult {
  totalCents: number
  installmentsUpdated: number
  installmentsSkippedAmountOverridden: number
  installmentsSkippedDueDateOverridden: number
}

/**
 * Recompute a project's payment schedule. Called when any of the
 * trigger inputs change (line_items, package_base_price_cents,
 * discount_*, tax_*, primary_date). Persists the new
 * `subtotal_cents` / `tax_amount_cents` / `total_value_cents` on the
 * project, then redistributes amounts across non-overridden
 * installments.
 *
 * Override-respecting: rows with `amount_overridden=true` are NEVER
 * touched in the amount column; rows with `due_date_overridden=true`
 * are NEVER touched in the due_date column. If BOTH would be no-ops
 * for a row, no UPDATE is issued (the row's `updated_at` does not
 * move — the proof that override semantics hold).
 *
 * Manual method: amounts are never recomputed (manual is hand-set);
 * the orchestrator just leaves them and warns if Σ ≠ total via the
 * separate `validateManualSplit` call site that callers must run.
 */
export async function recomputeProjectPaymentSchedule(
  db: DbHandle,
  projectId: string,
): Promise<RecomputeProjectPaymentScheduleResult> {
  const empty: RecomputeProjectPaymentScheduleResult = {
    totalCents: 0,
    installmentsUpdated: 0,
    installmentsSkippedAmountOverridden: 0,
    installmentsSkippedDueDateOverridden: 0,
  }

  const [project] = await db
    .select({
      id: projects.id,
      primaryDate: projects.primaryDate,
      lineItems: projects.lineItems,
      packageBasePriceCents: projects.packageBasePriceCents,
      discountType: projects.discountType,
      discountValue: projects.discountValue,
      taxRateBps: projects.taxRateBps,
      taxSign: projects.taxSign,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!project) return empty
  const money = computeProjectMoney(project)

  await db
    .update(projects)
    .set({
      subtotalCents: money.subtotalCents,
      taxAmountCents: money.taxAmountCents,
      totalValueCents: money.totalCents,
    })
    .where(eq(projects.id, projectId))

  const installments = await db
    .select({
      id: paymentInstallments.id,
      sequenceNo: paymentInstallments.sequenceNo,
      splitMethod: paymentInstallments.splitMethod,
      splitParam: paymentInstallments.splitParam,
      amountCents: paymentInstallments.amountCents,
      amountOverridden: paymentInstallments.amountOverridden,
      dueDate: paymentInstallments.dueDate,
      dueDateRule: paymentInstallments.dueDateRule,
      dueDateOverridden: paymentInstallments.dueDateOverridden,
    })
    .from(paymentInstallments)
    .where(and(eq(paymentInstallments.projectId, projectId), isNull(paymentInstallments.deletedAt)))
    .orderBy(paymentInstallments.sequenceNo)

  const firstInst = installments[0]
  if (!firstInst) {
    return { ...empty, totalCents: money.totalCents }
  }

  const method = firstInst.splitMethod as SplitMethod
  const overriddenSum = installments
    .filter((i) => i.amountOverridden)
    .reduce((acc, i) => acc + i.amountCents, 0)
  const remainingTotal = money.totalCents - overriddenSum
  const nonOverridden = installments.filter((i) => !i.amountOverridden)

  // Compute new amounts for non-overridden installments only.
  let newAmounts: number[] = []
  if (nonOverridden.length > 0) {
    switch (method) {
      case "pay_in_full":
        newAmounts = [remainingTotal]
        break
      case "even_by_count":
        newAmounts = distributeIntegerCents(remainingTotal, nonOverridden.length)
        break
      case "percentage": {
        const bpsArr = nonOverridden.map((i) => {
          const sp = i.splitParam as { bps?: number } | null
          return typeof sp?.bps === "number" ? sp.bps : 0
        })
        const bpsSum = bpsArr.reduce((a, b) => a + b, 0)
        if (bpsSum === 0) {
          newAmounts = distributeIntegerCents(remainingTotal, nonOverridden.length)
        } else {
          // Treat the bps as weights — splitByFractions normalizes against
          // their sum so this works even when some installments are
          // overridden and the remaining bps no longer sum to 10000.
          newAmounts = splitByFractions(remainingTotal, bpsArr)
        }
        break
      }
      case "fraction": {
        const weights = nonOverridden.map((i) => {
          const sp = i.splitParam as { weight?: number } | null
          return typeof sp?.weight === "number" && sp.weight > 0 ? sp.weight : 1
        })
        newAmounts = splitByFractions(remainingTotal, weights)
        break
      }
      case "manual":
        // Manual amounts are never recomputed; preserve hand-set values.
        newAmounts = nonOverridden.map((i) => i.amountCents)
        break
    }
  }

  let installmentsUpdated = 0
  let installmentsSkippedAmountOverridden = 0
  let installmentsSkippedDueDateOverridden = 0
  let nonOverriddenIdx = 0

  for (const inst of installments) {
    const updates: Partial<typeof paymentInstallments.$inferInsert> = {}

    if (inst.amountOverridden) {
      installmentsSkippedAmountOverridden += 1
    } else {
      // newAmounts is built in lockstep with nonOverridden; safe index.
      const newAmount = newAmounts[nonOverriddenIdx] ?? inst.amountCents
      if (newAmount !== inst.amountCents) {
        updates.amountCents = newAmount
      }
      nonOverriddenIdx += 1
    }

    if (inst.dueDateOverridden) {
      installmentsSkippedDueDateOverridden += 1
    } else {
      const newDueDate = computeInstallmentDueDate(inst.dueDateRule, project.primaryDate)
      if (newDueDate !== inst.dueDate) {
        updates.dueDate = newDueDate
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date()
      await db.update(paymentInstallments).set(updates).where(eq(paymentInstallments.id, inst.id))
      installmentsUpdated += 1
    }
  }

  return {
    totalCents: money.totalCents,
    installmentsUpdated,
    installmentsSkippedAmountOverridden,
    installmentsSkippedDueDateOverridden,
  }
}
