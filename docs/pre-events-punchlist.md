# Pre-Events punch-list — reconciliation of the session-of-2026-07-20 decisions

**Purpose:** the single tracked list of everything surfaced in the 2026-07-20 working
session (features + hardening) that must be resolved **before the Events section is built**.
Reconciled against the code + the locked-decision docs. Companion to `docs/PIVOTS_LEDGER.md`
(deferrals), `TODO.md` (audit punch list), and the auth spec in
`docs/superpowers/specs/2026-07-20-auth-google-signin-and-account-recovery-design.md`.

Status legend: ✅ done · ⏸ superseded/deferred THIS session (parity research) · ⬜ still to do.

---

## 1. Superseded / simplified this session (build LESS than originally specced)

Research into how competitor CRM/PM systems actually handle auth/hardening showed we do not
need to be as strict as first designed. These are deliberately simplified — the original
decisions are kept on file, marked deferred, not deleted.

- **⏸ Conditional MFA** (code after 14+ days idle / new device) — deferred. Photo-CRM field
  barely does MFA (only Studio Ninja does TOTP; none do conditional). Chose parity. Revisit
  going upmarket.
- **⏸ Support access = impersonation + time-boxed grant rows** — simplified. Built recovery as
  **credential-only, no impersonation, env-allowlist gated** (keeps LAW 4 airtight). The
  "recovery = no data read" half is DONE; the "support = impersonation" half is dropped for
  now; grant-row machinery replaced by the simpler allowlist.
- **⏸ Auth-resilience ladder** (gate-exemptions → SMS → recovery-codes → Pathway staff) — top
  three tiers defer with MFA; the "Pathway-staff final net" is DONE.
- **⏸ Password "min 12"** — already superseded in-repo by **min 8 + composition** (commit
  `3d80d12`). The forms are now aligned to it (see §3 fixed items).

## 2. Done — keep as-is (built this session or earlier)

- **✅ Merge → winner + 90-day bin, FK-enumerated, test-enforced** (A2).
- **✅ Webhooks: verify→enqueue→ACK→async→idempotent→DLQ→reconcile** (Nylas + Resend; rc-sync
  is the template).
- **✅ Background jobs: atomic claim + lease + reaper + attempts + poison-retire + capped
  backoff + idempotent, one queue shared with webhooks** (A3).
- **✅ RLS standard: force RLS, tests run as the app role, negative cross-org test** (A1).
- **✅ `audit()` on every state-changing action — now STATICALLY enforced** by
  `scripts/check-actions.mjs`.
- **✅ Google sign-in** (optional alternate to email+password).
- **✅ Account recovery** — team-member (owner/admin, in-org isolation) + Pathway-staff
  (env-allowlist, credential-only, no impersonation).
- **✅ Password form ↔ policy alignment** — forms now enforce min 8 + composition with the
  requirements shown in the UI (`src/modules/auth/password-policy.ts`). _(Fixed 2026-07-20.)_
- **Notification on/off toggles** — prefs tables exist; verify completeness when touched.
- **Pagination** — built for Contacts (keyset + filters); the full spec below is not yet
  rolled out everywhere.

## 3. Still to do — keep (not built, not superseded)

### Features (unbuilt)

- **⬜ Rich audit / record-history** — the big one: actor-**type** tagging
  (user/workflow/import/public-form/nylas) + type filter facet, **before/after values**,
  per-record history view, per-field **change notifications**, **comments + @-mentions +
  resolvable threads**, **day-83/87 deletion warnings + export-from-bin**. Today `audit_log`
  has actor/action/resource/metadata only — the base, not the feature.
- **⬜ Merge warning UI** + "recovery won't repopulate the loser" notice (backend done, UI not).
- **⬜ Dropdown "did you mean"** fuzzy-match on field values (org-wide, admin-toggle per user,
  CSV import runs the same match-check). Not built (existing fuzzy code is for contact dedup).
- **⬜ Pagination full spec** — numbered pages, 50/100/150/250 tiers, select-all-across-pages
  with filter awareness, multi-filter + date ranges — finish + roll out beyond Contacts.

### Hardening (unbuilt — still valid, still needed)

- **⬜ Rate-limit outbound gateway** — one gateway, three thin adapters (Nylas/Resend/RC),
  per-org fairness (guaranteed floor + shared burst), two lanes (interactive always beats
  bulk), retries-are-requeues-not-sleeps, full jitter, circuit breaker per provider, **Upstash**
  shared state, extract RingCentral as the template, throttle visibility to the studio. Big
  piece, none built (= policy 5 + TODO H9).
- **✅ HIBP breach screening** — WIRED (`haveIbeenPwned` plugin, k-anonymity, no key; guards
  sign-up/change/reset). The load-bearing password control. _(2026-07-21)_
- **✅ Server-side password composition** — enforced at the API via the Better Auth `before`
  hook (`passwordCompositionError`), not just the form, so it can't be bypassed. _(2026-07-21)_
- **⬜ Hashed verification/reset tokens** — stored plaintext today (TODO H14); short-expiry +
  hash-at-rest.
- **⬜ API `/api/v1`** path versioning + forward-compatible response envelopes + RFC 8594
  deprecation/sunset headers (policy 10).
- **⬜ Multi-region rate-limit storage** (Upstash) — folded into the gateway above (H9).

---

## Notes

- **Auth "go public" prerequisites** (separate from the above): a **custom domain**, then
  publish the Google OAuth app + complete consent branding. Required before external customers.
- MFA is deferred by owner decision (2026-07-20); if revisited, see the auth-resilience ladder
  in §1 and the spec doc.
