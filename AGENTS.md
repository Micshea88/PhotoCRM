# Pathway Foundation — Agent Operating Guide

This is the playbook every coding agent in this repo follows. Read this first.

## What this repo is

A Next.js 16 + Postgres + Vercel foundation that Sage will build the Pathway product on top of. The defining design constraint is **agentic-development friendliness for a non-technical owner**: every decision optimizes for an LLM agent being able to add features cleanly, and for the human owner being unable to easily break the security, reliability, or quality fundamentals.

## Product positioning — HYBRID CRM + Project Management (LOCKED)

**Pathway is a hybrid CRM + Project-Management product, ~50/50 (up to 60/40), not a CRM with PM bolted on.** It serves photographers who manage BOTH the client relationship / sales side (leads, inquiries, proposals, contracts, payments) AND project delivery (sessions, weddings, post-production, edits, gallery delivery). Both halves are first-class.

**Consequence for design decisions:** the CRM default is NOT automatically correct. When the relationship/sales convention and the project-delivery convention differ, **surface BOTH and let Mike choose** — do not silently pick the CRM pattern. Pathway is hybrid by design.

- Precedent (2026-06-19): the task color system added a 3-day yellow "due soon" state — a **PM pattern** (Asana/ClickUp) that HubSpot/Salesforce don't do — because it serves photographers managing project deadlines, not just sales pipelines. Mike chose the PM pattern explicitly.

See `docs/pathway-design-system.md` §0 for the design-doc statement of this principle.

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
5. Run `pnpm db:generate`. Review the generated SQL in `src/db/migrations/`.
6. Run `pnpm db:migrate` to apply locally.
7. Add routes under `app/(app)/<your-feature>/`.
8. Add an integration test at `tests/integration/<your-feature>.test.ts`.
9. Run `pnpm verify --tier=2`. Fix anything red.

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
