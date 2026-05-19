# invoices module

The financial layer. V1 ships **payment-schedule recompute only** —
the `invoices` and `payments` tables and the Stripe-backed
send/pay/refund flow are deferred to the Stripe Connect unlock (per
`docs/PIVOTS_LEDGER.md` "Externally-blocked items" and
`docs/INTEGRATION_STRATEGY.md`).

## What's here

- `schema.ts` — `payment_installments` table only (Build Spec §2 line 63).
- `types.ts` — `SPLIT_METHODS` enum, `INSTALLMENT_STATUSES` enum, Zod
  input schemas for the 4 actions. `createPaymentScheduleInput` is a
  discriminated union — Zod enforces the right method-specific param
  shape at the action layer.
- `recompute-payment-schedule.ts` — the orchestrator:
  - `computeProjectMoney(project)` — pure function: subtotal →
    discount → tax → total
  - `createPaymentSchedule(db, args)` — builds the initial N
    `payment_installments` rows
  - `recomputeProjectPaymentSchedule(db, projectId)` — re-runs the
    pipeline; redistributes non-overridden installments; preserves
    `amount_overridden` / `due_date_overridden` rows untouched
- `actions.ts` — `createPaymentScheduleAction`, `updatePaymentInstallment`,
  `recomputeProjectPaymentScheduleAction`, `deletePaymentInstallment`.
  All via `orgAction`; all audit + revalidate.

## Primitives shared, orchestration NOT shared (Tech Arch §4)

This module's orchestrator consumes `src/lib/recompute/{cents,dates,override}.ts`
unchanged. It is a **separate orchestration loop** from
`src/modules/projects/instantiation.ts` (the task-plan side). The locked
decision is documented in `src/lib/recompute/README.md` §"Why primitives
shared, orchestration NOT shared." Don't try to DRY them together — a
bug in one orchestrator should not have blast-radius in the other; their
table shapes, failure modes, and audit-log strings are different.

## Money pipeline — fixed order (Tech Arch §4 line 207)

```
subtotal_cents  =  Σ line_items[*].amountCents × quantity
                   (falls back to packageBasePriceCents when no line items)
net_cents       =  applyDiscount(subtotal_cents, discountType, discountValue)
total_cents     =  applyTax(net_cents, taxRateBps, taxSign)
installments[*] =  (per splitMethod) on total_cents
```

The order is mandatory because tax-before-discount and tax-after-discount
produce different totals. The integration test
`payment-schedule-recompute.test.ts > discount-then-tax order` pins this
with a disambiguation case: $1001 × 10% off × 8.5% tax = $977.47
(NOT $977.48 from the wrong order).

## Rounding rule — extras on FIRST, last is floor

Same rule that lives at the top of `src/lib/recompute/cents.ts`. Applies
uniformly to `distributeIntegerCents`, `splitByPercentages`, and
`splitByFractions`. The orchestrator never reaches behind these primitives;
it just calls them.

**Σ-invariant:** every split test asserts Σ installments == project.total_value_cents.
This is the never-silent-mismatch invariant (Tech Arch §4 line 121:
"never silently persists").

## Override-protection contract (silent-corruption mode B)

- `amount_overridden=true` → the installment's `amount_cents` is NEVER
  recomputed. Setting `amountCents` via `updatePaymentInstallment` flips
  this flag automatically.
- `due_date_overridden=true` → the installment's `due_date` is NEVER
  recomputed. Setting `dueDate` via `updatePaymentInstallment` flips
  this flag automatically.
- If BOTH would be a no-op for a row, NO `UPDATE` is issued — `updated_at`
  does not move. The integration test asserts this directly.

## NEVER show raw cents (rule D1 — PIVOTS_LEDGER §1)

`amount_cents` is integer cents — storage and compute only. Every UI
consumer (Phase 4 invoice templates, list-view renderers, PDF / email /
CSV) MUST format via `formatCents()`. No inline `${cents}` in JSX. The
rule is documented at top of `src/lib/recompute/README.md`.

## Financial RLS gate (Tech Arch §4 line 104)

`payment_installments` carries a role-gated SELECT/INSERT/UPDATE/DELETE
policy on top of org isolation:

| Role                               | Access      |
| ---------------------------------- | ----------- |
| owner / admin / accountant         | Full        |
| manager (V1, no grant)             | **Blocked** |
| photographer / contractor / editor | **Blocked** |

The manager-with-grant finer check (`member_permission_override.view_financial_data`)
is **deferred to the Phase 4 admin UI**. V1 fail-closed posture: managers
default-blocked at RLS; when the admin UI ships, the grant flow lands
alongside it.

10 RLS tests in `tests/integration/payment-installments-rls.test.ts`
cover both the org-isolation outer clamp and the financial role gate.

## Hard rules

1. **`amount_cents` is integer cents.** No floats anywhere. The
   primitives in `cents.ts` reject non-integer inputs at the boundary.
2. **The money pipeline order is fixed: subtotal → discount → tax → split.**
   Don't reorder. Tax-before-discount produces a different total.
3. **`amount_overridden` is set automatically when a user edits
   `amountCents` via `updatePaymentInstallment`.** Direct DB writes
   that bypass this action skip the flag — don't do that.
4. **Σ installments MUST == project.total_value_cents** in every
   created/recomputed schedule. The orchestrator preserves this for
   `pay_in_full`/`even_by_count`/`percentage`/`fraction` by construction.
   For `manual`, `validateManualSplit` throws if the user-supplied
   amounts don't reconcile.
5. **Never display raw cents to a human.** Rule D1 (PIVOTS_LEDGER §1).
   Format via `formatCents()` at every UI/email/PDF/CSV consumer.

## What's deferred (Stripe Connect blocks all of this)

- `invoices` table (line items / status / sent_at / paid_at / Stripe IDs)
- `payments` table
- Public payment portal (signed-token unauth endpoints)
- Invoice PDF + email send + viewed-at tracking
- Refund flow
- Auto-invoice generation on workflow events
- Smart Documents / contract templates

Each lands when Stripe Connect is unblocked (user-owned external item per
`docs/INTEGRATION_STRATEGY.md` §3 and `docs/PIVOTS_LEDGER.md`
"Externally-blocked items").
