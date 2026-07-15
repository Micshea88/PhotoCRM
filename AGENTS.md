# Pathway Foundation — Agent Operating Guide

This is the playbook every coding agent in this repo follows. Read this first.

## What this repo is

A Next.js 16 + Postgres + Vercel foundation that Sage will build the Pathway product on top of. The defining design constraint is **agentic-development friendliness for a non-technical owner**: every decision optimizes for an LLM agent being able to add features cleanly, and for the human owner being unable to easily break the security, reliability, or quality fundamentals.

## Product positioning — HYBRID CRM + Project Management (LOCKED)

**Pathway is a hybrid CRM + Project-Management product, ~50/50 (up to 60/40), not a CRM with PM bolted on.** It serves photographers who manage BOTH the client relationship / sales side (leads, inquiries, proposals, contracts, payments) AND project delivery (sessions, weddings, post-production, edits, gallery delivery). Both halves are first-class.

**Consequence for design decisions:** the CRM default is NOT automatically correct. When the relationship/sales convention and the project-delivery convention differ, **surface BOTH and let Mike choose** — do not silently pick the CRM pattern. Pathway is hybrid by design.

- Precedent (2026-06-19): the task color system added a 3-day yellow "due soon" state — a **PM pattern** (Asana/ClickUp) that HubSpot/Salesforce don't do — because it serves photographers managing project deadlines, not just sales pipelines. Mike chose the PM pattern explicitly.

See `docs/pathway-design-system.md` §0 for the design-doc statement of this principle.

## Standing design laws (LOCKED — apply to EVERY future push)

These govern all UI / PM work. Check every relevant task against them, the same way every task is checked against the multi-tenant RLS rules (Hard rules §4/§10a).

### LAW 1 — Persona separation (client-facing vs. internal)

**No single screen serves both the client persona and the internal persona at once. A screen is either client-facing-minimal or internal-dense — never a blend.**

- **Client-facing surfaces** (booking, smart docs, proposals, client portal — anything a CLIENT sees) stay **MINIMAL and linear**: friction-free, only what that client needs for the step they're on.
- **Internal surfaces** (event tasks, pipeline/kanban, editing board, team workload, dashboards) carry the **DENSITY**.
- This is the #1 UX failure that kills CRM+PM products: HoneyBook cannibalized the internal side; monday/ClickUp cannibalized the client side. Pathway does not repeat it.
- **Every UI task is checked:** _which persona is this screen for, and does it stay in its lane?_ If a screen tries to serve both, **split it**. Surface the persona question in build-planning like any hybrid CRM/PM divergence.

### LAW 2 — PM frontend performance (build fast from the start, do NOT retrofit)

**Internal PM surfaces (kanban, task lists, dependency views, team workload, cross-client dashboards) MUST be built for real volume in their FIRST version.** Target: a studio with **40+ active events and several hundred tasks stays fast and responsive.**

Required patterns, applied AT BUILD TIME (not retrofitted later):

- **Optimistic UI** on high-frequency mutations (drag / status change / reorder) — never block the UI on a server round-trip.
- **List virtualization** for large collections.
- **Pagination / lazy-load** for large queries.
- **Proper DB indexing** on the query paths those views hit.

**Validation happens in PRODUCTION** (Mike builds + tests in prod — real data/network/query conditions local testing hides), NOT locally. When PM views ship: **SEED realistic volume into the production environment** (a script generating ~40 active events with full task trees / several hundred tasks), **validate board/list/timeline/workload views stay fast AT THAT VOLUME in production, then REMOVE the seed data.** Everything is fast with 5 records — the point is to prove real scale before external customers exist; fix any lag before deploying to others.

This is a **"build it right" discipline, not a gamble**: the patterns are standard and well-understood; the failure mode is _neglecting_ them, not that they're hard. The seeded-production test is the PROOF, not a substitute for building it right.

### LAW 3 — AI is a tool, not the owner

**AI SURFACES; the human ACTS.** AI in Pathway surfaces suggestions, gaps, and opportunities for the human to act on. It **NEVER takes client-facing or business action on its own** — never auto-contacts a client, never auto-sends, never completes a suggested action, never invents or does anything it wasn't explicitly asked to do.

- Anything AI surfaces (upsell opportunities, workflow drafts, insights) requires **explicit human approval before it does anything**.
- The human is **always the gate** on anything client-facing and the **source of truth** on all approvals.
- Why: this defuses the catastrophic failure mode of an automated upsell firing at a client in a sensitive situation — the photographer, who knows the human context, always decides.

### LAW 4 — Tenant data is NEVER cross-referenced (CRITICAL — enforce like RLS)

**A studio's data is ITS data.** It is never leaked, shared, pooled, or cross-referenced to any other company/studio in the system — for AI training, upsell suggestions, market insights, or ANY purpose. **AI learns ONLY from the individual tenant's own data.** No cross-tenant intelligence, no aggregated-market suggestions derived from other tenants' data, ever.

- Build it exactly this way and safeguard against any possible error. A cross-tenant data leak would end Pathway and invite major lawsuits.
- **Enforce with the same rigor as the multi-tenant RLS isolation** (Hard rules §4/§10a; `docs/multi-tenant-remediation-plan.md`). **Treat a cross-tenant AI leak with the same severity as an RLS breach.** Any AI feature that reads data to inform output must be provably scoped to the single CURRENT tenant **at every layer**.
- **Concrete AI leak vectors to guard against (all forbidden):**
  - **NO shared/pooled vector or embedding store across tenants** — embeddings are **per-tenant partitioned**; a retrieval can only ever return the current tenant's vectors.
  - **NO prompt/response cache that can serve one tenant's content to another** — cache keys are tenant-scoped; a cache hit can never cross tenants.
  - **NO model fine-tuning or training on pooled cross-tenant data.**
  - Every layer scoped: query, retrieval, embeddings, cache, model context. If any layer could span tenants, it's a breach.
- **DECISION (LOCKED): Pathway will NOT build any aggregate / cross-tenant "market insight" or benchmark feature.** Even anonymized/aggregated, the risk of pulling sensitive tenant data and cross-referencing it to another tenant is not worth it. **AI suggestions draw ONLY from the individual tenant's own data** — e.g. _"YOU usually sell albums by day 45,"_ _"YOUR similar events added an engagement session"_ — never _"studios like yours…"_. This is not a limitation; it's plenty useful and carries zero cross-tenant risk. **Do not add an aggregate/cross-tenant data source later without revisiting this law** (explicit owner decision required).

### LAW 5 — Plain-English UI

**Pathway is built by an everyday human for everyday humans** (non-technical event professionals) — NOT for developers, computers, or other AI. ALL UI language — labels, instructions, prompts, questions, AI-generated summaries of workflows — must be **simple, plain English a moderate English speaker easily understands.** No tech-speak, no code, no jargon.

- Action item (pre-build research): benchmark the reading level of prompts/UI copy in leading CRMs and adopt a similarly accessible level.

### Persona-law companion — client-presentation views are DEDICATED, opt-in

To satisfy LAW 1 (persona separation) for live-consultation / client-facing display use cases, do NOT add a "hide internal data" toggle to an internal screen. Instead build a **dedicated client-facing view** (e.g. the day-of timeline) that **by design contains only client-safe data — nothing internal is wired into it, so nothing internal can leak.** Within that view, the user opts fields IN via toggles (show price, show 2nd shooter, show event details…). **Opt-in, not opt-out**, so unintended data can never be shown. (Feature detail: `docs/features-backlog.md`.)

(Design-doc statement + wireframe checklist: `docs/pathway-design-system.md`.)

### LAW 6 — Responsive content width (no fixed-width islands)

**Page content is FLUID and scales with the viewport.** It fills the available width with consistent horizontal padding, up to a sensible readable max-width — it is **NEVER pinned to a single fixed size, and never sits as a narrow island surrounded by large dead margins on wide screens.**

- **Every page uses the SHARED page-shell / content-container.** Pages do NOT hand-roll their own width and padding. If no shared container exists, **build one** — a per-page width constraint is the exact bug this rule exists to prevent (the failure mode is a scatter of `max-w-2xl` / `max-w-3xl` / `max-w-4xl` across pages with no single source of truth).
- **No doubled gutters:** the parent container's padding and a child's `max-width` must not both apply. One layer owns the horizontal constraint.
- **Every new screen is checked at NARROW, MEDIUM, and WIDE viewports before it's considered done:** no giant dead margins when wide, no cramped edges when narrow.
- **Applies to ALL screens.** The failure mode is fixing one page and repeating the defect on the next — so the constraint lives in the shared container, not in each page.
- **Trigger:** violated on the /notifications page (a fixed-width `mx-auto max-w-2xl` content island with excessive left/right whitespace on wide screens), 2026-07-09.

### LAW 7 — Test the RESULT, not the setup

**A display or interaction feature is not done until a test asserts the OBSERVABLE RESULT — not the state that should produce it.**

- Assert the **list reordered** — not that a sort param was mapped.
- Assert the **row is denser** (e.g. the preview clamped to one line) — not that a density attribute is present.
- Assert the **quote was removed** from the cleaned string — not that a trim function was called.

**COROLLARY — real payloads for external input:** any code that parses **EXTERNAL input** (email bodies, webhook payloads, imported files) MUST be tested against **REAL CAPTURED PAYLOADS**, not hand-written fixtures. Hand-written fixtures encode the shape the author _imagined_, and pass on code that fails on the shape that actually arrives. **A test that passes on a fixture that does not resemble production input proves nothing.**

- **Why this law exists (worked examples, all shipped through clean reviews):** three notification features shipped broken because their tests verified _state_ not _behavior_ — sort didn't sort (test asserted the mapped param, not the rendered order), compact wasn't compact (test asserted a `data-density` attribute, not the row density), and the email cleaner didn't clean real Gmail HTML (fixtures were newline-separated + entity-free; the real payload is single-line + entity-encoded). See `docs/cleanup-and-tech-debt.md` for the full post-mortem.
- **Trigger:** the D1/D2/D3 production defects (2026-07-10).

## Standing backend policies (LOCKED — apply to EVERY backend change)

Twelve backend policies, checked like the design laws. Full context + status in
`docs/backend-audit-backlog.md`.

1. **RLS tests run under a NOBYPASSRLS role** via helper-level `SET LOCAL ROLE app_authenticated`.
2. **Every webhook:** verify-sig → enqueue → ACK → async → idempotent-on-event-id → DLQ + reconcile. Never inline. `rc-sync` is the template.
3. **Every job:** idempotent + atomic claim (`UPDATE…WHERE…RETURNING` / `FOR UPDATE SKIP LOCKED`) + lease + reaper; `retry_after` > max runtime.
4. **Every merge re-parents ALL child relations, enumerated from the FKs, test-enforced.** New child table ⇒ merge engine + re-parent test updated in the same PR.
5. **Every outbound provider call** goes through a rate-limited, 429-aware, retrying client.
6. **No `OFFSET` on tenant-scoped lists** — keyset on `(sort_col, id)`; everything paginated/capped including tasks and the activity feed.
7. **"Queryable ⇒ not free text"** — enum/lookup + normalize-on-write for lead source, company category, lost reason.
8. **Permission checks centralized** (`orgAction.withPermission(key)`); financial/sensitive actions carry an action-layer check AND RLS.
9. **`audit()` on every state-changing action**, enforced via `check-actions.mjs`, not convention.
10. **Externally-consumed endpoints versioned `/api/v1`** + shared rate-limit (Upstash) before multi-region.
11. **PII + payments baseline:** MFA, session expiry reconciled, password-min = 12, HIBP wired.
12. **PM frontend when it ships:** virtualization + optimistic UI + production scale-seed in v1 (LAW 2). Don't retrofit.

> **Enforcement caveat (2026-07-15):** "enforced" / "CI-enforced" for items above (esp. #1, #9) currently means the **local `lefthook` pre-push hook only** — GitHub Actions has never run on this repo. Making these remote-gated is tracked as A1b in `docs/backend-audit-backlog.md`.

## Build-planning audits — STANDING PROCESS (every audit)

Every build-planning / feature audit MUST research and reference best-in-class patterns from BOTH sides, and surface divergences as choices:

1. **CRM / relationship-sales side:** HubSpot, Salesforce, Pipedrive, Close, and the photo-CRMs HoneyBook, Dubsado, 17hats, Studio Ninja, Táve, Iris Works, Sprout Studio.
2. **Project-Management / delivery side:** Asana, ClickUp, Monday.com, Notion, Linear, Basecamp.

When CRM defaults and PM defaults differ, present BOTH options with trade-offs — never assume the CRM default wins.

Every build-planning audit MUST include a dedicated **"PM-friendly enhancement opportunities"** section alongside the CRM-pattern section, surfacing project-delivery options Mike can choose from (e.g., due-soon states, dependencies, board/timeline views, workload, checklists, recurring tasks). Memory: [[feedback_research_best_in_class_before_design]] now spans both CRM and PM.

## What to read before editing

1. **This file.**
2. **`docs/architecture.md`** for the deeper "why" behind the conventions.
3. **The README of the module you're touching** (e.g., `src/modules/items/README.md`).
4. **`docs/handoff-checklist.md`** if the user is asking about deployment or first-day setup.
5. **`TODO.md`** at the repo root — outstanding hardening punch list.

## Layout

```
proxy.ts                      # Next 16 middleware (renamed from middleware.ts in v16 — DO NOT rename)
app/                          # routes only — layouts, pages, route handlers
  (auth)/                     # public sign-in / sign-up / verify / reset / accept-invite
  (app)/                      # authenticated app shell
  api/                        # auth handler, webhooks, jobs, blob, files
components/ui/                # shadcn primitives only — never product UI
src/
  modules/<name>/             # ALL product logic. One concept per module.
    schema.ts                 # Drizzle table(s)
    queries.ts                # server-only read functions
    actions.ts                # server actions (orgAction / authAction)
    types.ts                  # Zod input schemas + inferred types
    ui/                       # feature-local React components
    README.md                 # what this module is and how to extend it
  lib/                        # cross-cutting infra: env, db, auth, safe-action, log, blob, email
  db/                         # Drizzle schema entry point + migrations
tests/
  unit/                       # Vitest, jsdom — pure logic
  integration/                # Vitest, real Postgres + transactional rollback
  e2e/                        # Playwright golden paths
docker-compose.yml            # local Postgres for development + integration tests
```

> **Note:** `proxy.ts` is the Next 16 name for what used to be `middleware.ts`. The two filenames are mutually exclusive — Next 16 will refuse to boot if both exist. Don't rename it. (See the comment header in `proxy.ts`.)

## Hard rules

These are enforced by lint, types, hooks, or CI. Don't try to work around them — fix the underlying issue.

1. **No DB access from `app/`.** Routes call `queries.ts` for reads and `actions.ts` for writes. ESLint blocks `drizzle-orm` (bare and subpath), `@/db`, `@/db/*`, `@/lib/db`, and `@/modules/*/schema` imports from anywhere under `app/`.
   **Documented exceptions:** `app/api/jobs/**` (cron + queue handlers), `app/api/blob/upload/route.ts`, `app/api/files/[id]/route.ts`, and `app/api/auth/**` are the deliberate escape hatches and import `db` directly. Don't try to "refactor" them out.
2. **All mutations use `orgAction` (or `authAction`).** Never `action` directly except for genuinely public actions. The factory enforces auth + org membership + audit context.
3. **Every action chain MUST include `.inputSchema(zodSchema)`.** `next-safe-action` does NOT enforce input validation by itself; skipping `.inputSchema()` means the action accepts any shape from the client. The static check in `scripts/check-actions.mjs` (run by `pnpm verify --tier=1`) fails the build if you forget.
4. **Soft delete only.** App-side tables have `deletedAt`/`deletedBy` columns. Delete actions set the timestamps. Queries filter `WHERE deleted_at IS NULL` by default. Hard delete happens only in `app/api/jobs/cron/purge-deleted/route.ts`. (Auth tables — `user`, `organization`, `member`, `session`, `account`, `verification`, `invitation` — are managed by Better Auth and not subject to this rule.)
5. **Every state-changing action calls `audit()`.** The action context already carries actor, IP, user agent — pass `ctx` straight through. (Not statically enforced today; see `TODO.md` C11.)
6. **Every state-changing action calls `revalidatePath()`.** Route the cache invalidation deliberately.
7. **No `console.*` in `src/` and `app/`.** Use `import { log } from "@/lib/log"` (pino). Tests, scripts, and `instrumentation*.ts` can use `console.*`. Enforced by ESLint.
8. **No default exports in `src/modules/**`and`src/lib/**`.** Named exports only. Enforced by ESLint (`no-restricted-syntax` on `ExportDefaultDeclaration`).
9. **Migrations on `main` are immutable.** Never edit a committed migration file. Generate a new one with `pnpm db:generate`.
10. **No destructive schema changes in a single migration.** Use the expand → migrate → contract pattern (see `docs/architecture.md`).
    10a. **Never hand-write a migration `.sql` from scratch, and never hand-edit a snapshot.** Schema changes go through `pnpm db:generate` so the `.sql` and the matching `meta/NNNN_snapshot.json` are written together. Drift between them is what produced the 0035→0038 snapshot stall that bit Item 2. Convention: declare RLS in TS via `pgPolicy(...)` inside the table's extra-config array + `.enableRLS()` on the table — `db:generate` emits the policy SQL and keeps the snapshot in sync. **One hand-edit is permitted**: appending `ALTER TABLE "x" FORCE ROW LEVEL SECURITY;` after the auto-generated `CREATE POLICY` (drizzle-kit emits ENABLE but not FORCE, and FORCE is what makes RLS apply to the table owner). The CI guard in `pnpm verify --tier=1` catches drift before it lands.
11. **Sage never connects to a production database from his machine.** `src/lib/db.ts` parses `DATABASE_URL` and refuses to start in development unless the host is in the local-allowlist. `scripts/seed.ts` does the same check. Production credentials live only in Vercel project env vars.
12. **Production secrets must be high-entropy and free of dev markers.** `src/lib/env.ts` rejects `BETTER_AUTH_SECRET`/`CRON_SECRET`/`QUEUE_SECRET` values containing tokens like `dev`/`local`/`test`/`changeme` when `NODE_ENV=production`. Generate fresh secrets with `openssl rand -hex 32`.

## Adding a new feature

The fastest, safest path is to copy `src/modules/items/` and rename:

1. `cp -r src/modules/items src/modules/<your-feature>`
2. Rename all `items` → `<your-feature>` and `Item` → `<YourFeature>` inside the new files. Update audit-action strings (`"items.created"` etc.) consistently with the table name.
3. Add `export * from "@/modules/<your-feature>/schema"` to `src/db/schema.ts`.
4. **If the new module has soft-delete columns, add it to the per-module lists:**
   - `tests/e2e/helpers/reset-db.ts` → append the table to `TABLES_TO_TRUNCATE`
   - `app/api/jobs/cron/purge-deleted/route.ts` → add a delete loop modeled on the existing `items` / `files` blocks
5. **Declare RLS (MANDATORY — the CI guard will fail if you skip this):**

   The new schema must carry the org-isolation RLS policy and FORCE. Confirm `items/schema.ts` is your copy source — it already has both. If for any reason they're missing, add:

   ```ts
   pgPolicy("<name>_org_isolation", {
     as: "permissive",
     for: "all",
     using: sql`organization_id = current_setting('app.current_org', true)`,
     withCheck: sql`organization_id = current_setting('app.current_org', true)`,
   }),
   ```

   and `.enableRLS()` on the table.

6. Run `pnpm db:generate`. Review the generated SQL in `src/db/migrations/`.

   **Hand-append** `ALTER TABLE "<name>" FORCE ROW LEVEL SECURITY;` to the new `.sql` file (per AGENTS.md §10a). Drizzle-kit emits `ENABLE` but not `FORCE`; without `FORCE` the BYPASSRLS owner role (neondb_owner in prod) silently bypasses RLS — the same bug class that caused the K&K / Shanzy contacts leak. The `scripts/check-rls-force.mjs` guard (run by `pnpm verify --tier=1`) fails the build if this is missing.

7. Run `pnpm db:migrate` to apply locally.
8. Add routes under `app/(app)/<your-feature>/`.
9. Add an integration test at `tests/integration/<your-feature>.test.ts`.
10. Run `pnpm verify --tier=2`. Fix anything red.

The `/new-module <name>` slash command (defined in `.claude/commands/new-module.md`) walks through the same steps. The `add-module` skill (`.claude/skills/add-module/SKILL.md`) is the canonical source — the slash command delegates to it.

## Validation commands

```bash
pnpm typecheck            # tsc --noEmit
pnpm lint                 # ESLint strict-type-checked
pnpm test:unit            # Vitest unit (fast)
pnpm test:integration     # Vitest + real Postgres (slower)
pnpm test:e2e             # Playwright golden paths
pnpm build                # Next.js production build (mirrors prod)

pnpm verify --tier=1      # typecheck + lint + check-actions + unit (pre-commit)
pnpm verify --tier=2      # tier 1 + integration + build (pre-push, CI)
pnpm verify --tier=3      # tier 2 + e2e (CI on PR)

pnpm db:generate          # generate migration from schema diff
pnpm db:migrate           # apply pending migrations
pnpm db:check             # verify schema drift (CI gate)
pnpm db:studio            # open Drizzle Studio
```

**Always** run `pnpm verify --tier=2` before declaring work complete.

## High-risk areas

Read the relevant module README before editing these:

- `src/lib/safe-action.ts` — auth and org enforcement live here. A bug here is a security bug.
- `src/lib/auth.ts` + `src/modules/auth/` — auth flows. Don't change Better Auth config without testing the full flow E2E.
- `src/lib/env.ts` — env validation, including the production-grade-secret refusal. A bug here can prevent prod from booting.
- `src/lib/blob.ts` + `app/api/blob/upload/route.ts` + `app/api/files/[id]/route.ts` — blob uploads land as **private** by default; the download proxy re-checks org membership before streaming. If you make file URLs visible in UI, ALWAYS link to `/api/files/<id>`, never to `file.url`.
- `src/modules/audit/` — the audit log is the receipt for everything. Don't add fields you don't intend to retain forever.
- `src/db/schema.ts` and `src/db/migrations/` — schema changes propagate everywhere.
- `app/api/jobs/cron/purge-deleted/route.ts` — the only place hard deletes happen. Bounded by `BATCH_LIMIT`/`PURGE_ENABLED` env vars.

## Working style

- Prefer small, incremental changes; commit each working step.
- Read the relevant files before editing.
- Prefer deepening an existing clear boundary over inventing a new layer.
- Avoid generic dumping-ground folders like `helpers`, `common`, `misc`, `shared`.
- Test behavior through module boundaries, not implementation details.
- When in doubt, follow `src/modules/items/` exactly.
