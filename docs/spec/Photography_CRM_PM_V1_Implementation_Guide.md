# PHOTOGRAPHY CRM/PM — V1 IMPLEMENTATION GUIDE (FOR CLAUDE CODE)

**Audience:** Claude Code, building inside the verified `Micshea88/PhotoCRM` foundation ("Pathway Foundation" starter).
**Companion docs:** `Photography_CRM_PM_V1_Requirements.md` (what to build), `Photography_CRM_PM_V1_Build_Spec.md` (module breakdown + verified stack), `Photography_CRM_PM_V1_Sprint_Plan.md` (order), `Photography_CRM_PM_V1_Wireframes.html` (UI intent).
**This document:** how to build it _in this specific codebase_ without fighting the foundation.

This guide assumes the repo audit dated 2026-05-18 is accurate. If the codebase has diverged, re-audit before trusting anything below.

---

## 0. READ THIS BEFORE WRITING ANY CODE

This foundation is opinionated. It will fight you if you ignore its patterns and it will accelerate you if you follow them. The rules below are not style preferences — they are how this codebase stays correct.

1. **Every product feature is a clone of `src/modules/items/`.** Do not invent a new structure. Copy the directory, rename `items` → `<feature>`, register the schema export, add routes. The foundation has a `/new-module` scaffolder and an add-module skill — use them.
2. **Every mutation goes through `orgAction`** (from `src/lib/safe-action.ts`). Never write a server action that touches the database without it. It resolves `ctx.activeOrg.id`, `ctx.activeOrg.role`, `ctx.db`, IP/UA, and writes the audit row. Bypassing it = an unaudited, unscoped, insecure write.
3. **No DB access from `app/`.** ESLint blocks it. All reads go through a module's `queries.ts`; all writes through `actions.ts`.
4. **Every app table gets soft-delete columns** (`deletedAt`, `deletedBy`) and queries filter `deletedAt IS NULL` by default. The 90-day purge cron already exists and will pick them up — do not write your own hard-delete.
5. **Every state-changing action writes an audit row.** `orgAction` does this; don't suppress it.
6. **RLS is NOT in the foundation. You write it, per table, in the same migration that creates the table.** This is the single most important rule in this document. See §3.
7. **TypeScript strict, no default exports in `modules/`/`lib/`, no `console.*` in `src/`.** The CI gate (`pnpm verify`) enforces this. Run it before considering anything done.

If a requirement in the spec seems to conflict with rules 1–7, the rules win and you flag the conflict — do not silently deviate.

---

## 1. STACK FACTS (do not re-derive these)

- Next.js 16 (App Router; root middleware is `proxy.ts`, NOT `middleware.ts`), React 19, TS 6 strict
- Better Auth 1.6.9 + organization plugin (owns: `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`)
- Drizzle ORM, migrations in `src/db/migrations`, schema re-exported from `src/db/schema.ts`
- Postgres (Neon in prod via Vercel, Postgres 16 local via docker-compose). NOT Supabase.
- Vercel Blob for files (`src/modules/files/` is the pattern), Vercel Cron for jobs (`src/modules/jobs/`)
- Resend for email; Sentry + pino; Vitest + Playwright; lefthook; `pnpm verify` tiered gate
- Package manager: pnpm 10.x, Node 22. Nothing is installed yet (`pnpm install` first).

The "organization" is the workspace/tenant. In product terms it is the photography studio account. Everything is scoped by `organizationId`. Do not introduce a separate "workspace" concept — reuse `organization`.

---

## 2. TERMINOLOGY MAPPING (schema vs. UI)

The locked decision: the core object is `project` in schema/API/code; photographers see **"Event"**.

- Drizzle table: `projects`. Module dir: `src/modules/projects/`. Routes: `app/(app)/events/...` (the URL and UI say "events"; the code says projects).
- Every user-facing string says "Event"/"Events", resolved through the `terminology_map` table (one row set for the photographer pack in V1). Never hard-code "Event" or "Shoot" in components — read the label.
- Domain terms are preserved verbatim and are NOT renamed: "Engagement Shoot" (a real session type value), "second shooter" (role), "Shooting" (time category), product names. These are data values and copy, not the object.

---

## 3. ROW-LEVEL SECURITY — THE NON-NEGOTIABLE BUILD

The foundation enforces tenant isolation only in application code (`orgAction`). The spec requires database-level enforcement (a photographer must not see financials even via a direct API call or a missed `where` clause). You build this. Rules:

1. **Every org-scoped table's creating migration includes its RLS policy in the same migration.** Never "add RLS later." A table without a policy is a leak the day it ships.
2. Pattern per table:
   ```sql
   ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
   ALTER TABLE <t> FORCE ROW LEVEL SECURITY;  -- owner is not exempt
   CREATE POLICY <t>_org_isolation ON <t>
     USING (organization_id = current_setting('app.current_org', true));
   ```
3. The request's org + role are pushed into the DB session at the start of each transaction, derived from the Better Auth session — not from anything client-supplied:
   ```ts
   // inside the orgAction db context, before queries
   await ctx.db.execute(sql`SELECT set_config('app.current_org', ${ctx.activeOrg.id}, true)`)
   await ctx.db.execute(sql`SELECT set_config('app.current_role', ${ctx.activeOrg.role}, true)`)
   ```
   This requires extending `orgAction` once (in `src/lib/safe-action.ts`) so every action gets it automatically. Do this extension as the very first RBAC task; everything else depends on it.
4. Financial tables (`invoices`, `payments`, `payment_installments`, and any table/column carrying profit/cost) get an **additional** policy requiring `current_setting('app.current_role')` to be in the money-permitted set (owner, admin, and manager-with-financial-grant). Photographer/contractor/editor roles: the rows do not return.
5. Assignment-scoped tables (events/tasks visible to photographer/contractor/editor only for assigned work): policy joins to the assignment table and checks membership.
6. Field-level (Event row visible, `profit` field hidden): RLS is row-grain. Field-grain = the `queries.ts` read layer composes a role-aware projection (it omits restricted columns for restricted roles) AND a Postgres column-privilege `GRANT` backstop. Document the restricted columns per table in the module README.
7. **Mandatory negative test per org-scoped table.** Integration test (real Postgres, app layer bypassed): set a wrong org / wrong role in the session config, query the table directly, assert zero rows. A table without this test is not done.

If RLS for a table is unclear, STOP and flag it. A guessed policy is worse than an obvious gap.

---

## 4. BUILD ORDER (maps the sprint plan onto the foundation)

The sprint plan's phases hold. The foundation collapses Phase 1's plumbing because auth/org/audit/soft-delete/files/jobs already exist. Concretely:

**Phase 1 — Foundation extension (short, because most is done):**

1. `pnpm install`, `pnpm setup`, docker compose up, `pnpm db:migrate`, `pnpm seed`, `pnpm dev` — confirm the starter runs green before touching anything.
2. Extend `orgAction` to push org+role into the DB session (§3.3). Add the RLS helper migration scaffold.
3. Build the **custom-fields engine** (not in foundation) — needed by Contacts/Events before they're useful. Jsonb column + a field-definition table per object + typed read/write helpers.
4. Build the **terminology_map** table + label resolver (§2). Tiny, but everything UI-facing depends on it.
5. Add the 8-role model + per-user override jsonb to membership (extends Better Auth `member.role`; do not edit Better Auth's own tables — add an adjacent `member_permissions` table keyed by member id).

**Phase 2 — Core records + PM engine** (clone `items` for each): `contacts` → `companies` (lightweight ref) → `projects` (=Events) → `opportunities`/pipelines → task engine → templated task plans + instantiation → Team This Week → universal saved views. RLS policy written with each table's migration. This phase is on the critical path; the instantiation engine (4.30) is the highest-risk item — build it last in the phase, on top of a proven task engine, reusing one recompute helper shared with payment schedules.

**Phase 3 — Money & comms:** Stripe Connect + invoicing + payment-schedule engine (the recompute helper is shared with 4.30 — build it once, used by both) → Smart Documents → native e-signature (4.6, ~3–4 wks, legal review gate before launch) → template library → email OAuth (Gmail restricted-scope review submitted NOW, in parallel) → SMS → Instagram DM (Meta app review submitted NOW) → inbound parser → unified inbox.

**Phase 4 — Differentiation, notifications, settings, polish:** workflow engine → reporting → calendar → briefs/editing boards/sun/time-tracking → **notification system** → **Settings & Administration (4.34)** → reliability monitoring → onboarding → CSV migration → hardening → beta → launch.

**Submit in parallel, week 1, do not wait:** Meta app review, Google Gmail restricted-scope verification, Stripe Connect platform setup. These are external queues with lead times that will gate launch if started late. They are not build tasks; they are clock-starting tasks.

---

## 5. THE THREE EXTERNAL REVIEW QUEUES

| Queue                                      | What it gates                      | Action                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Meta app review**                        | Instagram DM (V1 priority channel) | Submit week 1 under the studio's Meta Business entity. Slowest queue.                                                                                                                                                                                      |
| **Google Gmail restricted scope (+ CASA)** | Per-user Gmail send/read OAuth     | Submit week 1: privacy policy, scope justification, security questionnaire. Recurs annually (CASA) — it is an ongoing obligation, not a one-time gate. Microsoft 365 mail is lighter; IMAP/SMTP needs no review and is the launch fallback if Google lags. |
| **Stripe Connect**                         | All payments                       | Platform entity + country/payout model. Per-workspace KYC is ongoing, via Stripe's hosted flow.                                                                                                                                                            |

If a build doc ever implies these are instant, it is wrong. Plan around the queues.

---

## 6. MODULE-TO-FOUNDATION CHEAT SHEET

| Spec module                                                | Foundation pattern to clone/extend      | Notes                                                                                               |
| ---------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Contacts, Events, Opportunities, Tasks, etc.               | `src/modules/items/` verbatim           | schema→types→queries→actions→ui; register in `src/db/schema.ts`                                     |
| File management                                            | `src/modules/files/`                    | Vercel Blob private + download proxy already correct; add per-Event scoping + `client_visible`      |
| Notifications                                              | new module + `src/modules/jobs/` cron   | in-app + email (Resend, already wired); push deferred to V2 native app; dispatcher channel-agnostic |
| Templated task plan recompute / payment-schedule recompute | new shared helper + Vercel Cron         | ONE recompute helper, `*_overridden` flag pattern, used by both 4.30 and payment schedules          |
| Audit-log viewer (in Settings)                             | `src/modules/audit/` (table exists)     | just a read UI over existing `audit_log`; do not add fields to it                                   |
| RBAC + RLS                                                 | extend `orgAction` + per-table policies | §3; highest-risk; negative tests mandatory                                                          |
| Settings & Administration                                  | new module, admin-gated actions         | foundation excluded admin UI by design — fully net-new                                              |
| AI command palette / AI features                           | new module + Anthropic SDK (not wired)  | add `@anthropic-ai/sdk`; net-new, not a freebie                                                     |
| Stripe, e-sign, Gmail/MS/IMAP, Twilio, calendar, Meta      | net-new integrations                    | none in foundation; isolate each behind a module boundary                                           |

---

## 7. DEFINITION OF DONE (per module)

A module is not done until all of:

1. Follows the `items` pattern; schema registered; routes under `app/(app)/<feature>/`.
2. All mutations via `orgAction`; no DB access from `app/`; no default exports in module/lib; no `console.*`.
3. Soft-delete columns present; queries filter deleted by default.
4. If org-scoped: RLS policy in the creating migration + a negative test proving cross-org/cross-role queries return zero rows with the app layer bypassed.
5. Audit rows written on state changes.
6. UI strings resolved through `terminology_map`, not hard-coded.
7. `pnpm verify` tier 2 green (typecheck, lint, check-actions, unit, integration, build). Tier 3 (E2E) green before a phase is called complete.
8. Module README written in the foundation's style (what it is, hard rules, the pattern).

"It works when I click it" is not done. Done is the list above.

---

## 8. KNOWN-DANGEROUS AREAS (extra care, slower, more tests)

These are the places where "looks fine" and "is correct" diverge and the cost of wrong is high:

1. **RLS policies (every org table).** A missing/loose policy is a silent data leak. Negative tests are not optional. Highest risk in the project.
2. **Native e-signature (4.6).** The document hash, the immutability of the signed PDF, and the audit trail are legally load-bearing. A flawed trail is an unenforceable contract. Requires the separate pre-launch legal review.
3. **Payment-schedule + task-plan recompute (4.7 / 4.30).** Integer-cents only, never float. Remainder absorbed on the last installment. `*_overridden` rows protected from recompute. Fixed order of operations: line items → discount → tax → total → split. One shared helper, not two implementations. The order is specified in the requirements; do not re-derive it.
4. **Meta / Gmail token expiry.** Broken auth means leads silently disappearing. The reliability module must surface token-health, not fail quietly.
5. **The instantiation engine (4.30).** Relative-date math with weekend/override handling is the single most likely overrun. Build on a proven task engine, last in its phase, reusing the recompute helper.

For each of these: write the negative/edge tests first, move slower, and flag uncertainty rather than guessing. Everywhere else, the `items` pattern makes speed safe — here it does not.

---

## 9. WHAT NOT TO DO

- Do not edit Better Auth's tables (`user`, `session`, `member`, etc.) to add app data. Add adjacent tables keyed by their ids.
- Do not change Better Auth config in `src/lib/auth.ts` without the full end-to-end auth walk in the auth module README.
- Do not introduce a second tenancy concept; `organization` is the workspace.
- Do not hard-delete anything; the purge cron is the only hard-delete path.
- Do not put DB access in `app/`. Do not add default exports in `modules/`/`lib/`. Do not leave `console.*` in `src/`.
- Do not add RLS "in a later migration." Same migration as the table, always.
- Do not treat the AI command palette or permissions as framework-provided; the audit disproved that.
- Do not skip the pre-launch legal review of contracts + e-sign. It is the highest-risk shortcut available.
- Do not mark a module done on "it works" — use §7.

---

## 10. THE FIVE THINGS STILL OWED BY A HUMAN (not buildable by reading code)

These block correctness, not the next line of code. Resolve before the dependent module ships:

1. Stripe Connect platform legal entity + country/payout model (blocks 4.7).
2. Meta Business entity for the app-review submission (blocks 4.10; submit week 1).
3. Google Cloud project + privacy policy for Gmail restricted-scope review (blocks 4.8 Gmail path; submit week 1).
4. The one-time legal review of contract templates + e-sign flow (blocks 4.6 launch, not build).
5. The parked Company-object decision: stays lightweight unless (a) committing to non-photography verticals or (b) repeated customer demand for company-level history/reporting. Decide before building 4.34's company-management surface.

Everything else in the spec is buildable now, against this foundation, by following this guide.

**END OF IMPLEMENTATION GUIDE**
