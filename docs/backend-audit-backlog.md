# Backend Audit Backlog

Tracked home for the backend audit's red bugs, the policy items destined for `AGENTS.md`, and
the standard gaps — so this security work survives session/transcript loss.

**Companions:** `docs/multi-tenant-remediation-plan.md` (RLS enforcement model + table coverage),
`docs/decisions-since-may-docs.md` (decision ledger), `docs/decisions-2026-07-16.md` (planning
session — elaborates the 12 policies + the A2 merge + auth-resilience decisions), `TODO.md`
(foundation punch list).

**Status legend:** 🔴 not started · 🟡 in progress · ✅ done · ⊘ superseded.

Line numbers verified against `main` @ `48f333c` (post-reskin-merge, 2026-07-15). The original
audit's line numbers predate the reskin and have shifted — the ranges here are re-verified.

---

## Corrections to prior premises — READ FIRST

Two claims from earlier transcripts are **wrong** and must not be re-inherited.

### C1 — "RLS tests pass vacuously in CI" is INVERTED (measured 2026-07-14/15)

The wall IS standing. Measured:

- **Under `pathway_app`** (the real dev connection role — NOBYPASSRLS): the RLS suite is
  **genuine + GREEN** (e.g. `terminology-rls.test.ts` 4/4). Isolation is truly enforced.
- **Under `postgres`** (superuser/bypass): **109 fail / 56 pass** — the isolation assertions
  themselves fail (`expected 0, received 7`: a cross-org `SELECT` returns other orgs' rows)
  because bypass ignores RLS. So most tests **correctly detect** the bypass; they do **not**
  pass vacuously. (56 weak-assertion tests do pass under bypass — those are the only genuinely
  vacuous ones.)

**What was actually unresolved — now SOLVED:** why is CI green if `ci.yml:19` connects as
`postgres`? Because **GitHub Actions has never run on this repo.**
`GET /repos/Micshea88/PhotoCRM/actions/runs` → `total_count: 0`;
`GET /commits/48f333c/status` → a single check, context **`Vercel`** ("Deployment has completed").
The green check is **Vercel's build only** (`next build` — no integration tests). The
`verify --tier=2` job in `ci.yml` (which would run the RLS suite) **never executes**. The suite
runs **only in the local pre-push hook**, as `pathway_app` → genuine + green. So `ci.yml`'s
`DATABASE_URL=postgres` is moot. **This is worse than "wrong role": the suite does not gate
remote CI at all.** (Feeds A1.)

### C2 — Production lockout (2026-07-14) was a URL/origin problem, NOT email/verification

Mike was signing in on the **raw per-deploy hostname** (`photo-ib93uztv1-…vercel.app`) instead of
`photo-crm-three.vercel.app`. In production Better Auth trusts **only the exact `BETTER_AUTH_URL`
origin** (`src/lib/auth-origins.ts` → `trustedOrigins = [betterAuthUrl]` when `vercelEnv !==
"preview"`), so every auth POST from the wrong hostname **403'd — both `sign-in/email` AND
`request-password-reset`**. Reset "sent no email" because it was rejected at the door and never
reached Resend. **Account, password, and data were always fine.** The earlier
email-unverified / Neon-flip diagnosis was **wrong** — do not re-chase it. See memory
`prod-auth-origin-and-custom-domain`. Deferred follow-ups: (a) verify a reset email delivers
end-to-end from the correct URL; (b) get a real custom domain (no custom domain today; the
multi-alias + single-trusted-origin setup is the root of this 403 class, required before customer
signup).

### C3 — every "CI-enforced" claim in this repo is really a LOCAL pre-push hook (2026-07-15)

GitHub Actions has never run on this repo (see C1). So every doc that says a guard is
"CI-enforced" is, today, only enforced by the **local `lefthook` pre-push hook on the pusher's
machine** — not by any remote required check. A future reader must not believe the repo is gated
when only the pusher's laptop is. Known affected claims:

- **Policy item 9** ("`audit()` … CI-enforced via `check-actions.mjs`") — local hook only.
- The **multi-tenant isolation guard** / RLS suite — local hook only (this whole investigation).
- `docs/multi-tenant-remediation-plan.md` and any other doc using "CI"/"CI-enforced" language for
  a check that lives in `pnpm verify` — same caveat.

This is **fixed by A1b** (enable Actions + require the check on `main`). Until A1b lands, treat
every "CI-enforced" phrase as "pre-push-hook-enforced, pusher-local, not remotely gated."

---

## The 3 🔴 red bugs

### A1 — CI RLS tests: role + the CI-doesn't-run divergence — ✅ A1a BUILT (commit 41756e8); A1b remaining = user's GitHub clicks

**A1a shipped 2026-07-19 (commit `41756e8`, branch `fix/backend-red-bugs`).** All items 1–4, 6, 7 below
done: both shared helper families (`tests/helpers/rls.ts` `withRawOrgContext`/`withRawClient` AND
`tests/helpers/db.ts` `withTestDb`) now `SET LOCAL ROLE app_authenticated` as the first statement;
read + write paths covered; `rls-cross-org.test.ts` rewritten to assert the connection-independent
invariant (`current_user=app_authenticated`, `rolbypassrls=false`, `is_superuser=off`) that goes red if
the switch is removed, and to guard the escalation assertion on session privilege. **Before/after: under
a `postgres` bypass connection the suite went 109 fail → 0; 165/165 under both `pathway_app` and
`postgres`.** Item 5 (make CI actually run) is A1b — see below; needs no `ci.yml` change, only the
GitHub enable/require clicks (the fork-default-disabled fix).

**Evidence.** Runtime is correct: `src/lib/safe-action.ts:210` (write) and
`src/lib/org-context.ts:122` (read) both `SET LOCAL ROLE app_authenticated` then
`set_config('app.current_org', …, true)` (transaction-local, not bare `SET`). The **test helpers**
are the gap: `tests/helpers/rls.ts` — `withRawOrgContext` (:21) and `withRawClient` (:67) set the
GUCs but **never `SET LOCAL ROLE app_authenticated`**, so they execute as the connecting role.
`app_authenticated` is `NOBYPASSRLS NOLOGIN` (migration `0041`) — it can't be a connection role;
prod connects as the BYPASSRLS owner (`neondb_owner`) and drops in via `SET LOCAL ROLE`. FORCE RLS
present on 53 tables. GUC is **`app.current_org`** (the audit's `app.current_tenant` was wrong).

**Two real problems (per C1):** (a) the shared helpers don't mirror the runtime role switch; and
(b) — worse — **remote CI never runs the suite at all** (GitHub Actions disabled/never triggered;
only Vercel's build gates commits). A correct seed-then-switch helper **already exists** —
`withAppAuthClient` in `tests/integration/rls-cross-org.test.ts:25` (seeds orgs as the connection
role with per-insert GUC, then `SET LOCAL ROLE app_authenticated`, then probes).

**Agreed fix shape (approach 2, confirmed by Mike):**

1. Bring `withAppAuthClient`'s seed-then-switch into the shared `tests/helpers/rls.ts` — seed as
   the connection role (bypass), then `SET LOCAL ROLE app_authenticated` for the probe. Comment
   that the **helper-level switch makes tests faithful regardless of what `DATABASE_URL` points
   at** (the durable guarantee; a repointed connection would be one bad env var from vacuous).
2. Cover **both read AND write probes** post-switch (`rls-orgaction-write.test.ts` too).
3. **Proof test:** after the switch, assert `is_superuser='off'` **and** `rolbypassrls=false` for
   `current_user`, plus a cross-org read returning **0 rows** — goes red if anyone repoints CI at
   a bypass role.
4. Fix `rls-cross-org.test.ts:170` (asserts `SET LOCAL ROLE postgres` is rejected — true under
   `pathway_app`, false under a superuser connection).
5. **Make the suite actually run in remote CI** (enable GitHub Actions or an equivalent gate) —
   otherwise none of the above gates anything. _(Surfaced by this investigation; confirm scope
   with Mike.)_
6. Reserve BYPASSRLS strictly for the migration role; record the dev-vs-CI role fact in a code
   comment (dev connects as `pathway_app` NOBYPASSRLS → enforced locally; that's why the gap was
   invisible).
7. Run the full RLS suite before/after; STOP + report if any test flips RED under the real role.

### A1b prerequisite — migration portability (why CI can't just be "enabled") — ✅ DONE 2026-07-18

**The break was SELF-INFLICTED, not inherited (proven).** This repo is a fork of
`Shancorps/pathway-foundation`. The foundation's chain has **4 migrations, none referencing
`pathway_app`**, builds from zero, and its **Actions ran green** (`total_count=3`, last two
`success`) — same inherited `ci.yml`, which is **byte-identical to ours**. Our fork's Actions show
`total_count=0` **because GitHub disables workflows on forks by default** (the enable is the
**Actions-tab banner**, not Settings → Actions). We added 61 migrations; `0015` (authored 2026-05-19
by Mike, _after_ the fork) embedded a `SET LOCAL ROLE pathway_app` RLS self-test — a role only
`scripts/postgres-init.sh` (dev docker-init) creates — so `pnpm db:migrate` **failed build-from-zero**
(`ERROR: role "pathway_app" does not exist`), which is why enabling CI today would go red at the
_migrate_ step, before any test.

**Fix (Option A, authorized Rule-#9 exception — see AGENTS.md §9a):** removed the DO-block probe from
`0015` (schema-only now); its assertion already lived in `assignment-scoped-rls.test.ts` ("cross-org
attack"), which A1a makes genuine under the non-bypass role. **Proven on a fresh `postgres:16-alpine`:
before = fail at 0015; after = 65/65 applied, `app_authenticated` created (0041 runs), `SET LOCAL ROLE
app_authenticated` → `bypassrls=f, is_super=off`, `db:check` clean, suspenders test 23/23.** `pathway_app`
is correctly absent on a fresh cluster; local dev unchanged (`postgres-init.sh` still creates it).

**Migration sweep (all 65) — role refs / DO-block self-tests:** only **`0015`** broke build-from-zero.
**`0047`** has a DO-block probe using `SET LOCAL ROLE app_authenticated` but is portable (0041 creates
that role first); **`0021`** has a DO-block probe with no role switch (runs as migrator) — portable.
Both flagged, **not touched** (only `0015` was authorized). `0041/0061/0062` role references are
comments. Only `0041` creates a role.

**Why A1b (remote required check) matters — record, not a separate item:** the local pre-push hook
(`lefthook`, installed + firing; pre-push runs the full RLS suite as `pathway_app`) is **skippable via
`git push --no-verify` with no trace**, and it only protects a machine where `lefthook install` ran.
A remote required check doesn't care whose laptop it is or whether they were in a hurry. A1b remaining:
enable Actions (Actions-tab banner), **require** the check on `main` (Settings → Branches / Rulesets),
then prove-it-fails.

**CI needs NO role-provisioning step — the original A1b plan is revised (proven 2026-07-19).** The plan
had assumed CI would need a `postgres-init.sh`-equivalent step (create `pathway_app` + default privileges)
before `db:migrate`. It does not. Migration **`0041` self-provisions** `app_authenticated`:
`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES` (existing tables at 0041) **plus**
`ALTER DEFAULT PRIVILEGES … GRANT … TO app_authenticated` (tables created by later migrations, which in
CI all run as `postgres`). Verified on a **fresh `postgres:16-alpine` cluster identical to CI** (no
`postgres-init.sh`, no `pathway_app` role): migrations applied clean → `app_authenticated` exists as
`rolbypassrls=f, rolsuper=f` → **can SELECT all 58/58 tables** → **full integration suite 745/745 (114
files) and RLS subset 165/165 pass connecting as `postgres`**. The A1a helper switch (`SET LOCAL ROLE
app_authenticated`) is what makes this genuine: CI's `postgres` superuser connection drops into the
non-bypass role exactly as prod's `neondb_owner` does, so the connection role no longer matters. **Do not
add a provisioning step to `ci.yml` — it would be dead code.** `ci.yml` passes as-is once Actions is on.
(Trade-off noted: under CI's `postgres` _session_, the escalation-block assertion in `rls-cross-org.test.ts`
self-skips — a superuser session can always `SET ROLE`. That specific assertion still executes in the
pre-push `verify` which connects as `pathway_app`. Provisioning `pathway_app` in CI to run it there too is
optional hardening, not required for genuineness.)

### A2 — contact merge silently loses child relations — ✅ FIXED (2026-07-19, commit `493beb3`)

**Done:** `executeContactMerge` now re-parents ALL **14** live FK children of `contacts` (the 10 already
handled + the 4 formerly-missed SET NULL rows: `email_log`, `tasks`, `notifications`, `ai_usage_log`).
The regression test derives the child-table list from the **live FK catalog** and asserts zero child rows
reference any loser after a merge — a universal invariant, not a hardcoded list, so a newly-added child
table fails the test until the engine handles it (policy 4). Full audit trail below.

**Evidence.** `src/modules/duplicates/merge-engine.ts:178` `executeContactMerge` re-parents an
explicit list of relations but not all of them. **13 child tables FK `contacts.id`**, and the
`ON DELETE SET NULL` ones vanish from the winner's feed after a merge (they point at the
soft-deleted loser). Confirmed FKs incl. `tasks/schema.ts:101` (**SET NULL** ✓),
`email-log/schema.ts:51`, `notifications/schema.ts:76` (SET NULL), plus calls, invoices,
opportunities, meetings, sms-messages, projects. **No test covers it.**

**Agreed fix shape:** don't just add two UPDATEs — **enumerate child relations from the actual FK
constraints** so the merge re-parents ALL of them and a newly-added child table can't be silently
forgotten. Add a test that **derives the expected child-table list from the FKs** and fails if the
engine doesn't handle one (new child table ⇒ engine + test both fail in the same PR). Explicit
regression tests for `email_log` + tasks + notifications. Survivorship must be auditable.

**STEP 1 audit result (2026-07-16, accepted).** `executeContactMerge` re-parents **10** of the 13
FK children via hand-written UPDATEs; **3 missed** — `email_log.contactId` (`email-log/schema.ts:51`),
`tasks.contactId` (`tasks/schema.ts:101`), `notifications.contactId` (`notifications/schema.ts:76`),
all `ON DELETE SET NULL`. Every `cascade`/`restrict` FK IS re-parented. **Q3 transactional: HANDLED**
(orgAction wraps in `ctx.db.transaction`, `safe-action.ts:201`/`:251`). **Q4 audited: HANDLED**
(audit-first, `merge-engine.ts:387`). **Decision (Mike): all 3 RE-HOME to winner — zero intentional
exclusions.** If the FK sweep finds a 14th table, STOP and ask before excluding.

**STEP 2 build — the sweep DID find a 14th (2026-07-19).** The live FK catalog (`pg_constraint`) shows
**14** relations referencing `contacts`, not 13: the 10 handled + the 3 planned (`email_log`, `tasks`,
`notifications`) + **`ai_usage_log.contactId`** (`contacts/ai/ai-usage-schema.ts:31`, `ON DELETE SET
NULL`) — the audit's "13" missed it. Stopped and asked per the rule. **Decision (Mike, 2026-07-19):
re-home `ai_usage_log` too (4th).** Rationale: it carries a dedicated `(org, contact_id)` index for
"tokens per contact" cost queries, so leaving it would under-count the winner post-merge and dangle rows
on the soft-deleted loser — the same failure mode as the other 3; `call_log` (the closest SET NULL
telemetry analog) is already re-homed, so this keeps the invariant uniform. All four are plain SET NULL
FKs (not M2M joins) → straight repoint, no junction dedup. Test derives the child list from live FKs and
asserts **zero child rows reference any loser after a merge** (universal invariant, not a hardcoded list).

**Why policy 4 is enumerate-from-FKs, not "remember to update the list" — the list demonstrably rots
(2026-07-16 git evidence):** the merge re-parent block was written with the C7 rebuild (~2026-05-31,
`9cf6f04`). `tasks.contactId` was added **2026-06-18** (`d27fd05`) and `notifications.contactId`
**2026-07-05** (`081a15b`) — both AFTER the list, and both missed. (`email_log.contactId` is
contemporaneous, 2026-05-31 `c2e6a2f` — a same-window oversight.) A hand-written list has now rotted
twice as new child tables landed; a test carrying its own hardcoded list would be the same bug one
layer up.

**Q1 — how a merged-away notification renders today (`notifications/queries.ts`):** the list query
`leftJoin`s contacts on `notifications.contactId = contacts.id` with **no `deletedAt` filter**
(`:177`, `:253`). So a notification pointing at a soft-deleted loser renders **fine but stale** — it
shows the _loser's_ name — in the global notification center; it **vanishes from the winner's
contact-scoped view** (filtered by `contactId = winner`); and after purge (loser hard-deleted) the
join finds nothing → `contactName = null` (`:46`). Re-homing fixes all three.

**Q3 — other hand-written contact-child enumerations (report-only):** the purge-deleted cron
(`app/api/jobs/cron/purge-deleted/route.ts`) hard-deletes and imports `contacts, contactNotes`, but
relies on DB-level FK `ON DELETE` (cascade/set-null) for most children rather than a literal
re-parent list — so it is **not** the same rot class as the merge engine. No GDPR/anonymize/export
feature walks contact children by a literal list today (the `export`/`anonymize` grep hits were
`export function` false positives). The merge engine is the one literal-list rot site.

### A3 — workflow double-send (non-atomic claim) — ✅ FIXED via the durable queue (2026-07-19)

**Fixed by routing workflows through the new generic durable queue rather than patching the
non-atomic claim in place.** The trigger-matcher now enqueues a `workflow_execution` job
(`background_jobs`, idempotency-keyed to the execution); the queue's **atomic claim** is the
concurrency guard (two overlapping `workflow-execute` ticks race to claim the one job — exactly
one wins → one send), the **reaper** handles crashed runs, and each send carries a per-step
**idempotency key** (`wf:<executionId>:<stepNo>` → Resend dedups) so a post-crash reaper re-run
can't double-send. The `workflow-execute` cron now drains the queue (`processDueJobs`) instead of
directly sweeping pending executions. Proven: `workflow-queue-concurrency.test.ts` (two concurrent
drains → exactly one send, execution succeeded, job done) + the queue's atomic-claim / crash-recover
tests. Foundation commits: queue `2c4c226`, runner `<this branch>`.

**Follow-up (transient step retry): ✅ DONE (2026-07-20).** Previously ANY step failure was terminal —
a Resend 429/5xx or network blip on a `send_email` step permanently failed the workflow. Now the
executor classifies failures (`isTransientWorkflowError`): `ActionError` = PERMANENT (validation /
config / auth / stub-deferral — never retried); anything else (provider/network/DB) = TRANSIENT. On a
transient failure with queue attempts remaining, the executor THROWS instead of finalizing — and
because the queue runs the whole executor in ONE transaction, the throw ROLLS BACK every write that
attempt made (step DB writes, audit rows, stepResults). The queue then re-runs it with backoff from a
clean slate; the only non-transactional effect (the outbound email) carries the stable
`wf:<execId>:<step>` key so the provider dedups the re-send. The handler passes `isFinalAttempt`
(`job.attempts >= job.maxAttempts`) so the last attempt finalizes the execution `failed` instead of
throwing — no stranded non-terminal execution, no infinite retry. `isFinalAttempt` defaults true so
direct (non-queue) callers keep the original never-throw behavior. **Key safety proof:** a `create_task`
step BEFORE a transiently-failing `send_email` is NOT duplicated across the retry — the rolled-back
attempt's insert vanishes, the successful attempt inserts exactly one. Proven:
`workflow-transient-retry.test.ts` (retry→one-task+stable-key, permanent→no-retry-terminal,
exhaustion→finalize-failed) + classifier unit assertions.

**Webhooks routed through the queue (policy 2) — Nylas + Resend, 2026-07-19/20.** Both were processed
INLINE; now both follow the standard durable pipeline (verify → enqueue → ACK <10-15s → async →
idempotent-on-provider-event-id → DLQ). The tenant-resolution split is deliberate and researched (see
Stripe/Nylas/Svix/Hookdeck — the "claim-check" pattern; cost-based: cheap id lookup → edge, enrichment →
worker):

- **Nylas** (thin payload = ids): resolve org at the edge via the `grant_id`-hash index → ORG-SCOPED job
  (raw payload RLS-isolated). Handler = existing `ingestNylasWebhook`.
- **Resend** (thin payload = `email_id` + Svix meta; org needs enrichment — fetch email + contact-match /
  sent-message correlation): tenant-agnostic **system-inbox** job (`background_jobs.organization_id`
  NULLABLE, idempotency index made GLOBAL `(type, key)` in migration `0066`), org resolved in the worker.
  Null-org rows are touched only by the system runner on the BYPASSRLS base connection; their payload is
  thin (no message content) so a null-org row leaks no tenant data. Handler parses + branches
  (delivery → `ingestResendDeliveryEvent`, else → `ingestInboundFromEvent`).
- **Runner** now runs queue mechanics (claim/mark/reap) as the system worker on the base connection; only
  the handler gets a tenant context, and only for org-scoped jobs. **Follow-up (retention): ✅ DONE
  (2026-07-20).** The `prune-jobs` cron (`app/api/jobs/cron/prune-jobs`, daily 04:15 UTC) reaps terminal
  rows via `pruneTerminalJobs` — `done` on a SHORT window keyed on `completedAt` (7d default), `dead` DLQ
  on a LONGER window keyed on `updatedAt` (30d default) for reconcile; `pending`/`running` never touched.
  Runs the base (BYPASSRLS) connection so one pass sweeps every org + null-org system-inbox rows; bounded
  per-status batch like `purge-deleted`; env-tunable kill-switch + windows. NOT `audit()`'d — operational
  table + `audit_log.organizationId` is NOT NULL (same reason `purge-deleted` skips its global `faqEntries`
  audit); the structured log line is the run record. Proven: `background-jobs-prune.test.ts`.

**Evidence.** `src/modules/workflows/executor.ts` marks a pending execution running via a
plain `SELECT` + non-atomic update, so overlapping cron ticks can double-process one pending
execution → duplicate outbound client email (real client-facing harm). _(Exact line range to
re-verify at build time — audit said ~114–140; shifted.)_

**Agreed fix shape:** copy the **rc-sync atomic-claim** pattern already correct in this repo
(`UPDATE … WHERE status='pending' RETURNING`, or `FOR UPDATE SKIP LOCKED`) — do **not** invent a
new pattern. Add a test simulating two concurrent ticks asserting exactly one send. Confirm
`retry_after` exceeds max job execution time (else two workers double-process regardless).

---

## The 12-item policy list (destined for `AGENTS.md`)

Authoritative, transcribed verbatim from Mike (2026-07-15). Ported to `AGENTS.md` →
"Standing backend policies (LOCKED)".

1. RLS tests run under a NOBYPASSRLS role via helper-level `SET LOCAL ROLE app_authenticated`.
2. Every webhook: verify-sig → enqueue → ACK → async → idempotent-on-event-id → DLQ + reconcile.
   Never inline. rc-sync is the template.
3. Every job: idempotent + atomic claim (`UPDATE…WHERE…RETURNING` / `FOR UPDATE SKIP LOCKED`) +
   lease + reaper; `retry_after` > max runtime.
4. Every merge re-parents ALL child relations, enumerated from the FKs, test-enforced. New child
   table ⇒ merge engine + re-parent test updated in the same PR.
5. Every outbound provider call goes through a rate-limited, 429-aware, retrying client.
6. No `OFFSET` on tenant-scoped lists — keyset on `(sort_col, id)`; everything paginated/capped
   including tasks and the activity feed.
7. "Queryable ⇒ not free text" — enum/lookup + normalize-on-write for lead source, company
   category, lost reason.
8. Permission checks centralized (`orgAction.withPermission(key)`); financial/sensitive actions
   carry an action-layer check AND RLS.
9. `audit()` on every state-changing action, CI-enforced via `check-actions.mjs`, not convention.
   **⚠️ See C3 below: "CI-enforced" here currently means the LOCAL pre-push hook only — GitHub
   Actions has never run. This item's guarantee is not actually gated until A1b lands.**
10. Externally-consumed endpoints versioned `/api/v1` + shared rate-limit (Upstash) before
    multi-region.
11. PII + payments baseline: MFA, session expiry reconciled, password **min 8 + composition (≥1
    uppercase / ≥1 number / ≥1 special)** with requirements shown in the UI (client-side via
    `src/modules/auth/password-policy.ts`), **HIBP breach screening NOT yet wired** (TODO H13 — the
    load-bearing control once built); composition is competitor-parity — see decisions-2026-07-16 →
    Passwords, revised 2026-07-19, supersedes the earlier "min 12".
12. PM frontend when it ships: virtualization + optimistic UI + production scale-seed in v1
    (LAW 2). Don't retrofit.

## ❌ Standard gaps — sorted by WHEN THEY BITE

Authoritative, transcribed verbatim from Mike (2026-07-15).

**Before beta:**

- Resend + Nylas webhooks process inline, no reconciliation (rc-sync is the correct template:
  enqueue→ACK→DLQ→backoff→sweep).
- rc-sync running jobs have no lease/reaper — a crash post-claim strands the job forever.
- No outbound rate-limit/retry on Resend sends (the RC client does it right).
- No API versioning (flat `app/api/**`).
- No MFA + 7-day sessions + no password composition rules yet (`auth.ts:41` is min 8 with no
  complexity). Decision (2026-07-19): keep min 8, add composition (≥1 upper/number/special) + UI
  messaging + HIBP — build in B2.
- In-memory rate-limit won't hold multi-region.
- Forward-only migrations, no down-scripts.

**At scale:**

- Tasks + activity feed unpaginated; contacts list is `OFFSET` (capped 10k).
- CSV import row-by-row.
- Dedup loads the whole org table then filters in JS — ids never reach SQL.
- Global search `custom_fields::text ILIKE` bypasses GIN (pg_trgm fix deferred).
- Free-text governance gaps beyond `companies.category` — `lead_source`, `source_detail`,
  `lost_reason` (lost_reason backs a report).

**When the feature ships:**

- contact↔opportunity is single-FK not M2M (needs `opportunity_contacts` join + merge re-parent).
- PM system is backend scaffolding only — no `/events`, `/tasks`, `/board` routes, FS-only deps,
  no critical-path/capacity/real-time. Genuinely deferred, not missing. Indexes are in place.
  LAW 2 remediation applies when the PM UI ships.
