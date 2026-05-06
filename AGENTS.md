# Pathway Foundation — Agent Operating Guide

This is the playbook every coding agent in this repo follows. Read this first.

## What this repo is

A Next.js 16 + Postgres + Vercel foundation that Sage will build the Pathway product on top of. The defining design constraint is **agentic-development friendliness for a non-technical owner**: every decision optimizes for an LLM agent being able to add features cleanly, and for the human owner being unable to easily break the security, reliability, or quality fundamentals.

## What to read before editing

1. **This file.**
2. **`docs/architecture.md`** for the deeper "why" behind the conventions.
3. **The README of the module you're touching** (e.g., `src/modules/items/README.md`).
4. **`docs/handoff-checklist.md`** if the user is asking about deployment or first-day setup.

## Layout

```
app/                          # routes only — layouts, pages, route handlers
  (auth)/                     # public sign-in / sign-up / verify / reset / accept-invite
  (app)/                      # authenticated app shell
  (marketing)/                # public pages (home, terms, privacy)
  api/                        # auth handler, webhooks, jobs
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

## Hard rules

These are enforced by lint, types, hooks, or CI. Don't try to work around them — fix the underlying issue.

1. **No DB access from `app/`.** Routes call `queries.ts` for reads and `actions.ts` for writes. ESLint blocks direct `drizzle-orm` and `@/db/*` imports outside `src/modules/**` and `src/lib/**`.
2. **All mutations use `orgAction` (or `authAction`).** Never `action` directly except for genuinely public actions. The factory enforces auth, org membership, input validation, and audit context.
3. **Soft delete only.** App-side tables have `deletedAt`/`deletedBy` columns. Delete actions set the timestamps. Queries filter `WHERE deleted_at IS NULL` by default. Hard delete happens only in `app/api/jobs/cron/purge-deleted/route.ts`.
4. **Every state-changing action calls `audit()`.** The action context already carries actor, IP, user agent — pass `ctx` straight through.
5. **Every state-changing action calls `revalidatePath()`.** Route the cache invalidation deliberately.
6. **No `console.log` in `src/`.** Use `import { log } from "@/lib/log"`. Tests can use `console.*`.
7. **No default exports in `src/modules/**`and`src/lib/**`.** Named only.
8. **Migrations on `main` are immutable.** Never edit a committed migration file. Generate a new one.
9. **No destructive schema changes in a single migration.** Use the expand → migrate → contract pattern (see `docs/architecture.md`).
10. **Sage never connects to a production database from his machine.** `src/lib/db.ts` enforces this in development. Run `docker compose up -d` for local Postgres.

## Adding a new feature

The fastest, safest path is to copy `src/modules/items/` and rename:

1. `cp -r src/modules/items src/modules/<your-feature>`
2. Rename all `items` → `<your-feature>` and `Item` → `<YourFeature>` inside the new files.
3. Add `export * from "@/modules/<your-feature>/schema"` to `src/db/schema.ts`.
4. Run `pnpm db:generate`. Review the generated SQL in `src/db/migrations/`.
5. Run `pnpm db:migrate` to apply locally.
6. Add routes under `app/(app)/<your-feature>/`.
7. Add an integration test at `tests/integration/<your-feature>.test.ts`.
8. Run `pnpm verify --tier=2`. Fix anything red.

Slash commands automate steps 1-3: `/new-module <name>`.

## Validation commands

```bash
pnpm typecheck            # tsc --noEmit
pnpm lint                 # ESLint strict-type-checked
pnpm test:unit            # Vitest unit (fast)
pnpm test:integration     # Vitest + real Postgres (slower)
pnpm test:e2e             # Playwright golden paths
pnpm build                # Next.js production build (mirrors prod)

pnpm verify --tier=1      # typecheck + lint + unit (pre-commit)
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
- `src/modules/audit/` — the audit log is the receipt for everything. Don't add fields you don't intend to retain forever.
- `src/db/schema.ts` and `src/db/migrations/` — schema changes propagate everywhere. Use the slash command + review the SQL.
- `app/api/jobs/cron/purge-deleted/route.ts` — the only place hard deletes happen. Test changes carefully.

## Working style

- Prefer small, incremental changes; commit each working step.
- Read the relevant files before editing.
- Prefer deepening an existing clear boundary over inventing a new layer.
- Avoid generic dumping-ground folders like `helpers`, `common`, `misc`, `shared`.
- Test behavior through module boundaries, not implementation details.
- When in doubt, follow `src/modules/items/` exactly.
