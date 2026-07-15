# Backend Audit Backlog

Tracked home for the backend audit's red bugs, the policy items destined for `AGENTS.md`, and
the standard gaps — so this security work survives session/transcript loss.

**Companions:** `docs/multi-tenant-remediation-plan.md` (RLS enforcement model + table coverage),
`docs/decisions-since-may-docs.md` (decision ledger), `TODO.md` (foundation punch list).

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

> **SOURCE NEEDED — not fabricated.** This conversation was compacted; the enumerated 12-item
> policy list is not in my current working context and is not recorded in-repo. I will not invent
> it (that would defeat the point of this doc). **Action:** Mike to paste the 12 items (or point to
> the transcript/doc); I'll enumerate them here verbatim, then port to `AGENTS.md`.
>
> Fragments captured this session (NOT the authoritative 12 — do not treat as complete):
>
> - Prefer **policy-based admin access over privilege-based bypass** (auditable, revocable).
> - **BYPASSRLS reserved strictly for the migration role**; no admin/app/test role gets it.
> - Tenant context uses **`SET LOCAL`**, never bare `SET` (bare `SET` leaks across pooled
>   connections on Vercel+Neon).
> - Policies read **`current_setting('app.current_org', TRUE)`** so a missing context **fails
>   closed** (0 rows), never raises.
> - Branch 2 governing laws: **(i) no single vendor is ever the only road in (two doors min);
>   (ii) never let a security gate fail closed with no exemption** (the `requireEmailVerification`
>   class).

## ❌ Standard gaps — sorted by WHEN THEY BITE

> **SOURCE NEEDED — not fabricated.** Same as above: the enumerated ❌ standard-gap list (and its
> before-beta / at-scale / when-the-feature-ships sequencing) is not in my current context or
> in-repo. Mike to paste it; I'll record each with when-it-bites + honest status. Related existing
> gap-tracking to reconcile against: `docs/multi-tenant-remediation-plan.md` (e.g. Tier-1: 7
> org-scoped tables with no RLS) and `TODO.md` (H10 auth events → audit log, etc.).
