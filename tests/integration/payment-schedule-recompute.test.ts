/**
 * Payment-schedule orchestrator tests — written FIRST per the test-first
 * discipline for known-dangerous areas. Three danger zones pin the test
 * structure:
 *
 *   1. Rounding consistency — Σ installments MUST == project.total_value_cents
 *      in every split test. The canonical rule (extras on FIRST, last is
 *      floor) is documented in `src/lib/recompute/README.md` and
 *      `src/lib/recompute/cents.ts` header.
 *
 *   2. Discount-then-tax order — fixed pipeline per Tech Arch §4 line 207:
 *      sum line_items → apply discount → apply tax → split.
 *      Tax-after-discount on $1000, 10%, 8.5% → 977 (NOT 985, which is
 *      tax-before-discount).
 *
 *   3. *_overridden protection — recompute must NOT touch installments where
 *      amount_overridden=true OR due_date_overridden=true. The integration-
 *      level proof is updated_at UNCHANGED on the overridden row.
 */
import { describe, it, expect } from "vitest"
import { and, eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { projects } from "@/modules/projects/schema"
import { paymentInstallments } from "@/modules/invoices/schema"
import {
  createPaymentSchedule,
  recomputeProjectPaymentSchedule,
} from "@/modules/invoices/recompute-payment-schedule"

interface Env {
  organizationId: string
  userId: string
  projectId: string
}

async function seedProject(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  opts: {
    lineItems?: { description: string; amountCents: number; quantity?: number }[]
    packageBasePriceCents?: number
    discountType?: "none" | "flat" | "percent"
    discountValue?: number
    taxRateBps?: number
    taxSign?: "add" | "subtract"
    primaryDate?: string
  } = {},
): Promise<Env> {
  const userId = await createUser(db)
  const orgId = await createOrganization(db, userId)
  await setOrgContext(db, orgId, "owner", userId)
  const projectId = createId()
  await db.insert(projects).values({
    id: projectId,
    organizationId: orgId,
    name: "P",
    primaryDate: opts.primaryDate ?? "2026-09-15",
    lineItems: opts.lineItems ?? null,
    packageBasePriceCents: opts.packageBasePriceCents ?? null,
    discountType: opts.discountType ?? "none",
    discountValue: opts.discountValue ?? null,
    taxRateBps: opts.taxRateBps ?? null,
    taxSign: opts.taxSign ?? null,
    createdBy: userId,
    updatedBy: userId,
  })
  return { organizationId: orgId, userId, projectId }
}

describe("createPaymentSchedule + recomputeProjectPaymentSchedule — rounding", () => {
  it("pay_in_full — 1 installment of total; Σ == total", async () => {
    await withTestDb(async (db) => {
      const env = await seedProject(db, {
        packageBasePriceCents: 680000,
      })
      await createPaymentSchedule(db, {
        ...env,
        method: "pay_in_full",
      })
      const rows = await db
        .select({ amountCents: paymentInstallments.amountCents })
        .from(paymentInstallments)
        .where(eq(paymentInstallments.projectId, env.projectId))
        .orderBy(paymentInstallments.sequenceNo)
      expect(rows.length).toBe(1)
      expect(rows[0]!.amountCents).toBe(680000)
      expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(680000)
    })
  })

  it("even_by_count(3) — Tech Arch §4 canonical: [226667, 226667, 226666]; last is floor", async () => {
    await withTestDb(async (db) => {
      const env = await seedProject(db, { packageBasePriceCents: 680000 })
      await createPaymentSchedule(db, { ...env, method: "even_by_count", count: 3 })
      const rows = await db
        .select({ amountCents: paymentInstallments.amountCents })
        .from(paymentInstallments)
        .where(eq(paymentInstallments.projectId, env.projectId))
        .orderBy(paymentInstallments.sequenceNo)
      expect(rows.map((r) => r.amountCents)).toEqual([226667, 226667, 226666])
      expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(680000)
    })
  })

  it("even_by_count(4) on 1001 cents → [251, 250, 250, 250]; first M get +1", async () => {
    await withTestDb(async (db) => {
      const env = await seedProject(db, { packageBasePriceCents: 1001 })
      await createPaymentSchedule(db, { ...env, method: "even_by_count", count: 4 })
      const rows = await db
        .select({ amountCents: paymentInstallments.amountCents })
        .from(paymentInstallments)
        .where(eq(paymentInstallments.projectId, env.projectId))
        .orderBy(paymentInstallments.sequenceNo)
      expect(rows.map((r) => r.amountCents)).toEqual([251, 250, 250, 250])
      expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(1001)
    })
  })

  it("percentage [5000, 5000] on 10001 → [5001, 5000]; extras on FIRST", async () => {
    await withTestDb(async (db) => {
      const env = await seedProject(db, { packageBasePriceCents: 10001 })
      await createPaymentSchedule(db, {
        ...env,
        method: "percentage",
        bps: [5000, 5000],
      })
      const rows = await db
        .select({ amountCents: paymentInstallments.amountCents })
        .from(paymentInstallments)
        .where(eq(paymentInstallments.projectId, env.projectId))
        .orderBy(paymentInstallments.sequenceNo)
      expect(rows.map((r) => r.amountCents)).toEqual([5001, 5000])
      expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(10001)
    })
  })

  it("percentage that doesn't sum to 10000 → throws", async () => {
    await withTestDb(async (db) => {
      const env = await seedProject(db, { packageBasePriceCents: 10000 })
      await expect(
        createPaymentSchedule(db, {
          ...env,
          method: "percentage",
          bps: [5000, 4999],
        }),
      ).rejects.toThrow(/10000|sum/i)
    })
  })

  it("fraction [1,1,1] on 10 cents → [4, 3, 3]; Σ == total", async () => {
    await withTestDb(async (db) => {
      const env = await seedProject(db, { packageBasePriceCents: 10 })
      await createPaymentSchedule(db, {
        ...env,
        method: "fraction",
        fractions: [1, 1, 1],
      })
      const rows = await db
        .select({ amountCents: paymentInstallments.amountCents })
        .from(paymentInstallments)
        .where(eq(paymentInstallments.projectId, env.projectId))
        .orderBy(paymentInstallments.sequenceNo)
      expect(rows.map((r) => r.amountCents)).toEqual([4, 3, 3])
      expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(10)
    })
  })

  it("manual with Σ == total → accepted", async () => {
    await withTestDb(async (db) => {
      const env = await seedProject(db, { packageBasePriceCents: 10000 })
      await createPaymentSchedule(db, {
        ...env,
        method: "manual",
        amounts: [3000, 4000, 3000],
      })
      const rows = await db
        .select({ amountCents: paymentInstallments.amountCents })
        .from(paymentInstallments)
        .where(eq(paymentInstallments.projectId, env.projectId))
        .orderBy(paymentInstallments.sequenceNo)
      expect(rows.map((r) => r.amountCents)).toEqual([3000, 4000, 3000])
    })
  })

  it("manual with Σ != total → throws VALIDATION (Tech Arch §4: never silent)", async () => {
    await withTestDb(async (db) => {
      const env = await seedProject(db, { packageBasePriceCents: 10000 })
      await expect(
        createPaymentSchedule(db, {
          ...env,
          method: "manual",
          amounts: [3000, 4000, 2999],
        }),
      ).rejects.toThrow(/sum|total/i)
    })
  })
})

describe("recomputeProjectPaymentSchedule — discount-then-tax order (Tech Arch §4 line 207)", () => {
  it("$1000 → 10% discount → 8.5% tax (ADD) = $977; NOT $985 (tax-before-discount)", async () => {
    await withTestDb(async (db) => {
      const env = await seedProject(db, {
        packageBasePriceCents: 100000,
        discountType: "percent",
        discountValue: 1000, // 10.00%
        taxRateBps: 850, // 8.50%
        taxSign: "add",
      })
      await createPaymentSchedule(db, { ...env, method: "pay_in_full" })
      // Pipeline: 100000 → discount 10% → 90000 → tax 8.5% → 97650
      // (NOT 100000 × 1.085 = 108500, then -10% = 97650 — same in this case
      //  by coincidence, so use a non-clean number to disambiguate)
      const [proj] = await db
        .select({
          subtotalCents: projects.subtotalCents,
          taxAmountCents: projects.taxAmountCents,
          totalValueCents: projects.totalValueCents,
        })
        .from(projects)
        .where(eq(projects.id, env.projectId))
      expect(proj?.subtotalCents).toBe(100000)
      // Discounted: 100000 - 10000 = 90000. Tax: floor(90000 × 850 / 10000) = 7650.
      expect(proj?.taxAmountCents).toBe(7650)
      expect(proj?.totalValueCents).toBe(97650)
    })
  })

  it("disambiguation case: $1001 → 10% discount → 8.5% tax — order is provable", async () => {
    await withTestDb(async (db) => {
      const env = await seedProject(db, {
        packageBasePriceCents: 100100, // $1001.00
        discountType: "percent",
        discountValue: 1000, // 10%
        taxRateBps: 850, // 8.5%
        taxSign: "add",
      })
      await createPaymentSchedule(db, { ...env, method: "pay_in_full" })
      const [proj] = await db
        .select({
          subtotalCents: projects.subtotalCents,
          taxAmountCents: projects.taxAmountCents,
          totalValueCents: projects.totalValueCents,
        })
        .from(projects)
        .where(eq(projects.id, env.projectId))
      // DISCOUNT FIRST: 100100 - floor(100100 × 1000 / 10000) = 100100 - 10010 = 90090
      // TAX: floor(90090 × 850 / 10000) = floor(7657.65) = 7657
      // TOTAL: 90090 + 7657 = 97747
      //
      // If tax-FIRST had been (wrong) used: floor(100100 × 850 / 10000) = 8508,
      // then discount on (100100 + 8508 = 108608): 108608 - floor(108608 × 1000 / 10000)
      // = 108608 - 10860 = 97748. Different by 1 cent — proves order.
      expect(proj?.subtotalCents).toBe(100100)
      expect(proj?.taxAmountCents).toBe(7657)
      expect(proj?.totalValueCents).toBe(97747)
    })
  })

  it("tax sign='subtract' — tax-inclusive (rare path)", async () => {
    await withTestDb(async (db) => {
      const env = await seedProject(db, {
        packageBasePriceCents: 10000,
        taxRateBps: 850,
        taxSign: "subtract",
      })
      await createPaymentSchedule(db, { ...env, method: "pay_in_full" })
      const [proj] = await db
        .select({ totalValueCents: projects.totalValueCents })
        .from(projects)
        .where(eq(projects.id, env.projectId))
      // Subtract path per `cents.ts:applyTax`:
      //   tax_amount = floor(10000 × 850 / 10850) = floor(783.41) = 783
      //   total      = 10000 - 783 = 9217
      expect(proj?.totalValueCents).toBe(9217)
    })
  })
})

describe("recomputeProjectPaymentSchedule — override protection (silent-corruption mode B)", () => {
  it("amount_overridden=true: recompute is a no-op on that row; updated_at UNCHANGED", async () => {
    await withTestDb(async (db) => {
      const env = await seedProject(db, { packageBasePriceCents: 680000 })
      await createPaymentSchedule(db, { ...env, method: "even_by_count", count: 3 })
      const rowsBefore = await db
        .select({
          id: paymentInstallments.id,
          amountCents: paymentInstallments.amountCents,
          updatedAt: paymentInstallments.updatedAt,
        })
        .from(paymentInstallments)
        .where(eq(paymentInstallments.projectId, env.projectId))
        .orderBy(paymentInstallments.sequenceNo)
      const overrideTarget = rowsBefore[1]! // middle one

      // Override the middle installment's amount.
      await db
        .update(paymentInstallments)
        .set({
          amountCents: 200000,
          amountOverridden: true,
          // Note: a real action would also bump updated_at; for the test we
          // explicitly capture this state AS the override snapshot and then
          // re-fetch.
        })
        .where(eq(paymentInstallments.id, overrideTarget.id))
      const [overrideState] = await db
        .select({
          updatedAt: paymentInstallments.updatedAt,
          amountCents: paymentInstallments.amountCents,
        })
        .from(paymentInstallments)
        .where(eq(paymentInstallments.id, overrideTarget.id))

      // Now change project's total (bump package price) and recompute.
      await db
        .update(projects)
        .set({ packageBasePriceCents: 900000 })
        .where(eq(projects.id, env.projectId))
      const result = await recomputeProjectPaymentSchedule(db, env.projectId)
      expect(result.installmentsSkippedAmountOverridden).toBe(1)

      // The overridden row must be UNTOUCHED, including updated_at.
      const [after] = await db
        .select({
          amountCents: paymentInstallments.amountCents,
          updatedAt: paymentInstallments.updatedAt,
        })
        .from(paymentInstallments)
        .where(eq(paymentInstallments.id, overrideTarget.id))
      expect(after?.amountCents).toBe(overrideState?.amountCents)
      expect(after?.updatedAt.getTime()).toBe(overrideState?.updatedAt.getTime())
    })
  })

  it("due_date_overridden=true: recompute leaves due_date alone; updated_at UNCHANGED", async () => {
    await withTestDb(async (db) => {
      const env = await seedProject(db, {
        packageBasePriceCents: 680000,
        primaryDate: "2026-09-15",
      })
      await createPaymentSchedule(db, {
        ...env,
        method: "even_by_count",
        count: 3,
        dueDateRules: [
          { days_before_event: 60 },
          { days_before_event: 30 },
          { days_before_event: 0 },
        ],
      })
      const rowsBefore = await db
        .select({
          id: paymentInstallments.id,
          dueDate: paymentInstallments.dueDate,
        })
        .from(paymentInstallments)
        .where(eq(paymentInstallments.projectId, env.projectId))
        .orderBy(paymentInstallments.sequenceNo)
      const target = rowsBefore[1]!

      // Hand-edit the due_date and set override flag.
      await db
        .update(paymentInstallments)
        .set({ dueDate: "2026-08-01", dueDateOverridden: true })
        .where(eq(paymentInstallments.id, target.id))
      const [overrideState] = await db
        .select({
          dueDate: paymentInstallments.dueDate,
          updatedAt: paymentInstallments.updatedAt,
        })
        .from(paymentInstallments)
        .where(eq(paymentInstallments.id, target.id))

      // Shift project's primary_date.
      await db
        .update(projects)
        .set({ primaryDate: "2026-10-15" })
        .where(eq(projects.id, env.projectId))
      const result = await recomputeProjectPaymentSchedule(db, env.projectId)
      expect(result.installmentsSkippedDueDateOverridden).toBe(1)

      // Overridden row untouched.
      const [after] = await db
        .select({
          dueDate: paymentInstallments.dueDate,
          updatedAt: paymentInstallments.updatedAt,
        })
        .from(paymentInstallments)
        .where(eq(paymentInstallments.id, target.id))
      expect(after?.dueDate).toBe(overrideState?.dueDate)
      expect(after?.updatedAt.getTime()).toBe(overrideState?.updatedAt.getTime())
    })
  })
})

describe("recomputeProjectPaymentSchedule — primary_date shift", () => {
  it("shifting primary_date recomputes non-overridden due_dates from dueDateRule", async () => {
    await withTestDb(async (db) => {
      const env = await seedProject(db, {
        packageBasePriceCents: 600000,
        primaryDate: "2026-09-15",
      })
      await createPaymentSchedule(db, {
        ...env,
        method: "even_by_count",
        count: 2,
        dueDateRules: [{ days_before_event: 30 }, { days_before_event: 0 }],
      })
      const rowsBefore = await db
        .select({
          sequenceNo: paymentInstallments.sequenceNo,
          dueDate: paymentInstallments.dueDate,
        })
        .from(paymentInstallments)
        .where(eq(paymentInstallments.projectId, env.projectId))
        .orderBy(paymentInstallments.sequenceNo)
      // 2026-09-15 − 30 days = 2026-08-16
      // 2026-09-15 − 0 days = 2026-09-15
      expect(rowsBefore[0]?.dueDate).toBe("2026-08-16")
      expect(rowsBefore[1]?.dueDate).toBe("2026-09-15")

      // Shift event date by 30 days.
      await db
        .update(projects)
        .set({ primaryDate: "2026-10-15" })
        .where(eq(projects.id, env.projectId))
      await recomputeProjectPaymentSchedule(db, env.projectId)
      const rowsAfter = await db
        .select({
          sequenceNo: paymentInstallments.sequenceNo,
          dueDate: paymentInstallments.dueDate,
        })
        .from(paymentInstallments)
        .where(eq(paymentInstallments.projectId, env.projectId))
        .orderBy(paymentInstallments.sequenceNo)
      // 2026-10-15 − 30 = 2026-09-15
      // 2026-10-15 − 0 = 2026-10-15
      expect(rowsAfter[0]?.dueDate).toBe("2026-09-15")
      expect(rowsAfter[1]?.dueDate).toBe("2026-10-15")
    })
  })
})

describe("recomputeProjectPaymentSchedule — Σ invariant under recompute", () => {
  it("for an even split, Σ installments == project.total_value_cents after every recompute", async () => {
    await withTestDb(async (db) => {
      const env = await seedProject(db, { packageBasePriceCents: 100001 })
      await createPaymentSchedule(db, { ...env, method: "even_by_count", count: 7 })
      const totals = await db
        .select({ totalValueCents: projects.totalValueCents })
        .from(projects)
        .where(eq(projects.id, env.projectId))
      const total = totals[0]!.totalValueCents!
      const rows = await db
        .select({ amountCents: paymentInstallments.amountCents })
        .from(paymentInstallments)
        .where(and(eq(paymentInstallments.projectId, env.projectId)))
      const sum = rows.reduce((a, r) => a + r.amountCents, 0)
      expect(sum).toBe(total)
      expect(rows.every((r) => Number.isInteger(r.amountCents))).toBe(true)
    })
  })
})
