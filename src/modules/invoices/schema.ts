import { sql } from "drizzle-orm"
import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  date,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"
import { projects } from "@/modules/projects/schema"
import { contacts } from "@/modules/contacts/schema"

/**
 * `payment_installments` per Build Spec §2 line 63 + Tech Arch §4 line 121.
 *
 * The payment schedule: one row per installment of a project's total.
 *
 * Money discipline (canonical — see `src/lib/recompute/README.md` and
 * `src/lib/recompute/cents.ts` header docblock):
 *   - amountCents is INTEGER CENTS. Never float, never numeric.
 *   - The rounding rule applies uniformly across split methods: when the
 *     total doesn't divide evenly across N installments, the FIRST
 *     `(total mod N)` installments each receive +1 cent; remaining
 *     installments (including the LAST) take the floor. The LAST is the
 *     smaller value. Plain-English client answer is in the recompute README.
 *
 * Override-protection invariant (silent-corruption mode B):
 *   - `amountOverridden` and `dueDateOverridden` are set to true when a
 *     user hand-edits the corresponding column. The recompute pass
 *     respects these flags via `respectOverride()` — overridden rows are
 *     NOT touched, including no bump to `updated_at`.
 *
 * Financial RLS gate:
 *   - Per Tech Arch §4 "Financial tables… additional policy requiring
 *     current_setting('app.current_role') ∈ money-permitted set."
 *   - V1 gate: owner / admin / accountant. Manager-with-grant deferred
 *     to the Phase 4 admin UI (per `rbac/README.md` + the locked decision
 *     in commit 14a planning). The standard team-member tier (role
 *     `user`) and `client` are blocked at the gate: ZERO rows on
 *     SELECT, INSERT/UPDATE/DELETE rejected.
 *
 * Display discipline:
 *   - amountCents NEVER appears as a raw integer in any UI / email / PDF
 *     / CSV (rule D1 in `docs/PIVOTS_LEDGER.md`). Phase 4 list-view and
 *     invoice templates MUST format via `formatCents()`.
 *
 * No FK on `invoice_id` in V1 — the `invoices` table is Stripe-blocked
 * (see `src/modules/invoices/README.md`). When invoices ships, a
 * follow-up migration adds the FK ON DELETE SET NULL.
 */
export const paymentInstallments = pgTable(
  "payment_installments",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sequenceNo: integer("sequence_no").notNull(),

    // The split method that produced this installment. The orchestrator
    // reads installments[0].splitMethod to decide how to redistribute on
    // recompute; all installments in one project share the same method.
    splitMethod: text("split_method").notNull(),

    // Per-installment parameters. Shape varies by splitMethod:
    //   pay_in_full   → null
    //   even_by_count → { count: N }
    //   percentage    → { bps: 5000 }   (basis points; Σ bps across installments = 10000)
    //   fraction      → { weight: 1 }   (integer weight; recompute normalizes)
    //   manual        → null
    splitParam: jsonb("split_param").$type<Record<string, unknown> | null>(),

    amountCents: integer("amount_cents").notNull(),
    amountOverridden: boolean("amount_overridden").notNull().default(false),

    dueDate: date("due_date"),
    // Shape: { days_before_event: N } | { days_after_event: N } | { fixed: "YYYY-MM-DD" } | null
    dueDateRule: jsonb("due_date_rule").$type<Record<string, unknown> | null>(),
    dueDateOverridden: boolean("due_date_overridden").notNull().default(false),

    billingContactId: text("billing_contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("scheduled"),
    // No FK on invoice_id — invoices table not in this commit (Stripe-blocked).
    invoiceId: text("invoice_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    // Display order: one project's installments, in sequence.
    uniqueIndex("payment_installments_project_seq_uidx")
      .on(t.projectId, t.sequenceNo)
      .where(sql`${t.deletedAt} IS NULL`),
    index("payment_installments_org_project_deleted_idx").on(
      t.organizationId,
      t.projectId,
      t.deletedAt,
    ),
    index("payment_installments_org_due_date_idx").on(t.organizationId, t.dueDate, t.deletedAt),
    index("payment_installments_org_status_idx").on(t.organizationId, t.status, t.deletedAt),
  ],
)

export type PaymentInstallment = typeof paymentInstallments.$inferSelect
export type NewPaymentInstallment = typeof paymentInstallments.$inferInsert
