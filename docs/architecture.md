# Architecture overview

This is the long-form companion to `AGENTS.md`. It explains _why_ the conventions exist, so an agent (or human) can make judgment calls when an edge case doesn't fit neatly.

## The defining constraint

Pathway will be built and maintained by a non-technical owner using Claude Code. Every decision in this foundation optimizes for two things:

1. **The agent can write features by pattern-matching one example.** The `items` module is the canonical pattern. Every feature module follows it.
2. **The owner can't break the security/reliability fundamentals by accident.** Lint rules, type-checks, hooks, the safe-action factory, and the immutable migration rule are guard rails — not suggestions.

If a convention here makes a feature harder to build, the convention wins. The foundation gives up some flexibility in exchange for predictability.

## Layout, in three rules

1. **`app/` is for routing only.** Layouts, pages, route handlers. Never put business logic or DB calls here.
2. **`src/modules/<name>/` is for product logic.** One module per concept. Each module exposes a flat surface (`schema.ts`, `queries.ts`, `actions.ts`, `types.ts`, `ui/`). No deeper hierarchy.
3. **`src/lib/` is for infrastructure.** Cross-cutting utilities used by multiple modules: env, db, auth, safe-action, blob, email, log.

You will never need a fourth layer. If you feel like you do, the right answer is almost always to make a new module or to inline the abstraction.

## Why server actions wrapped with `next-safe-action`

Vanilla server actions are a foot-gun: it's easy to forget input validation, auth checks, and org scoping. Each missing check is a security bug.

`safeAction.ts` exposes three factories:

- `action` — no auth (rare; only public mutations)
- `authAction` — requires a session
- `orgAction` — requires session + active org membership

Every factory enforces:

- Zod-validated input
- Auth context populated automatically (`session`, `db`, `ipAddress`, `userAgent`)
- For `orgAction`: org membership check + `activeOrg` in context
- Consistent `ActionError` taxonomy with safe error messages
- Sentry capture on unexpected errors (Phase 9)

You literally cannot define an action without input validation + the right auth tier. Sage doesn't have to remember to be careful — the type system remembers for him.

## Why soft delete is the only delete path

In a multi-tenant B2B SaaS, the worst-case scenarios involve data loss:

- "Customer accidentally deleted their workflow"
- "We deleted the wrong record on a migration"
- "An org was deleted and nobody can restore it"

Hard deletes make these unrecoverable. Soft deletes plus a 90-day cron purge mean:

- A "delete" is reversible for 90 days via `restore<Resource>`.
- The audit log records who deleted what when.
- `ON DELETE RESTRICT` on FKs means accidental org-level cascading deletes are impossible.
- Storage cost is bounded by the retention window.

The cron at `app/api/jobs/cron/purge-deleted/route.ts` is the **only** place hard deletes happen.

## Why the items module is the template

The Pathway product domain has many entities (flows, tasks, forms, particles, etc.). Sage will create dozens of modules. The cost of each new module being slightly different is high — Claude Code agents work best when they can copy a known-good pattern.

`src/modules/items/` is intentionally generic and minimal. It demonstrates:

- Schema with the standard lifecycle columns
- Soft-delete-respecting queries
- All four actions (create, update, delete, restore) using `orgAction`
- Audit logging
- Path revalidation
- A simple form pattern using RHF + Zod (with proper input/output type handling)
- A delete confirmation pattern
- A list-detail-edit route triplet

Sage adds a feature by copying it verbatim and renaming. The slash command automates this.

## Why Better Auth (not Clerk, not NextAuth)

We considered three:

- **Clerk** — hosted, paid, excellent DX. Rejected because: vendor lock and cost at scale.
- **NextAuth/Auth.js** — popular, good Next integration. Rejected because: organization/multi-tenancy support is DIY (every app builds its own membership schema), and we wanted a built-in primitive.
- **Better Auth** — open source, lives in our Postgres, organization plugin gives us multi-tenancy out of the box. Chosen.

Tradeoff: Better Auth is younger than Auth.js. We accept that for the data ownership and the org primitive.

## Why local Postgres via Docker, not a Neon dev branch

Sage is non-technical. The strongest possible safety rail is "you literally cannot connect to production from your laptop." That rail requires:

- Production credentials live only in Vercel (never `.env.local`).
- Local development uses a local DB only.
- A startup guard refuses to boot in development against any non-localhost URL.

Docker Compose gives Sage a local Postgres in one command. He never sees a production connection string. When he needs to inspect production data, he comes to Mike.

## Schema migration strategy

Drizzle's file-based migrations are linear, plain SQL, committed to git. The strategy is:

1. **Edit `src/db/schema.ts` (or a module's `schema.ts`).**
2. **`pnpm db:generate`** produces a numbered SQL file. Read it.
3. **`/migration-review`** invokes Claude Code to flag destructive operations.
4. **`pnpm db:migrate`** applies pending migrations locally.
5. **CI runs the same migrations against the test Postgres** before tests.
6. **Vercel runs `drizzle-kit migrate` before `next build`** on every deploy via `pnpm vercel-build`. If migrations fail, the deploy fails atomically; the previous version stays live.

### Hard rules

- **Migrations on `main` are immutable.** Never edit a committed migration file. Always create a new one.
- **No destructive operations in a single migration.** Use the **expand → migrate → contract** pattern:
  1. **Expand**: add the new column / table; deploy code that writes to both.
  2. **Migrate** (later release): backfill data; deploy code that reads from new only.
  3. **Contract** (later release): drop the old column / rename / cleanup.

This pattern is slow (it takes 2-3 deploys for a breaking change), but it makes deploys boring. A "breaking" schema change can never bring down the app, because the old code keeps working until the new code is deployed.

### What's deliberately not in scope

- Automatic rollback of failed prod migrations. Postgres rolls back per-migration where it can.
- Online schema migration tools (gh-ost). Postgres's online ALTER is fast enough at our expected scale.
- Zero-downtime guarantees beyond the expand-migrate-contract pattern.

## Why the audit log

Every state-changing action writes to `audit_log`. That gives us:

- A receipt for compliance ("show me everything that touched this customer's data")
- A debugging tool ("who changed this and when")
- A starting point for incident reconstruction ("what was happening at 14:00 UTC?")

The audit log captures `actorUserId`, `organizationId`, `action`, `resourceType`, `resourceId`, `metadata`, `ipAddress`, `userAgent`, `createdAt`. The safe-action middleware passes IP and user-agent through automatically.

The `audit_log` table is itself never deleted (the purge cron leaves it alone).

## Why CI runs the same checks as pre-push

`pnpm verify` is one script with three tiers (1 = fast, 2 = full local, 3 = + E2E). Every checkpoint runs the same script:

- `pre-commit` (lefthook) → `tier=1`
- `pre-push` (lefthook) → `tier=2`
- CI on PR → `tier=2` + a separate `e2e` job

This means "what does it mean to be passing?" has one answer. CI doesn't run a different command than the developer's local. There's no "but it works on my machine" moment.

## Things deliberately not in this foundation

These are out of scope. If Sage decides he needs them, that's a consulting moment.

- **Stripe / billing.** Plenty of starter projects show how to wire it.
- **Realtime** (websockets, SSE, Vercel KV pub/sub). Pathway runs _human_ workflows; the real-time-ness is people clicking buttons, not durable code.
- **Search** (Postgres FTS, Algolia, Typesense). Add when the data shape is clear.
- **Notifications inbox** (in-app notifications). Easy to add per-feature when needed.
- **Admin / super-admin panel.** Premature.
- **MCP server interface.** The previous repo had one; it can be reintroduced after the product is real.
- **Mobile clients.** Not optimizing for non-web consumers.
- **i18n / l10n.** Add when needed.
- **A/B testing / feature flags.** Same.
- **Multi-region.** Same.

Each was specifically considered and excluded. Don't reintroduce them without an explicit decision.
