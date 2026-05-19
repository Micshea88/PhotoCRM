# Pivots Ledger

The single source of truth for **load-bearing rules** and **carried-forward
deferrals** that no module README owns end-to-end. Cross-references the
authority documents (each row links back to the source-of-truth README,
commit, or spec section).

This file exists so the Phase 4 work cannot quietly miss a rule that was
locked in during Phase 2. Update this ledger whenever:

- A new hard rule is added to AGENTS.md
- A new deferral is named in a module commit/README
- A deferral is closed (mark with strike-through + closing commit hash)

Last reconciled: 2026-05-19. Reconciliation method: read every module
README + commit message from `0d4b95e` forward; rounding rule confirmed
present in `src/lib/recompute/README.md` + `src/lib/recompute/cents.ts`.

---

## Section 1 — AGENTS.md hard rules (the canonical 12)

These are enforced by lint, types, hooks, or CI. Don't try to work
around them — fix the underlying issue. Source: `/AGENTS.md` §"Hard
rules".

| #   | Rule                                                                                                                                                                                                                                                                     | Enforcement                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | **No DB access from `app/`.** Routes call `queries.ts` for reads, `actions.ts` for writes. Documented exceptions: `app/api/jobs/**`, `app/api/blob/upload/route.ts`, `app/api/files/[id]/route.ts`, `app/api/auth/**`.                                                   | ESLint `no-restricted-imports` blocks `drizzle-orm`, `@/db`, `@/db/*`, `@/lib/db`, `@/modules/*/schema` under `app/**` |
| 2   | **All mutations use `orgAction` (or `authAction`).** Never `action` directly except for genuinely public actions. The factory enforces auth + org membership + audit context.                                                                                            | code review                                                                                                            |
| 3   | **Every action chain MUST include `.inputSchema(zodSchema)`.** `next-safe-action` does NOT enforce input validation by itself.                                                                                                                                           | `scripts/check-actions.mjs` (run by `pnpm verify --tier=1`) fails the build                                            |
| 4   | **Soft delete only.** App-side tables carry `deletedAt`/`deletedBy`. Hard delete happens only in `app/api/jobs/cron/purge-deleted/route.ts`. Auth tables (Better Auth: `user`, `organization`, `member`, `session`, `account`, `verification`, `invitation`) are exempt. | code review                                                                                                            |
| 5   | **Every state-changing action calls `audit()`.** Pass `ctx` straight through.                                                                                                                                                                                            | TODO C11 — not statically enforced yet                                                                                 |
| 6   | **Every state-changing action calls `revalidatePath()`.** Route cache invalidation is deliberate.                                                                                                                                                                        | code review                                                                                                            |
| 7   | **No `console.*` in `src/` and `app/`.** Use `import { log } from "@/lib/log"`. Tests/scripts/instrumentation are exempt.                                                                                                                                                | ESLint                                                                                                                 |
| 8   | **No default exports in `src/modules/**`and`src/lib/**`.** Named exports only.                                                                                                                                                                                           | ESLint `no-restricted-syntax`                                                                                          |
| 9   | **Migrations on `main` are immutable.** Never edit a committed migration file. Generate a new one with `pnpm db:generate`.                                                                                                                                               | post-edit hook warns hard                                                                                              |
| 10  | **No destructive schema changes in a single migration.** Expand → migrate → contract.                                                                                                                                                                                    | `/migration-review` command + reviewer judgment                                                                        |
| 11  | **Sage never connects to a production database from his machine.** `src/lib/db.ts` localhost allowlist; `scripts/seed.ts` mirrors. Production credentials live only in Vercel env vars.                                                                                  | runtime guard in `src/lib/db.ts`                                                                                       |
| 12  | **Production secrets must be high-entropy and free of dev markers.** `BETTER_AUTH_SECRET` / `CRON_SECRET` / `QUEUE_SECRET` are rejected when `VERCEL_ENV=production` if they contain `dev`/`local`/`test`/`changeme`.                                                    | runtime guard in `src/lib/env.ts`                                                                                      |

### Display-discipline addendum (added 2026-05-19)

| #   | Rule                                                                                                                                                                                                                                                                                                                                                                    | Source                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| D1  | **NEVER show raw cents to a human.** Integer cents are storage/compute only. Every UI screen, email, PDF, invoice, CSV/XLSX export, and audit-rendering surface MUST format `*_cents` as currency (`226667 → "$2,266.67"`). Same for basis-points → percent. Phase 4 ships `formatCents()` at `src/lib/format/money.ts`; no inline `${cents}` template literals in JSX. | `src/lib/recompute/README.md` § "NEVER show raw cents" |

---

## Section 2 — Carried-forward deferrals (with named owners)

Open items that a future module / phase / consumer must pick up.
Strike-through + the closing commit hash when complete.

### Phase 2 still-to-come

| Deferral                                                                                                                                 | Owner                    | Source                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------ |
| ~~Assignment-scoped RLS overlay on `contacts` / `projects` / `tasks`~~ — **CLOSED in commit 14a** (`0015_assignment_scoped_rls_overlay`) | invoices module commit   | See Section 3 below                                          |
| ~~`lookupExtendedMemberRole` helper + widening `OrgContext.role` to the 8-role enum~~ — **CLOSED in commit 14a**                         | invoices module commit   | See Section 3 below                                          |
| Sun-calc fill (`projects.sun_data`) reads venue coords + primary_date                                                                    | Phase 2 module 4.20      | `projects/README.md` "What's deferred"                       |
| Geocoder fill (`projects.primary_venue_coordinates`)                                                                                     | Phase 2                  | `projects/README.md` "What's deferred"                       |
| Recompute primitives consumption: payment-schedule recompute helper at `src/modules/invoices/recompute-schedule.ts`                      | invoices module          | `src/lib/recompute/README.md` "Where this is consumed today" |
| `packageDefaults` / `paymentScheduleDefaults` schema tightening from loose Zod to canonical shape                                        | invoices module          | `project-templates/README.md` "What's deferred"              |
| Cross-pipeline auto-creation ("Sales → Production on Booked")                                                                            | workflow engine, Phase 4 | `opportunities/README.md` + `pipelines/README.md`            |
| Default-workflow id validation (`projectTemplates.defaultWorkflowIds`)                                                                   | workflow module, Phase 4 | `project-templates/README.md`                                |

### Phase 4 admin/UI work

| Deferral                                                                                                                                | Owner                                                                        | Source                                            |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| Phase 4 invite UI MUST hard-block sending without an explicit extended-role selection (no default; "Send invite" disabled until chosen) | Phase 4 Settings module 4.34                                                 | `rbac/README.md` Layer 1 + rule #5                |
| `afterRemoveMember` cleanup hook (removes orphaned `member_role` + `member_permission_override` rows)                                   | Phase 4 admin UI                                                             | `rbac/README.md` "What's deferred"                |
| Admin UI for editing roles + permission overrides                                                                                       | Phase 4 Settings module 4.34                                                 | `rbac/README.md`                                  |
| Admin UI for editing custom-field definitions                                                                                           | Phase 4 Settings module 4.34                                                 | `custom-fields/README.md` "What's deferred"       |
| Activity timeline rendering on contact/event detail pages                                                                               | per consumer module (sources from messages / payments / workflow_executions) | `contacts/README.md` "What's deferred"            |
| Duplicate-detection UI for contacts (algorithm + merge flow)                                                                            | Phase 4                                                                      | `contacts/README.md`                              |
| Bulk operations on contacts (tag, email, export, reassign owner)                                                                        | Phase 4                                                                      | `contacts/README.md`                              |
| CSV import + AI interpretation (Requirements §6.27)                                                                                     | module 4.27, Phase 4                                                         | `contacts/README.md`                              |
| Stale-card warnings + WIP limits + per-stage automation hooks                                                                           | kanban module, Phase 4                                                       | `pipelines/README.md` + `opportunities/README.md` |
| Pipeline forecast report / win-rate-by-stage / lost-lead reasons / average-time-in-stage                                                | reporting module, Phase 4                                                    | `opportunities/README.md`                         |
| Formula evaluator for custom-fields (`formula` FieldType)                                                                               | Phase 4 stretch — needs parser, type system, dep tracking, cycle detection   | `custom-fields/README.md` "What's deferred"       |
| Vendor Matrix curates `companies.category` from text into enum + migrates values                                                        | Phase 4                                                                      | `companies/README.md` rule #2                     |
| Checklist item bulk reorder action (mirrors `reorderPipelineStages`)                                                                    | Phase 4 UI consumer                                                          | `tasks/README.md` "What's deferred"               |
| Phase 4 list-view renderers seed default saved-views per object type                                                                    | Phase 4 list-view modules                                                    | `saved-views/README.md` "What's deferred"         |
| Per-user-targeted sharing on saved_views (currently `shared` is org-wide)                                                               | V2+ if needed                                                                | `saved-views/README.md` "What's deferred"         |
| Phase 4 admin override action for saved_views (V1 is owner-only)                                                                        | Phase 4 settings                                                             | `saved-views/README.md` mutation policy           |
| Strict per-object-type filter/sort/grouping validation on saved_views (V1 is loose jsonb + graceful degradation)                        | each list-view renderer ships its own                                        | `saved-views/README.md`                           |

### Open hardening items (TODO.md)

| Deferral                                                                                           | TODO ID       | Source                        |
| -------------------------------------------------------------------------------------------------- | ------------- | ----------------------------- |
| Multi-region rate-limit storage (Upstash) — current in-memory store is fine for single-region      | H9            | `TODO.md` + `auth/README.md`  |
| Audit-on-mutate static enforcement (lint or check-actions extension)                               | C11 follow-up | `AGENTS.md` rule #5           |
| Partial indexes `WHERE deleted_at IS NULL` on items/files                                          | H6            | `TODO.md`                     |
| `verification.expires_at` + `invitation.expires_at` indexes                                        | H7            | `TODO.md`                     |
| `user.email` case-insensitive (citext or `lower(email)` unique index)                              | H8            | `TODO.md`                     |
| Auth events to audit log (sign-in, password-reset, invite-accepted, session-revoked)               | H10           | `TODO.md` + `audit/README.md` |
| Password breach corpus check (HIBP k-anonymity)                                                    | H13           | `TODO.md`                     |
| Hash Better Auth `verification.value` at rest + daily expired-token sweep cron                     | H14           | `TODO.md`                     |
| Neon Pooled vs Direct endpoint enforcement — currently documented, not defaulted                   | H5            | `TODO.md`                     |
| Lefthook pre-commit perf: lint+format+unit only, full typecheck on pre-push                        | H34           | `TODO.md`                     |
| Cross-org integration test through `orgAction` factory directly (mock sessions, attempt cross-org) | H36           | `TODO.md`                     |
| Branch protection in GitHub — documented; lives in GH UI, not code                                 | H38           | `TODO.md`                     |
| Several Medium/Low items (M5, M7, M8, M10, M12, M15, L2-L7)                                        | various       | `TODO.md`                     |

### Other carried-forward (not in TODO.md)

| Deferral                                                                                                                         | Source                                |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Cycle detection on task dependencies beyond self-reference (A → B → A) — UI-prevention only in V1; revisit if customers complain | `tasks/README.md` rule #4             |
| Cycle detection on `blockedByTemplateItemId` beyond self-reference                                                               | `project-templates/README.md`         |
| FKs from `project_templates.questionnaire_id` / `contract_template_id` to their owning tables — added when those modules ship    | `project-templates/README.md` rule #3 |
| AsyncLocalStorage → RSC end-to-end propagation test                                                                              | summary of pre-compaction work        |
| Pipelines admin role-gate (manager-and-above write) if config drift becomes an issue                                             | `pipelines/README.md` "Deferred"      |

### Phased integration strategy (lightweight V1 → full later)

| Strategy                                                                                                                                                                     | Source                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Email / Instagram / e-sign — locked V1 vs LATER decisions (Resend outbound only; manual IG lead entry; OSS contract templates + OSS e-sign with 4-point capture requirement) | [`docs/INTEGRATION_STRATEGY.md`](./INTEGRATION_STRATEGY.md) |

### Externally-blocked items (user-owned, not buildable by an agent)

| Item                                                           | Owner                        |
| -------------------------------------------------------------- | ---------------------------- |
| Meta app review queue (for any Instagram/Facebook integration) | user                         |
| Google Gmail OAuth verification                                | user                         |
| Stripe Connect onboarding                                      | user                         |
| Resend domain verification before first production sign-up     | user (handoff checklist H33) |

---

## Section 3 — Confirmed pivots (closed / in-place)

| Pivot                                                                                                                                                                                                               | Closing commit                                | Source                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Rounding rule: extras on first, last is floor — unified across `distributeIntegerCents` / `splitByPercentages` / `splitByFractions`                                                                                 | `578b5f2`                                     | `src/lib/recompute/README.md` + `cents.ts` header                                                                                      |
| Three silent-corruption mode defenses (float drift / override bypass / TZ drift)                                                                                                                                    | `578b5f2`                                     | `src/lib/recompute/README.md`                                                                                                          |
| Primitives shared, orchestration NOT shared (Tech Arch §4 correct reading)                                                                                                                                          | `578b5f2`                                     | `src/lib/recompute/README.md`                                                                                                          |
| Schema name `projects`; UI label "Event" via terminology_map (STEP 2(a) locked decision)                                                                                                                            | `6a7b197`                                     | `projects/README.md` rule #2                                                                                                           |
| Money = integer cents; percentages = basis points                                                                                                                                                                   | `6a7b197` + every money-touching commit since | `projects/README.md` rule #1                                                                                                           |
| Mandatory "Last, First — Company" contact display via `contactLabel`                                                                                                                                                | `579b019`                                     | `contacts/README.md` rule #1                                                                                                           |
| 8-role RBAC mapped onto BA 3-role; ROLE_DEFAULTS in code; bootstrap-trust for owner seeding                                                                                                                         | `732056c` + `decb667`                         | `rbac/README.md`                                                                                                                       |
| Custom-fields jsonb key = definition `id`, not name                                                                                                                                                                 | `4570860`                                     | `custom-fields/README.md` rule #1                                                                                                      |
| Saved-views owner-only mutations; org-wide `shared` toggle; loose jsonb filter shapes                                                                                                                               | `b787906`                                     | `saved-views/README.md`                                                                                                                |
| Blobs default `access: "private"`; download proxy at `/api/files/<id>`                                                                                                                                              | `219194d` (C2/C3)                             | `files/README.md`                                                                                                                      |
| `pathway_app` role (NOSUPERUSER, NOBYPASSRLS) + dual DATABASE_URL/DATABASE_URL_ADMIN split                                                                                                                          | `53ec222`                                     | commit message                                                                                                                         |
| Cross-org safety on `instantiateProjectFromTemplate` (defense in depth: orgAction wrapper + explicit org filter + RLS WITH CHECK) — proven by 3 negative tests                                                      | `c306023`                                     | `tests/integration/project-instantiation-rls.test.ts`                                                                                  |
| Assignment-scoped RLS overlay on `contacts` / `projects` / `tasks` — photographer/contractor/editor see only project-assigned rows; tasks carve-out for direct assignee; org isolation preserved as OUTER AND-clamp | (commit 14a)                                  | `tests/integration/assignment-scoped-rls.test.ts`; migration `0015_assignment_scoped_rls_overlay`                                      |
| `OrgContext` widening: `role` is now `ExtendedRole` (8-role); new `userId` field; `app.current_user_id` plumbed; `lookupExtendedMemberRole(tx, userId)` parametric helper; fallback via `extendedFromBetterAuth`    | (commit 14a)                                  | `src/lib/org-context.ts`, `src/lib/safe-action.ts`, `src/modules/rbac/queries.ts`, `src/modules/rbac/types.ts`, `app/(app)/layout.tsx` |

---

## How to use this ledger

- **Before starting a Phase 4 module**, scan Section 2 for entries whose owner is your module or phase. Implement them or carry them forward with an updated owner.
- **Before reviewing a PR**, check Section 1 for the rules that apply to the changed code (most PRs touch 2-4 rules).
- **When closing a deferral**, move it from Section 2 to Section 3 with the closing commit hash + add the source-of-truth README link.
- **When adding a new hard rule** (rare), add it to AGENTS.md FIRST, then add a row to Section 1 here.

**Do NOT** treat this ledger as a substitute for the source READMEs. It is a navigation aid — every row points back to the authoritative document. The ledger can become stale; the READMEs are the source of truth.
