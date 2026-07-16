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

### A1 — CI RLS tests: role + the CI-doesn't-run divergence — 🟡 in progress (investigation done, fix agreed, not yet built)

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

### A2 — contact merge silently loses child relations — 🔴 not started

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
regression tests for `email_log` + tasks. Survivorship must be auditable.

### A3 — workflow double-send (non-atomic claim) — 🔴 not started

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
11. PII + payments baseline: MFA, session expiry reconciled, password-min = 12, HIBP wired.
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
- No MFA + 7-day sessions + password-min 8, which contradicts the documented 12 (`auth.ts:41`).
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
