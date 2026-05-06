# Pathway Foundation — Design Spec

**Date**: 2026-05-06
**Author**: Mike Shanahan (with Claude Code)
**Status**: Draft for review

## 1. Goal

Produce an opinionated Next.js + Vercel + Postgres starter that Sage (non-technical owner) can hand off to Claude Code to rebuild Pathway from. The starter is the "ground floor": auth, orgs, app shell, deploy pipeline, and a single worked-example feature that demonstrates every pattern Sage will copy. Sage owns the repo, GitHub, and Vercel project; Mike consults as needed.

The defining constraint is **agentic-development-friendliness for a non-technical owner**: every choice optimizes for Claude Code being able to add features cleanly, and for Sage being unable to easily break the security, reliability, or quality fundamentals.

## 2. Non-Goals

- Building any Pathway product feature (flows, tasks, forms, structure, particles, files-as-first-class-product, the visual flow editor). Those are Sage's job, on top of the foundation.
- Realtime transport (websockets, SSE, KV pub/sub). Defer until Sage proves he needs it.
- Search, notifications inbox, admin/super-admin panel, MCP server. Defer.
- Stripe / billing. Defer.
- Mobile clients. Foundation does not pre-optimize for non-web consumers.

## 3. Target Workflow After Handoff

1. Mike shares the foundation repo with Sage.
2. Sage creates his own GitHub account, forks/clones the repo into his account.
3. Sage creates a Vercel account, imports the repo, attaches a Neon Postgres integration.
4. Sage runs `pnpm setup` locally; the script walks him through filling `.env.local` interactively.
5. Sage opens Claude Code in the repo and prompts feature work. The repo's `CLAUDE.md`, skills, and slash commands carry the conventions.
6. Sage pushes; pre-push runs the full check suite locally; CI re-runs and Vercel deploys a preview.
7. Sage merges to `main`; Vercel deploys to production.

Mike's consulting surface = "something didn't work" or "Claude Code is suggesting X, is that right?" — not day-to-day feature work.

## 4. Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript strict | Latest stable; Sage's prior repo was already on this version |
| Hosting | Vercel | Original ask; native to Next |
| Database | Vercel Postgres (Neon) | Native to Vercel; serverless; branching for dev/test |
| ORM | Drizzle | TS-native schema, plain SQL migrations, no engine binary, Better Auth has a first-class adapter |
| Auth | Better Auth + organizations plugin | Open source, lives in our DB, has B2B org primitives, no vendor lock |
| Email | Resend | Vercel-native partner; verification, password reset, org invites |
| Mutations | Server Actions wrapped with `next-safe-action` | Type-safe end-to-end, validation + auth + org scope enforced at the wrapper, can't define an unsafe action |
| External HTTP | Next Route Handlers + Zod | For webhooks (Better Auth, Resend) and any future external API surface |
| Client cache | TanStack Query | For non-server-action reads where revalidation isn't enough |
| Forms | React Hook Form + Zod resolver | Shares schemas with server actions |
| Validation | Zod everywhere | Inputs, env vars, webhook payloads |
| UI primitives | shadcn/ui + Tailwind v4 | Sage's existing toolkit; LLM-friendly |
| Background jobs | Vercel Cron + Vercel Queues | "As many Vercel-native features as we can" |
| File storage | Vercel Blob | Vercel-native |
| Observability | Sentry + Vercel Analytics + Speed Insights | Free tier sufficient at this stage |
| Lint / format | ESLint (`next/core-web-vitals` + `@typescript-eslint/strict-type-checked`) + Prettier | Stable rule coverage; Biome 2 not at parity for Next yet |
| Tests | Vitest (unit + integration) + Playwright (E2E golden paths) | See §10 |
| Pre-commit / pre-push | Lefthook | Tiered, see §10 |
| Env vars | `@t3-oss/env-nextjs` | Zod-validated at boot, build fails on missing |
| Package manager | pnpm | Strict, fast, lockfile committed |
| Node | 22 LTS pinned via `.nvmrc` and `engines` | |

## 5. Repo Layout

```
.
├── app/                              # routes, layouts, route handlers ONLY
│   ├── (auth)/                       # sign-in, sign-up, verify, reset, accept-invite
│   ├── (app)/                        # authenticated app shell
│   │   ├── dashboard/
│   │   ├── items/                    # worked-example feature pages
│   │   ├── settings/
│   │   │   ├── account/
│   │   │   └── organization/
│   │   └── layout.tsx                # sidebar, topbar, org switcher
│   ├── (marketing)/                  # public landing, terms, privacy
│   └── api/
│       ├── auth/[...all]/route.ts    # Better Auth handler
│       ├── webhooks/                 # third-party webhook handlers
│       └── jobs/                     # Vercel Cron + Queue handlers
├── components/
│   └── ui/                           # shadcn primitives only
├── src/
│   ├── modules/                      # ALL product logic
│   │   ├── auth/                     # Better Auth wiring, sign-in/up UI bits
│   │   ├── org/                      # org plugin wiring, members, invites UI
│   │   ├── items/                    # WORKED EXAMPLE — copy this for new features
│   │   ├── files/                    # Blob upload helper + files schema
│   │   ├── jobs/                     # cron + queue example handlers
│   │   └── audit/                    # audit() helper + schema
│   ├── lib/                          # cross-cutting low-level utilities
│   │   ├── db.ts                     # Drizzle client
│   │   ├── env.ts                    # t3-env Zod schema
│   │   ├── safe-action.ts            # next-safe-action factory with auth/org context
│   │   ├── auth.ts                   # Better Auth server instance
│   │   └── ...
│   └── db/
│       ├── schema.ts                 # re-exports module schemas, single source of truth
│       └── migrations/               # drizzle-kit generated SQL
├── tests/
│   ├── unit/                         # mirrors src/modules + src/lib
│   ├── integration/                  # actions + queries against real Postgres
│   └── e2e/                          # Playwright golden paths
├── scripts/
│   ├── setup.ts                      # interactive .env.local walkthrough
│   └── seed.ts                       # dev seed data
├── .claude/
│   ├── settings.json                 # hooks (typecheck/lint pre-tool-use, etc.)
│   ├── skills/                       # repo-local skills
│   │   ├── add-module/
│   │   ├── add-migration/
│   │   ├── add-cron/
│   │   └── add-queue-job/
│   └── commands/                     # slash commands
│       ├── new-module.md
│       ├── new-migration.md
│       ├── seed.md
│       └── deploy-preview.md
├── docs/                             # human-readable docs
│   ├── architecture.md
│   ├── handoff-checklist.md          # Sage's first-day setup
│   └── superpowers/specs/            # design specs (this file)
├── AGENTS.md                         # primary agent operating guide
├── CLAUDE.md                         # @AGENTS.md + Claude-specifics
├── lefthook.yml
├── drizzle.config.ts
├── next.config.ts
├── eslint.config.mjs
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
└── README.md                         # one-page handoff overview
```

### Module convention

Every directory under `src/modules/<name>/` exports a flat surface:

```
modules/<name>/
├── schema.ts        # Drizzle table(s); re-exported from src/db/schema.ts
├── queries.ts       # read functions (typed; takes orgId or session)
├── actions.ts       # server actions, all built via createSafeAction()
├── types.ts         # inferred + hand-rolled domain types
├── ui/              # feature-local UI (forms, lists, dialogs)
└── README.md        # what this module is for; how to extend (LLM-targeted)
```

**Rule**: no module imports from another module's internals. Cross-module use goes through the public surface (`queries.ts`, `actions.ts`, `types.ts`). Enforced by ESLint (`no-restricted-imports`).

**Rule**: nothing in `app/` calls Drizzle directly. Routes call queries; route handlers and server actions call actions. Enforced by ESLint.

## 6. Auth and Organizations

### 6.1 Better Auth setup

- `src/lib/auth.ts` — single Better Auth server instance. Drizzle adapter. Pulled from `app/api/auth/[...all]/route.ts`.
- Plugins enabled: `organization`, `emailVerification`, `magicLink`, `passkey` (optional, ship disabled but wired).
- Email transport via Resend.
- Session model: cookies (HTTP-only, secure, SameSite=Lax). Sliding expiry, 7-day refresh.

### 6.2 Multi-tenancy model

- Every **app-side** table that holds user-generated data has an `orgId` foreign key. (Better Auth's own tables — `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation` — follow Better Auth's schema and are out of scope of this rule.)
- Convention: every query and action takes `orgId` explicitly OR derives it from the session's "active org" (Better Auth's organization plugin sets this).
- `createSafeAction()` wires up `{ session, activeOrg, db }` as the action context. An action without `activeOrg` cannot access org-scoped data — enforced by the action factory's middleware.
- Roles: `owner | admin | member`. Permissions checked via a small `can(role, action)` helper in `modules/org/`.

### 6.3 Auth UI shipped

All routes under `app/(auth)/`:

- `/sign-in` — email + password, magic-link option, org-invite-aware.
- `/sign-up` — creates user; on first-login, walks through "create your organization."
- `/verify-email`, `/forgot-password`, `/reset-password`.
- `/accept-invite/[token]` — handles email-invitation acceptance.

All routes under `app/(app)/settings/`:

- `/settings/account` — name, email, password change, active sessions list, delete-account.
- `/settings/organization` — org name, slug, danger zone (transfer / delete).
- `/settings/organization/members` — list, invite by email, role change, remove.

### 6.4 Better Auth ↔ app DB

Better Auth manages its own tables (user, session, account, verification, organization, member, invitation). We add app-side tables that FK to `user.id` and `organization.id`. No mirroring layer.

## 7. Server Actions Pattern

`src/lib/safe-action.ts` exports two factories:

```ts
// Authenticated only — session required, no org scope
export const authAction = createSafeActionClient({...})

// Authenticated + org-scoped — session AND active org required
export const orgAction = createSafeActionClient({...}).use(orgScope())
```

Every action:

1. Declares a Zod input schema.
2. Receives `ctx` with `{ session, activeOrg?, db }`.
3. Returns a tagged union (`{ ok: true, data } | { ok: false, error }`).
4. Calls `audit()` for any state-changing operation (see §11).
5. Calls `revalidatePath()` or `revalidateTag()` as appropriate.

Example (the worked-example pattern):

```ts
// src/modules/items/actions.ts
export const createItem = orgAction
  .input(createItemSchema)
  .handler(async ({ input, ctx }) => {
    const item = await ctx.db.insert(items).values({
      ...input,
      orgId: ctx.activeOrg.id,
      createdBy: ctx.session.userId,
    }).returning()
    await audit(ctx, 'item.created', { itemId: item.id })
    revalidatePath('/items')
    return { ok: true, data: item }
  })
```

## 8. Database Conventions

- All **app-side** tables have: `id` (cuid2), `orgId` (where org-scoped), `createdAt`, `updatedAt`, `createdBy`, `updatedBy` (where user-attributable). Better Auth's own tables follow Better Auth's schema and are not subject to this rule.
- Soft delete only where Sage explicitly needs it; default is hard delete with cascading FKs and `audit()` records as the receipt.
- Migrations: `drizzle-kit generate` produces SQL files committed to `src/db/migrations/`. CI runs `drizzle-kit check` to catch drift. `drizzle-kit migrate` runs in a Vercel build hook.
- Indexes: ship with sensible defaults (FKs indexed, `(orgId, createdAt)` composite where lists are time-ordered).
- No raw SQL in `app/` or `modules/<name>/ui/`. All DB access via `queries.ts` / `actions.ts`.

## 9. Background Jobs

`modules/jobs/` ships with two illustrative handlers and the patterns to copy:

- **Cron**: `app/api/jobs/cron/example/route.ts` — runs daily, Vercel Cron config in `vercel.json`. Auth via `CRON_SECRET` header.
- **Queue**: `app/api/jobs/queue/example/route.ts` — Vercel Queues consumer. Producer helper in `modules/jobs/produce.ts`.

Both handlers use the same context-building helpers as actions (no session, but `db` and an idempotency key). All job runs write to `audit_log`.

## 10. Testing and CI

### 10.1 Layers

- **Unit (Vitest)** — pure logic only (validators, helpers, formatters). No DB, no network.
- **Integration (Vitest + real Postgres)** — every server action and query. Each test wraps a transaction that rolls back at teardown.
- **E2E (Playwright)** — golden paths only: sign-in, sign-up, create-org, invite-member, items CRUD. ~5 tests.

### 10.2 Static checks

- TypeScript `strict` + `noUncheckedIndexedAccess`.
- ESLint with `next/core-web-vitals`, `@typescript-eslint/strict-type-checked`, plus project rules:
  - No default exports in `src/modules/**` and `src/lib/**` (named only).
  - No imports from `src/modules/**/!(*.{ts,tsx})` siblings (enforce module surface).
  - No DB imports from `app/**` (must go through queries/actions).
  - No `console.log` in `src/**` (use `lib/log.ts`).
- `drizzle-kit check` for schema drift.

### 10.3 Tier matrix

| Tier | Trigger | Runs |
|---|---|---|
| pre-commit | every commit | typecheck (incremental), lint --fix on staged, `test:unit` |
| pre-push | every push | full typecheck, lint, `test:unit`, `test:integration`, `build` |
| CI (PR) | open/update PR | everything pre-push runs + `test:e2e` + `drizzle-kit check` + Vercel preview deploy |
| CI (main) | merge to main | same as PR + production deploy |

A single `pnpm verify` script runs everything. Lefthook tiers are thin wrappers that call `pnpm verify --tier=<n>`. CI invokes the same script. **One source of truth for "what does it mean to be passing"**.

### 10.4 Branch protection

Documented in `docs/handoff-checklist.md`: Sage toggles "require status checks" + "require PR before merging to main" in GitHub repo settings as part of first-day setup. We can't enforce this in code; it's a 30-second checkbox.

## 11. Audit Log

`modules/audit/` ships:

- `audit_log` table: `id, orgId, actorUserId, action, resourceType, resourceId, metadata jsonb, createdAt`.
- `audit(ctx, action, payload)` helper — every state-changing action and job calls this.
- A `/settings/organization/audit` page (owners + admins) for the worked-example demonstration. Sage extends or hides as he wishes.

## 12. Files

`modules/files/` ships:

- `files` table: `id, orgId, path, contentType, sizeBytes, uploadedBy, createdAt`.
- `getSignedUploadUrl(ctx, { contentType, sizeBytes })` server action.
- Example UI: drop-zone component in `modules/files/ui/upload.tsx`.
- Vercel Blob client wired in `lib/blob.ts`.

## 13. Email

`lib/email.ts` exports:

- `sendEmail({ to, subject, react })` — Resend wrapper.
- React Email templates in `src/emails/`: `verify-email`, `reset-password`, `org-invite`, `welcome`.

Better Auth is configured to call `sendEmail()` for its built-in flows. Sage extends with new templates by adding to `src/emails/` and calling `sendEmail()`.

## 14. Observability

- **Sentry**: SDK wired in `instrumentation.ts`; org+user tagging from session. Source maps uploaded on Vercel build.
- **Vercel Analytics + Speed Insights**: one-line install in root layout.
- **Logs**: `lib/log.ts` — thin pino wrapper. Server actions and route handlers log via this. Vercel captures stdout.
- No OpenTelemetry, no custom dashboards, no log drains. If Sage outgrows Vercel's built-in observability, that's a consulting moment.

## 15. Repo Conventions for Claude Code

### 15.1 Top-level docs

- `AGENTS.md` — operating guide: repo shape, placement rules, when to read what, validation commands. Short, no narrative.
- `CLAUDE.md` — `@AGENTS.md` plus Claude-specific notes (skill paths, commit conventions).

### 15.2 Repo-local skills (`.claude/skills/`)

- `add-module` — checklist + template for adding a new module (schema + actions + queries + UI + tests).
- `add-migration` — generate, review, apply.
- `add-cron` — register a new scheduled job.
- `add-queue-job` — produce + consume pattern.

### 15.3 Slash commands (`.claude/commands/`)

- `/new-module <name>` — scaffolds `src/modules/<name>/` from the items template.
- `/new-migration <description>` — runs `drizzle-kit generate`, opens the SQL for review.
- `/seed` — runs `scripts/seed.ts`.
- `/deploy-preview` — pushes branch, links to Vercel preview URL.

### 15.4 Hooks (`.claude/settings.json`)

- `PreToolUse` on `Edit|Write` to `*.ts/*.tsx` — no-op for now (placeholder for future hooks).
- `PostToolUse` after `Edit|Write` to `src/db/schema.ts` — reminds Claude to run `drizzle-kit generate`.
- `Stop` — reminds Claude to run `pnpm verify --tier=2` before declaring done.

## 16. First-Day Handoff (Sage)

Documented in `docs/handoff-checklist.md`:

1. Create GitHub account; clone the repo into your account.
2. Create Vercel account; import the repo.
3. In Vercel dashboard: add Neon Postgres integration; add Vercel Blob integration; add Vercel Queues integration.
4. Get a Resend account; add domain; copy API key.
5. Get a Sentry account (optional but recommended).
6. Locally: `pnpm install`, then `pnpm setup` — interactive walkthrough fills `.env.local`.
7. `pnpm db:push` — creates dev DB schema on your Neon dev branch.
8. `pnpm dev` — runs locally on `:3000`.
9. Open Claude Code; prompt your first feature.

## 17. Open Questions / Risks

- **Vercel Queues GA timing**: at design time (2026-05-06), Queues should be GA. If it's still beta when implementing, we either accept beta or fall back to a DB-backed queue (a `pg_jobs` table polled by cron) — the foundation handles this with a `JOB_TRANSPORT=vercel|db` env switch documented as a fallback.
- **Better Auth maturity**: Better Auth is young. If a critical bug surfaces during build, fallback is Auth.js with hand-rolled org schema. We don't pre-build the fallback, but flag it as a known risk in `docs/architecture.md`.
- **Sage's actual first feature**: until we see what Sage builds first, we don't know whether the foundation has the right shape for it. Mitigation: the items module is deliberately generic; a real product feature should fit the same pattern.

## 18. Out of Scope (Explicit)

Not shipped, not stubbed, not designed for:

- Stripe / billing
- Realtime (websockets, SSE, KV pub/sub)
- Search (Postgres FTS, Algolia, Typesense)
- Notifications inbox
- Admin / super-admin panel
- MCP server interface
- Mobile clients / non-web consumers
- i18n / l10n
- A/B testing infrastructure
- Feature flags
- Multi-region

Each of these is a "consulting moment" if Sage decides he needs it.
