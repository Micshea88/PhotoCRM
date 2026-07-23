# Pathway Foundation — Audit Punch List

Findings from the multi-agent audit on 2026-05-06.

**Status as of 2026-05-06 (post-hardening pass):** all Critical items, most High items, and several Medium items resolved. Open items remain documented below for follow-up. `pnpm verify --tier=2` and `pnpm test:e2e` are green.

Tags: `[sec]` security · `[db]` database/migrations · `[ci]` CI/verification · `[obs]` observability · `[dx]` agent ergonomics · `[prod]` production-readiness · `[docs]` documentation

---

## CRITICAL — Fix before any real customer data

- [x] **C1** `[sec]` `purgeBlob` was a public RPC. Removed entirely (it was dead code; the cron uses `blob.del()` directly).
- [x] **C2** `[sec]` Blobs now upload as `access: "private"`. Default in `src/lib/blob.ts`. To override for genuinely public files, pass `{ access: "public" }`.
- [x] **C3** `[sec]` Blob upload validates `pathname` is a clean basename (no slashes, no `..`). With `addRandomSuffix: true` the resulting URL is unique and unguessable. New download proxy at `app/api/files/[id]/route.ts` re-checks org membership before streaming.
- [x] **C4** `[sec]` `verifyCronAuth` and `verifyQueueAuth` use `crypto.timingSafeEqual`. Cron also requires `User-Agent: vercel-cron/...` in production.
- [x] **C5** `[sec]` Env validator `productionGradeSecret` rejects dev markers + low-entropy strings. Gated to `VERCEL_ENV === "production"` so local builds aren't tripped.
- [x] **C6** `[sec]` `AUTH_REQUIRE_EMAIL_VERIFICATION` env var removed. `requireEmailVerification` is hard-coded `env.NODE_ENV === "production" && process.env.PLAYWRIGHT_E2E !== "1"`. The PLAYWRIGHT_E2E escape hatch is set only by `playwright.config.ts`.
- [x] **C7** `[sec]` Static check at `scripts/check-actions.mjs` (run by `pnpm verify --tier=1`) fails the build if any `orgAction(...)` chain is missing `.inputSchema(`. AGENTS.md hard rule #3 documents the requirement.
- [x] **C8** `[ci]` CI now runs `pnpm db:migrate` and `pnpm db:check` before tests. Postgres-isn't-reachable preflight added to `verify.mjs`.
- [x] **C9** `[db][prod]` `vercel-build` is now `node scripts/vercel-build.mjs`, which only runs migrations when `VERCEL_ENV === "production"`. Preview deploys never migrate.
- [x] **C10** `[db]` `pnpm db:push` removed from `package.json`. README quick-start uses `pnpm db:migrate`.
- [x] **C11** `[ci][dx]` AGENTS.md hard rules now backed by lint/CI:
  - [x] `eslint.config.mjs` bans default exports in `src/modules/**` and `src/lib/**` via `no-restricted-syntax`.
  - [x] `no-restricted-imports` now blocks `drizzle-orm` (bare + subpath), `@/lib/db`, `@/db`, `@/db/*`, and `@/modules/*/schema` from `app/**`. Documented exceptions: `app/api/jobs/**`, `app/api/files/**`, `app/api/blob/**`, `app/api/auth/**`.
  - [x] `check-actions.mjs` enforces `.inputSchema(...)` on every action chain.
  - [x] `check-actions.mjs` also enforces `audit()` on every action (policy 9 / hard rule #5) — an action must call `audit()` or sit in the `AUDIT_EXEMPT` registry with a reason; the registry is guarded against stale entries. Closes the "audit-on-mutate static enforcement" High item. _(2026-07-20)_
  - [x] AGENTS.md updated with the cron/queue/blob exception spelled out.
- [x] **C12** `[prod]` `src/modules/jobs/queue.ts` now carries a loud header marking the queue as a non-durable stub and logs a warn on every production enqueue. Skill docs and README will be updated to point at Vercel Queues / Inngest / Trigger.dev as the real swap-in.

---

## HIGH — Before launch / public users

### Database & deployment

- [x] **H1** `[db]` `purge-deleted` cron is now bounded (`PURGE_BATCH_LIMIT`, default 1000), per-resource, with an audit row written before the delete. `PURGE_ENABLED` env var is the kill-switch. `RETENTION_DAYS` is configurable.
- [x] **H2** `[db]` `scripts/seed.ts` now imports `assertDatabaseIsLocal` from `src/lib/db.ts` and refuses to run unless `DATABASE_URL` host is in the local-allowlist.
- [x] **H3** `[db]` `assertDatabaseIsLocal` parses the URL with `new URL()` and matches `hostname` against an exact allowlist (`localhost`, `127.0.0.1`, `::1`, `db`, `postgres`).
- [x] **H4** `[db]` Pool now has `idleTimeoutMillis: 30s`, `connectionTimeoutMillis: 5s`, `statement_timeout=30s`, `lock_timeout=5s`.
- [ ] **H5** `[prod]` `pg.Pool` not Vercel-aware on Neon. **Open.** Document that runtime needs the **Pooled** Neon connection string, migrations need the **Direct** one. Or switch runtime to `@neondatabase/serverless` (HTTP). `docs/deployment.md` covers the choice but defaults aren't enforced.
- [ ] **H6** `[db]` Items/files indexes are not partial. **Open.** Add `.where(isNull(t.deletedAt))` on the index builder; regenerate migration.
- [ ] **H7** `[db]` `verification.expires_at` and `invitation.expires_at` unindexed. **Open.** Add indexes; regenerate migration. (Better Auth's prune queries seq-scan today.)
- [ ] **H8** `[db]` `user.email` unique is case-sensitive. **Open.** `citext` extension OR `lower(email)` unique index.

### Security

- [x] **H9** `[sec]` Better Auth's built-in rate limiter is enabled in production with `customRules` for sign-in, sign-up, password reset, verify-email, invitation flows. Storage is in-memory by default — fine for single-region deploys; document switching to a shared store if scaling out. (BA's OWN limiter is still in-memory — open. But a shared, env-gated **multi-region `RateLimitStore` now exists**: `src/lib/outbound/upstash-store.ts`, built for the outbound gateway (2026-07-22); the auth layer can reuse it when we scale to multi-region.)
- [ ] **H10** `[sec]` Auth events not in audit log. **Open.** Wire Better Auth `databaseHooks` / `hooks.after` to call `audit()` for sign-in, password-reset, invite-accepted, session-revoked.
- [x] **H11** `[sec]` Blob upload MIME whitelist is now explicit: `image/{png,jpeg,webp,gif,svg+xml}`, `application/pdf`, `text/{plain,csv}`. No glob.
- [x] **H12** `[sec]` `/accept-invite` added to `PUBLIC_ROUTES`.
- [x] **H13** `[sec]` Password policy: **min 8 + composition** (client + server-side via `src/modules/auth/password-policy.ts` + Better Auth `before` hook) and **HIBP k-anonymity breach screening** (`haveIbeenPwned` plugin) both wired. _(2026-07-21)_
- [~] **H14** `[sec]` Verification/reset tokens. **Daily expired-token prune cron DONE** (`/api/jobs/cron/prune-auth-tokens`, 04:45 UTC). **Hashing DEFERRED:** BA 1.6.9 has no `advanced.hashToken` toggle and no clean hook to hash the reset-token identifier without overriding its internal reset flow (risky on a security-critical path). Residual risk is low — reset token is a 24-char high-entropy random string, 1h expiry, now pruned; email-verify uses stateless JWTs (never in the DB). Revisit on a BA upgrade that restores the toggle, or via a custom adapter. _(2026-07-21)_
- [x] **H15** `[sec]` `verifyCronAuth` now also requires `User-Agent: vercel-cron/...` in production.

### Observability

- [x] **H16** `[obs]` `NEXT_PUBLIC_SENTRY_DSN` declared in `client` block of `env.ts`, added to `.env.example` and `setup.ts`. `instrumentation-client.ts` reads it.
- [x] **H17** `[obs]` `withSentryConfig` includes `widenClientFileUpload` and `sourcemaps.deleteSourcemapsAfterUpload`. `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` declared in env + setup.
- [x] **H18** `[obs]` `sentry.edge.config.ts` differs from `sentry.server.config.ts` (lower trace sample, empty integrations to avoid Node-only).
- [x] **H19** `[obs]` Pino now redacts `password`, `token`, `secret`, `authorization`, `cookie`, etc. with `[redacted]` censor.
- [x] **H20** `[obs]` `safe-action.ts` calls `Sentry.captureException(e)` and `log.error(...)` instead of `console.error`.

### Agent ergonomics

- [x] **H21** `[dx]` Both the `add-module` skill and `/new-module` command now include the steps to update `tests/e2e/helpers/reset-db.ts` and `app/api/jobs/cron/purge-deleted/route.ts`. The PostToolUse hook also reminds about this when a new module schema is created.
- [x] **H22** `[dx]` PostToolUse hook matcher is now `Edit|Write|MultiEdit`.
- [x] **H23** `[docs]` Module READMEs added for `audit`, `auth`, `org`. Files README updated for the private-blob switch.
- [x] **H24** `[docs]` `(marketing)/` removed from AGENTS.md layout (it didn't exist; ambiguity removed).
- [x] **H25** `[docs]` `proxy.ts` now has a header comment explaining it's the Next 16 rename of middleware.ts and must NOT be renamed. AGENTS.md layout block calls this out too.
- [x] **H26** `[dx]` Items + files modules now use plural-matches-table-name audit strings (`items.created`, `files.uploaded`). Skill docs updated.
- [x] **H27** `[dx]` Stop hook now only fires when there are uncommitted changes under `src/`, `app/`, `tests/`, or `scripts/`.
- [x] **H28** `[dx]` `/new-module` slash command now delegates to the `add-module` skill instead of duplicating the checklist.

### Production

- [x] **H29** `[prod]` `/api/blob/upload` throws on missing `size` (no more silent 0-byte rows).
- [x] **H30** `[prod]` `vercel.json` now sets `"regions": ["iad1"]`. Documented in `docs/deployment.md` to keep this in sync with Postgres region.
- [x] **H31** `[docs]` `docs/deployment.md` is now a real runbook: env-var table, Preview-DB isolation, source-map upload, smoke tests, branch protection, billing alerts, rollback, common failures.
- [x] **H32** `[obs]` Heartbeat cron now also reports `dbMs` and returns 503 on DB ping failure (still scoped — real synthetic monitoring belongs elsewhere, documented).
- [x] **H33** `[prod]` Handoff checklist reorders: Resend domain verification BEFORE first sign-up.

### Verification gaps

- [ ] **H34** `[ci]` Lefthook still runs full `pnpm typecheck` pre-commit. **Open.** Switch to lint+format+unit pre-commit; reserve full typecheck for pre-push.
- [x] **H35** `[ci]` `verify.mjs` now runs a TCP preflight against `DATABASE_URL` host:port and prints a friendly "run `docker compose up -d` first" if Postgres is unreachable.
- [ ] **H36** `[ci]` No tests assert org-isolation through the `orgAction` factory directly. **Open.** Add integration tests that mock sessions for orgA and attempt cross-org access.
- [x] **H37** `[ci]` `post-edit.mjs` hook now warns hard when a committed migration file is edited (calls out AGENTS.md hard rule #9).
- [ ] **H38** `[ci]` Branch protection settings are documented in `docs/deployment.md` §4 and `docs/handoff-checklist.md` §2 — but they live in GitHub UI, not in code. Sage must enable them by hand.

---

## MEDIUM — Polish before launch

- [ ] **M1** `[dx]` `tsconfig` path aliases overlap confusingly. **Open.**
- [ ] **M2** `[ci]` `@types/node@^25` while runtime is Node 22. **Open.** Pin `@types/node@^22`.
- [ ] **M3** `[ci]` `pnpm install` succeeds with Node 20 (only warns). **Open.** Add `engine-strict=true` to `.npmrc`.
- [ ] **M4** `[ci]` `vitest.config.ts` has `resolve.tsconfigPaths: true` which is not a real Vite option. **Open.** Tests pass for now (vitest 4 may have native resolution); install `vite-tsconfig-paths` if integration breakage shows up.
- [ ] **M5** `[db]` `restoreItem` clears `deletedBy` to `null`. **Open.**
- [ ] **M6** `[db]` `organization` and `user` have no `deletedAt`. **Resolved-ish:** AGENTS.md hard rule #4 now narrows the scope ("auth tables managed by Better Auth are exempt"). Closing.
- [ ] **M7** `[db]` `tests/helpers/db.ts` creates a fresh Pool per `withTestDb` call. **Open.** Module-level singleton would be faster.
- [ ] **M8** `[db]` `items.status` is enum but unindexed. **Open.**
- [ ] **M9** `[db]` Files schema `onDelete: "restrict"` on `organizationId`. **Resolved-ish:** documented in `src/modules/org/README.md` as deliberate.
- [ ] **M10** `[ci]` `*.config.ts` ignored by ESLint. **Open.**
- [x] **M11** `[ci]` `console.warn` and `console.error` no longer allowed in `src/` and `app/`. `tests/`, `scripts/`, and `instrumentation*.ts` are exempt.
- [ ] **M12** `[ci]` `scripts/**` is `no-restricted-imports` exempt. **Open.** `seed.ts` already has the localhost guard.
- [x] **M13** `[prod]` `setup.ts` now prompts for `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`.
- [x] **M14** `[dx]` `next.config.ts` has `experimental.optimizePackageImports: ['lucide-react']`.
- [ ] **M15** `[ci]` Pre-commit `git add {staged_files}` after auto-fix breaks partial commits. **Open.**
- [x] **M16** `[prod]` `vercel-build` migration step gated to `VERCEL_ENV === "production"`. (`db:check` preflight not yet — open.)
- [ ] **M17** `[prod]` `DATABASE_URL` uses `sslmode=require` (or `prefer`/`verify-ca`) — currently aliased to `verify-full` by pg-connection-string@2 but reverts to weaker libpq semantics in pg@9 / pg-connection-string@3. **Open.** Change all Vercel env tiers to explicit `sslmode=verify-full` before bumping pg.
- [ ] **M18** `[dx]` Sign-in form auto-picks the user's first org via `authClient.organization.list()[0]` if no active org is set on the session. V1 architecture (Push 2c.6.11 commit C) enforces one-email-one-org at invite-creation time so this "first" pick is the unique membership in practice. **Open** for V2 when account-linking lands. Was Push 2c.6.11 Old Commit B's target before scope-revert; revisit alongside V2 account-linking.
- [ ] **M19** `[dx][prod]` Account-linking feature: let one email belong to multiple orgs with an in-app switcher to flip between them, plus a per-user `last_active_organization_id` preference so sign-in restores the previously-active org. Deferred to V2 — V1 ships the one-email-one-org constraint (Push 2c.6.11 commit C) and rejects cross-org invites at creation time. When this lands: relax the constraint in `src/modules/rbac/actions.ts:assertOneEmailOneOrg`; resurrect the persistence + switcher pattern from the Push 2c.6.11 Old-Commit-B revert (`cef8666`). Surface as a single product decision once we have a real customer who needs it.

---

## LOW — Nice-to-have

- [x] **L1** `tsconfig.tsbuildinfo` cleaned + `test-results/` removed before this commit.
- [ ] **L2** `audit_log.metadata` is jsonb of arbitrary user input. Documented in `src/modules/audit/README.md`.
- [ ] **L3** `items.updatedAt` set both via `$onUpdate` and explicitly. Pick one. **Open.**
- [ ] **L4** Add boot-time check that `BETTER_AUTH_URL` starts with `https://` in production. **Open.**
- [ ] **L5** ESLint ignores `.claude/**`. **Open.**
- [ ] **L6** `.env.local` placeholder values look real. **Open.** Prefix with `LOCAL_DUMMY_`.
- [ ] **L7** Open-redirect risk on sign-in `redirect` param — verify the sign-in page validates `redirect` is same-origin.
- [x] **L8** `proxy.ts` now has a comment header explaining what it does and does not do.

---

## Suggested next-pass order (if Sage's first feature wave goes well)

1. **H10** wire auth events to audit log (make the audit promise complete).
2. **H6 / H7** partial indexes + expires_at indexes (DB performance ratchet).
3. **H14** hash verification tokens at rest.
4. **H13** password breach-corpus check via HIBP.
5. **H36** integration test for cross-org isolation through `orgAction`.
6. **C12 follow-through** — replace the queue stub with a Postgres outbox or Inngest before the first feature that genuinely needs durable async work.

Everything else can wait.
