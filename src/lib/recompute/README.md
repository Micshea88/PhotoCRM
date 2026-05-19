# recompute — money + date primitives shared by the orchestration engines

Per Tech Arch §4. This module is the **highest-risk V1 area** because it
sits in front of money and dates — two domains where bugs are silent and
expensive.

## What lives here vs. NOT here

Three files of **pure primitives** — no DB, no logging, no env, no I/O.
Drop-in importable from any module.

- `cents.ts` — `distributeIntegerCents`, `applyDiscount`, `applyTax`,
  `splitByPercentages`, `splitByFractions`, `validateManualSplit`.
- `dates.ts` — `addDays`, `isValidIsoDate`. String-in, string-out.
- `override.ts` — `respectOverride`. Single-line gate; written as a
  named primitive so it's grep-able at every recompute call site.

What is **not** here, on purpose:

- The task-plan instantiation engine (lives at
  `src/modules/projects/instantiation.ts`).
- The payment-schedule recompute engine (will live in the invoices
  module when it ships).

### Why primitives shared, orchestration NOT shared (Tech Arch §4)

The spec calls for "one helper" for payment-schedule and task-plan
recompute. The correct reading of that is: **share the math, not the
orchestration.** Both engines need integer-cents distribution; both need
date arithmetic; both need an override gate. They do NOT share table
shapes, failure modes, audit log strings, or transactional boundaries.

If we forced both engines through one orchestration function, a bug in
the task-plan code path would risk corrupting payment data (and vice
versa); cents.ts/dates.ts test edge cases would be diluted by orchestration
fixtures; a payment-schedule change request would force review of the
task-plan engine. Keeping the primitives pure and the orchestration
separate keeps the blast radius of every change small.

The user has explicitly accepted this split. Document it here so the
next agent doesn't try to "DRY" them together.

## The rounding rule — canonical, applies everywhere

> **The rounding shortfall always lands on the FIRST item(s).**
>
> When `total` doesn't divide evenly across `N` items, the FIRST
> `(total mod N)` items each receive +1 cent over the floor; every
> remaining item — including the LAST — receives the floor amount.
>
> Equivalently: **the LAST item is always the round-down (floor) value;
> earlier items are rounded up by one cent each.**

This rule is implemented identically in `distributeIntegerCents`,
`splitByPercentages`, and `splitByFractions`. The discount/tax pipeline
floors once per step (only one number, no remainder to distribute).

**Plain-English client answer (write this in support replies):**

> "Installment 3 is a penny smaller because it carries the floor amount —
> installments 1 and 2 each gained a cent so the total reconciles to your
> invoice exactly."

Tech Arch §4 canonical example:

| total                 | n   | distribution                               | sum    |
| --------------------- | --- | ------------------------------------------ | ------ |
| $6,800 (680000 cents) | 3   | `[226667, 226667, 226666]` — last is floor | 680000 |

## The three silent-corruption modes — and the tests that catch them

| Mode | Symptom                                                        | Defense                                                                                        | Catching test                                                                                                                         |
| ---- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A    | Float money drift (IEEE-754 cents)                             | `Number.isInteger()` boundary checks in every primitive + Σ-invariant tests                    | `tests/unit/recompute-cents.test.ts` — "invariant: Σ result === total" + non-integer rejection tests                                  |
| B    | Override flag bypass (recompute overwrites user-edited values) | `respectOverride()` primitive + `updated_at`-unchanged assertion in integration test           | `tests/integration/project-recompute-task-dates.test.ts` — "leaves OVERRIDDEN tasks completely untouched (updated_at unchanged)"      |
| C    | Timezone date drift (local-time Date arithmetic)               | `addDays` parses YYYY-MM-DD as integers; uses `Date.UTC`; NEVER `new Date(string)` in dates.ts | `tests/unit/recompute-dates.test.ts` — DST spring-forward test (2026-03-08 → 2026-03-09); run with `TZ=America/Los_Angeles` to verify |

These three modes are why this module exists as a separate primitives
layer instead of inline math in actions. Each defense lives in one
place, so it can be reviewed in one place.

## Calling conventions

```ts
import {
  distributeIntegerCents,
  applyDiscount,
  applyTax,
  splitByPercentages,
  splitByFractions,
  validateManualSplit,
  type DiscountType,
  type TaxSign,
} from "@/lib/recompute/cents"

import { addDays, isValidIsoDate } from "@/lib/recompute/dates"

import { respectOverride } from "@/lib/recompute/override"
```

All `cents` functions take and return **integer cents**. Passing a float
throws. Percentages are **basis points** (1 bps = 0.01%, so 1500 = 15.00%).

## NEVER show raw cents to a human — display discipline (HARD RULE)

> Integer cents are an internal storage and computation format ONLY. They
> are never appropriate for human display. Every UI screen, email, PDF,
> invoice, exported CSV/XLSX, audit-rendering surface, and notification
> MUST format `*_cents` values as currency before they reach a human:
>
> | Stored (integer cents) | Displayed                              |
> | ---------------------- | -------------------------------------- |
> | `226667`               | `$2,266.67` (or per-locale equivalent) |
> | `0`                    | `$0.00`                                |
> | `null`                 | empty / em-dash / TBD (NOT `$0.00`)    |
>
> Same rule for percentages: integer basis points are storage, not
> display. `1500 bps` is shown as `15%` (or `15.00%` where two-decimal
> precision matters — discounts, tax rates).
>
> **This rule binds every consumer of the data**, not just the recompute
> engine: the Phase 4 list-view renderer, contact/event detail pages,
> kanban cards, invoices module's PDF/email templates, the saved-views
> export pipeline, and the audit-log metadata renderer. Lint cannot
> enforce it; PR review must.
>
> When the Phase 4 UI components ship, they own a shared `formatCents()`
> helper (likely at `src/lib/format/money.ts`). Every screen routes
> through it; no inline `${cents}` template literals in JSX.

All `dates` functions take and return **YYYY-MM-DD strings**. Passing a
`Date` object throws.

`respectOverride({ overridden, current, computed })` returns `current`
if `overridden` is true; otherwise `computed`. Use this at every
recompute write site so the user-edit boundary is grep-able.

## Where this is consumed today

| Engine                            | File                                    | Status                             |
| --------------------------------- | --------------------------------------- | ---------------------------------- |
| Project / task-plan instantiation | `src/modules/projects/instantiation.ts` | Live — V1                          |
| Project task due-date recompute   | `src/modules/projects/instantiation.ts` | Live — V1, wired to updateProject  |
| Payment-schedule recompute        | (invoices module)                       | **Deferred** — lands with invoices |

The payment-schedule recompute is deferred BY DESIGN — the invoices
module ships in a later sprint. When it does, it will import the
primitives from this module unchanged, and add its own orchestration
function at `src/modules/invoices/recompute-schedule.ts` (paralleling
projects/instantiation.ts). The primitives don't need to change.

## What is enforced statically

Nothing in this module is enforced by lint or CI hooks — the discipline
is "all tests stay green" + "all primitives are pure" + "the orchestration
engines own their own tests." If you change the rounding rule (don't,
without a deliberate spec-level revision), every test in
`tests/unit/recompute-cents.test.ts` will fail loudly.
