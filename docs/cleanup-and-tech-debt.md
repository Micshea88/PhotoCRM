# Cleanup / Tech-Debt / Deferred-Scope — Living Source of Truth

> This is the single living source of truth for cleanup, tech-debt, and deferred scope. Update it as items are Fixed (add commit hash + date) or reclassified. Three sections, deliberately kept separate — **A: bugs/tech-debt to fix**, **B: deferred scope (roadmap, not debt — do NOT fix prematurely)**, **C: watch items (flagged do-not-fix-yet)**. Assembled 2026-07-05 from: the `post-3a-polish-backlog` memory, `docs/pathway-ai-architecture.md`, `TODO.md`, `docs/decisions-since-may-docs.md`, the `email_round` plan, and code comments.
>
> **Cross-referenced sources (not duplicated here to avoid divergence):**
>
> - `TODO.md` — the 2026-05-06 foundation Audit Punch List (Critical all done; open: H5, H6, H7, H8, H10, H13, H14, H34, H36, H38, M1–M5, M7, M8, M10, M12, M15, M17, M18, M19, L2–L7). Remains tracked in `TODO.md`; the open IDs are listed in §A.13.
> - `post-3a-polish-backlog` memory: `~/.claude/projects/-Users-kellyshea-git-PhotoCRM/memory/project_contact_detail_polish_backlog.md` (19 items, full verbatim text).
> - **`docs/pending-integration-setup.md`** — required integration WIRING (Nylas inbound webhook, Resend bounce webhook, Twilio SMS) as a **build-completion gate**. The dormant-but-built integrations live there, not here.
> - **`docs/features-backlog.md`** — forward-looking **product roadmap features** (net-new capabilities, e.g. template usage indicators, import UX + durable batches + bulk actions). Feature roadmap lives there, not here (this doc is debt/deferred-scope of current work).
> - **`docs/theme-token-layer-plan.md`** — the approved design-token / theme-layer architecture + migration plan (Phase 1; values TBD). The **running hardcoded-palette / dark-mode / micro-font hotspot inventory** lives there (§5), not duplicated here. Reskin frozen until notifications ships.

---

## SECTION A — BUGS / TECH DEBT TO FIX (things that are wrong)

Severity legend: **blocks-a-feature** · **user-visible** · **cosmetic** · **internal**.

### A.1 — Pencil-edit pattern mismatch

- **What's wrong:** the activity-entry inline edit (the §1 "pencil-only edit" pattern) is inconsistent with the established inline-edit pattern used elsewhere; flagged as a mismatch to reconcile.
- **file:lines:** `src/modules/contacts/ui/contact-activity-feed.tsx:956` (activity-entry card, "Backlog Item 1a/1b — activity-entry card with §1 pencil-only edit").
- **Severity:** user-visible. **Status:** Open.

### A.2 — Two `window.confirm` popups remain (discard prompts)

- **What's wrong:** native `window.confirm` still used for "discard draft" prompts instead of the app-style `ConfirmModal`.
- **file:lines:** `src/modules/contacts/ui/log-call-modal.tsx:139` ("Discard this call log?"), `src/modules/contacts/ui/add-note-modal.tsx:107` ("Discard this note?"). (Part of the systemic sweep A.10.)
- **Severity:** user-visible. **Status:** Open.

### A.3 — Emails stored as notes (data debt)

- **What's wrong:** logged emails were historically stored as notes; `email_log` is now the first-class home ("Backlog Item 2"), leaving residual old email-as-note rows / a migration-consistency concern.
- **file:lines:** `src/modules/email-log/schema.ts:18`, `src/modules/email-log/actions.ts:35` (both cite "Backlog Item 2").
- **Severity:** internal (data debt). **Status:** Open.

### A.4 — All-activities tab: type-chips jump tabs

- **What's wrong:** on the All tab, clicking a Type chip should filter **in place**, not jump to that type's tab. ("Backlog Item 1c — All-tab Type chips filter IN PLACE (don't jump).")
- **file:lines:** `src/modules/contacts/ui/contact-activity-feed.tsx:360, 388, 611`.
- **Severity:** user-visible. **Status:** Open.

### A.5 — `filtersOpen` dead code + Filters double-toggle

- **What's wrong:** the filter-strip open/close state (`filtersOpen`) carries dead-code branches and a double-toggle interaction bug in the Filters control.
- **file:lines:** `src/modules/tasks/ui/contact-tasks-pane.tsx:132, 218`; `src/modules/tasks/ui/task-filter-strip.tsx:66, 77, 180`; `src/modules/contacts/ui/activity-filter-strip.tsx:130, 142, 241`.
- **Severity:** internal / user-visible (interaction). **Status:** Open.

### A.6 — Composer-fields spec audit

- **What's wrong:** activity composers need an audit against Mike's approved field spec (direction/subject/date-time/attendees/notes/body per type). ("Backlog Item 1e — Mike's approved spec.")
- **file:lines:** `src/modules/contacts/ui/activity-composers.tsx:255, 490, 542, 635`.
- **Severity:** user-visible. **Status:** Open.

### A.7 — AI summary not regenerating on contact FIELD edits

- **What's wrong:** the AI-cache-invalidation contract (polish #5 Fix 8) nulls the `ai_*` cache on **activity** inserts (note/call), but **not** on contact **field** edits (name, tags, leadSource, etc.) — so editing a contact field leaves the AI summary stale.
- **file:lines:** `docs/pathway-ai-architecture.md` "Cache invalidation contract"; `src/modules/contacts/ai/cache-invalidation.ts` (`invalidateContactAiCache` wired in `createContactNote` / `logCall` only).
- **Severity:** user-visible. **Status:** Open.

### A.8 — `madeReferralsCount` / referral-insight miscompute

- **What's wrong:** the referral insight conflates counts — `referralsMade` is **outbound** (other contacts referred BY this person), but the insight/count logic around it is reported as miscomputing.
- **file:lines:** `src/modules/contacts/ai/insights-detector.ts:51, 109-113` (`if (facts.referralsMade >= 5 && facts.referralsWhoBooked === 0) … "Has made N referrals but none have booked yet"`). Directionality contract: `docs/pathway-ai-architecture.md` "Referral directionality".
- **Severity:** user-visible (wrong insight text). **Status:** Open — ⚠️ **FROZEN by Watch item C.1** (`insights-detector.ts` is do-not-touch until redesign). Fix only as part of a scoped insights-detector redesign.

### A.9 — `insights-detector.ts` brittle status matching

- **What's wrong:** insight generation uses brittle status-string matching that breaks easily.
- **file:lines:** `src/modules/contacts/ai/insights-detector.ts`.
- **Severity:** internal. **Status:** Open — ⚠️ **FROZEN by Watch item C.1** (see §C). Do not fix piecemeal; requires the full redesign noted in the AI architecture doc.

### A.10 — Systemic: destructive actions need confirmation dialogs (sweep incomplete)

- **What's wrong:** polish backlog **#15** — every destructive action should route through the shared `ConfirmModal`. Broadly adopted now (~10 files), but the sweep is incomplete: **7 `window.confirm` calls remain** across the app.
- **file:lines:** `ConfirmModal` at `components/ui/confirm-modal.tsx`; residual `window.confirm` in `log-call-modal.tsx:139`, `add-note-modal.tsx:107`, and 5 others (grep `window.confirm` → 7 hits).
- **Severity:** user-visible (data-loss risk on unconfirmed destructive actions). **Status:** Partial (mostly adopted; 7 remain).

### A.11 — Missing webhook secrets in Vercel (config/wiring debt)

- **What's wrong:** delivery/inbound email webhooks cannot verify signatures because their secrets are unset. `verifyResendWebhook` returns null when unset → all inbound/bounce events rejected.
- **Evidence:** `vercel env ls` (2026-07-05) shows **no** `RESEND_WEBHOOK_SECRET` and **no** `NYLAS_WEBHOOK_SECRET` in any environment. Also on the deploy-blocker list `docs/decisions-since-may-docs.md:213` (+ `SHARE_LINK_HMAC_SECRET`, Resend MX/DKIM).
- **Severity:** blocks-a-feature (Resend delivery/inbound; Nylas delivery). **Status:** Open (operational — set in Vercel; add the 3 delivery event types to the Resend endpoint).

### A.12 — `post-3a-polish-backlog` open items (contact-detail + dialer + auth polish)

The following items from the 19-item memory backlog are Open or unverified. Full verbatim text: `project_contact_detail_polish_backlog.md`. Verified against code 2026-07-05:

- **#1** Middle activity column collapses first (backwards) — CSS 3-col layout. _user-visible · Open (unverified)._
- **#2** "Overview" tab header overlaps contact name at narrow widths. _user-visible · Open (unverified)._
- **#3** AI "Regenerate" button possibly-orphaned — **see Watch C.4 (verify before removing).**
- **#4** Settings→Integrations: Browse vs Connected disagree on RC state. _user-visible · Open (unverified)._
- **#5** lefthook stop-reminder `MODULE_NOT_FOUND` when subshell cd's into a subdir. _internal · Open._
- **#7** create-contact Owner search filter shows "none" on partial match. _user-visible · Open (filter code not located)._
- **#8** Sign-in wrong-password fails silently (no error surfaced). _user-visible · Open (unverified)._
- **#9** Password-reset request page silent on submit. _user-visible · Open (unverified)._
- **#11a** Dialer idle state has no always-visible keypad. **#11b** "Calling as ext. {id}" leaks internal RC extension id. **#11c** auto-collapse after call-end may not fire. _user-visible · Open (unverified)._
- **#14** Collapsed dialer pill too prominent at idle → 40×40 circle. _cosmetic · Open (still 220×40 — `docked-dialer.tsx:130-131`)._
- **#16** Outbound caller-ID shows (866) 571-1744 not (727) 510-2700; (a) surface "Connected as: <RC user>" in Settings→Integrations, (b) post-callback identity confirm, (c) show caller-ID in dialer header. _user-visible · Open (no "Connected as" UI found; partly operational — RC OAuth identity binding)._
- **#19** Synthesized notes ("Call did not connect: …" / "Transferred to phone.") not rendering on failed/transferred call entries. _user-visible · Open (investigation was deferred)._
- **RESOLVED (do not re-open):** **#10** password show/hide toggle — DONE (`components/ui/password-input.tsx`, used across auth forms). **#12** dialer audio echo — DONE (commit `6540523`). **#13** transfer-to-mobile — DONE (commit chain `f9b7742→b10fe28→aca9bf5→996d4f1`).
- **#6** dialer popup silent-block — **OBSOLETE** (inline dialer shipped; no `window.open`). Delete on sight.

### A.13 — Foundation Audit Punch List (tracked in `TODO.md`)

Not duplicated here (kept in `TODO.md` to avoid two sources of truth). Open item IDs as of 2026-07-05: **H5, H6, H7, H8, H10, H13, H14, H34, H36, H38** (High); **M1, M2, M3, M4, M5, M7, M8, M10, M12, M15, M17, M18, M19** (Medium); **L2, L3, L4, L5, L6, L7** (Low). Notable security-flavored: **L7** (open-redirect check on sign-in `redirect`), **H13** (HIBP password check), **H14** (hash verification tokens at rest), **H10** (auth events → audit log).

### A.14 — Resend `email.failed` handler branch (native-lane async send-failure parity)

- **What's wrong:** the Resend webhook **subscribe is live** (`email.failed` is subscribed on the endpoint), but the route has **no `email.failed` branch** — Task 6 wires only `email.bounced`/`email.complained`/`email.delivered`, so `email.failed` currently no-ops. Result: an **async** Resend send failure (Resend accepted the API call, then failed to send) leaves the `email_log` row stuck at `delivery_status="sent"` with no correction (`email.bounced` = recipient rejection, does not cover it; the synchronous send-error path in `src/lib/email.ts:69-83` only catches failures at send time).
- **Fix:** add `email.failed → recordDeliveryEvent({ path: "resend", type: "failed" })` on the Resend lane, mirroring the Nylas `message.send_failed → type: "failed"` path (plan §Webhook Handler Changes). The `failed` delivery status + `email_log.failed_at` column already exist.
- **file:lines:** `app/api/webhooks/resend/inbound/route.ts` (delivery-event branch); parity reference `src/modules/email-connections/nylas-inbound.ts` (`message.send_failed`).
- **Severity:** user-visible (missed send-failure notification). Small/cheap. Closes the native/Resend-lane **async send-failure parity gap** vs the Nylas lane. **Status:** Open.

### A.15 — Settings → Integrations: connection status inconsistent across the three views

- **What's wrong:** on `/settings/integrations`, connection state is only correct on the individual provider **DETAIL** pages; the **Browse** tab and the **Connected-apps** tab are out of sync with reality. Confirmed symptoms:
  - **Gmail** is actually connected (detail page shows "Connected") but shows **"Not connected" on Browse** AND is **entirely MISSING from Connected-apps** (should appear next to RingCentral).
  - **RingCentral** shows **"Connected" in Connected-apps** but **"Not connected" in Browse**.
- **Root cause (likely):** the Browse cards and the Connected-apps list don't read live per-provider connection state the way the detail pages do (they derive status from a stale/incomplete source rather than the canonical connection tables).
- **Fix:** all three views — **Browse cards, Connected-apps list, detail pages** — must reflect the **same actual per-provider connection status** from one canonical source. Ensure ANY connected provider (email/Nylas AND telephony/RingCentral) appears in Connected-apps.
- **file:lines:** `app/(app)/settings/integrations/page.tsx` (Browse fetch); `src/modules/integrations/ui/integrations-browser.tsx`; `src/modules/integrations/ui/connected-apps-list.tsx`; canonical sources `src/modules/telephony/queries.ts` (RingCentral) + `src/modules/email-connections/queries.ts` (Nylas/email). (Note: the email/Nylas provider must be wired into the same connected-status derivation as telephony.)
- **Severity:** user-visible — status is misleading and connected apps go missing. **Status:** Open. (Fuller, confirmed version of the earlier polish-backlog **#4** referenced in §A.12 — which was RingCentral-only; this now also covers Gmail/email missing from Connected-apps.)

### A.16 — grant_id_hash backfill writes across orgs without an org GUC (final-review finding)

- **What's wrong:** `findConnectionByGrantIdAnyOrg`'s decrypt-scan fallback issues an `UPDATE email_connections SET grant_id_hash=…` on the base `db` handle with **no `app.current_org` set** (`src/modules/email-connections/queries.ts:79-82`), before `handleGrantExpired` opens its GUC'd transaction. This is the ONLY place in the notification-center branch that WRITES through the AnyOrg/BYPASSRLS seam. Benign (writes only a non-secret SHA-256 to the exact row already matched; idempotent; in dev NOBYPASSRLS it's a silent no-op), but it's a cross-org write without the GUC — surfaced by the final whole-branch review as a conscious-acceptance item, distinct from the unbounded-scan concern (Task 8 notes).
- **Fix options (when addressed):** wrap the backfill UPDATE in a `db.transaction` that `set_config('app.current_org', row.organizationId, true)` first (clean, ~5 lines, also makes it work in dev); OR move the backfill into the caller's GUC'd tx; OR drop opportunistic backfill entirely (a scheduled migration backfills legacy hashes once).
- **Depends on:** the prod base-pool role actually having `BYPASSRLS` (see `pending-integration-setup.md` pre-deploy check) — if it does NOT, this write (and all AnyOrg SELECT resolvers) return 0 rows in prod.
- **Severity:** benign / single-tenant-safe. **Status:** ✅ RESOLVED (commit 3b2ffe0, 2026-07-07). Chosen fix: resolver is now PURE-READ (no cross-org write); the `grant_id_hash` backfill moved into `handleGrantExpired`'s existing org-GUC'd `UPDATE` (idempotent `grantIdHash: conn.grantIdHash`). No write through the AnyOrg seam without a GUC anywhere; works regardless of the prod pool's BYPASSRLS. (Preferred over the literal nested-tx GUC-wrap, whose transaction-local GUC misbehaves under withTestDb's shared transaction.)

### A.17 — Multi-tenant isolation remediation (four-audit findings, 2026-07-07) — IN PROGRESS

Full detail + fixes + effort + tests: **`docs/multi-tenant-remediation-plan.md`** (authoritative tracker). Owner standard: multi-tenant-correct, NO deferrals — every item below is being FIXED on branch `fix/multi-tenant-isolation`, not accepted. Reframes the prior "single-tenant-safe" deferrals (below) as must-fix.

**TIER 1 (blocks merge):**

- **T1.1 (HIGH):** 7 org-scoped tables have NO RLS at all — `files`, `items`, `audit_log`, `org_preferences`, `file_share_links`, `file_share_link_events`, `file_scan_diagnostics`. No live exploit (app filters defensively) but zero DB backstop — same class as the confirmed Shanzy→K&K prod leak (`0041`). Add RLS+FORCE+org policy; document in-code any genuinely-public path that must run as owner.
- **T1.2 (HIGH):** `src/modules/items/` template teaches the no-RLS pattern to every scaffolded module → fix template + `/new-module`.
- **T1.3 (HIGH):** `user_preferences` has policies but no `FORCE` (owner bypasses) — the only such table; was undocumented. Add FORCE.
- **T1.4 (MEDIUM, live read exposure):** `page-org-context.ts` defaults `role="member"` on null membership instead of throwing → a REVOKED member keeps READ access until session refresh (≤7-day session / 5-min cache). Fail closed, mirroring `orgAction`.
- **T1.5 (LOW):** `0041` header falsely asserts "every org-scoped table has FORCE RLS" — add a CI guard that enforces it once true.

**TIER 2 (multi-tenant-activation holes — fix, not defer):**

- **T2.1 (MEDIUM):** `workflow-execute`→`handleUpdateField` updates contacts/projects/etc by ID, no org filter + no `SET LOCAL ROLE` → cross-org write possible. Org-scope + role switch.
- **T2.2 (MED/HIGH):** `findContactAnyOrg` routes inbound email by cross-org "latest updatedAt wins" → inbound/reply hijack once a 2nd org exists. Resolve org from the receiving mailbox, look up contact within it.
- **T2.3 (MEDIUM):** `listIncompleteSignups` shows all-orgs' incomplete signups to any admin. Org-scope.
- **T2.4 (LOW latent):** fail-OPEN role predicates — payments `COALESCE(role,'') IN (…,'')` + assignment overlay `NOT IN ('user')`. Make fail-closed.
- **T2.5 (LOW defense-in-depth):** `emitNotification`/`recordDeliveryEvent`/`handleGrantExpired`/cron write paths set the org GUC but skip `SET LOCAL ROLE` → RLS inert (writes correct only via explicit org tagging). Add the role switch.
- **T2.6 (LOW boundary):** email-pixel route (`app/api/email/track/[pixelId]`) imports `@/lib/db`+drizzle directly (undocumented `app/` escape hatch) + cross-org UPDATE by pixel id. Move into the module data layer.

**Verified solid (NOT touched):** GUC lifecycle (no pool bleed); fail-closed `current_setting(...,true)`; membership verified on writes + on active-org-set; crown-jewel tables ENABLE+FORCE; notifications two-policy INSERT; blob private-by-default. **Already fixed:** Shanzy prod leak (`0041`), A.16 (above), contacts assignment overlay (`0015`/`0021`).

**Reclassifies these former SECTION B "deferred to multi-tenant" items as MUST-FIX** (see plan): multi-tenant email sender (B.10), account linking (B.11) — revisit against the no-deferrals standard.

### A.18 — ESLint "no `@/lib/db` in `app/`" rule likely misses Next.js dynamic-route (`[param]`) handlers

- **What's wrong (suspected):** the AGENTS-rule-1 guard (`eslint.config.mjs:71`, `files: ["app/**/*.ts","app/**/*.tsx"]`) is meant to block `@/lib/db`/`drizzle-orm`/`@/modules/*/schema` imports from `app/`. But `app/api/email/track/[pixelId]/route.ts` imported `@/lib/db` directly from Task 13 until T2.6 (2026-07-08) and **passed CI the whole time** — strong evidence the rule's glob does NOT match paths containing a literal `[param]` segment (ESLint/minimatch treats `[pixelId]` as a glob character class, so the file escapes `files:`). This would let ANY Next.js dynamic-route handler (`app/**/[x]/route.ts`) silently bypass rule 1.
- **Fix (separate task — do NOT bundle):** verify the hypothesis (add a throwaway `@/lib/db` import to another `[param]` route → does lint catch it?); if confirmed, fix the glob (escape brackets / adjust the flat-config `files` matcher) so dynamic routes are covered. **CAUTION:** closing it may surface OTHER currently-hidden violations across dynamic routes — those must be triaged/fixed as part of the task, which is why it's scoped separately, not folded into Tier 2.
- **Surfaced by:** the 2C+2D review (T2.6). The specific pixel-route violation is already FIXED (moved into `email-log/pixel-tracking.ts`); this item is the underlying lint-coverage gap.
- **Severity:** internal (defense-in-depth guard gap; no known live isolation leak). **Status:** Open (follow-up).

### A.19 — `member_role` RLS declared in SQL (migration 0006), not in the TS schema

- **What's wrong:** `member_role` has correct FORCE RLS + policies (migration `0006`, org-only SELECT + admin-write), but `src/modules/rbac/schema.ts` has no `.enableRLS()`/`pgPolicy` declaration — the RLS is SQL-only (older pattern). `check-rls-force` passes (it parses migrations) and `db:check` is green, so there's no drift today, but the TS schema doesn't reflect the table's RLS. Pre-existing (predates the isolation branch).
- **Fix (someday, low priority):** add the `pgPolicy` + `.enableRLS()` declarations to `rbac/schema.ts` to match the SQL, bringing it into the TS-tracked pattern (like the Tier-1 tables). Snapshot-neutral if the SQL already matches.
- **Severity:** internal (cosmetic schema/SQL drift; enforcement is correct + tested). **Status:** Open (follow-up). Surfaced by the final whole-branch review (2026-07-08).

### A.20 — Notification filter strip reuses shared PRIMITIVES, not the whole ActivityFilterStrip (deliberate; full extraction deferred)

- **Context:** Task 15 required the /notifications filter strip to "reuse the Contacts filter strip." An E1 feasibility assessment (2026-07-09) found the whole `ActivityFilterStrip` + `activity-filter.ts` engine **cannot be cleanly reused** for notifications. Specific coupling points:
  1. **"Type" is structurally incompatible** — in the activity strip, type IS the tab (`ActivityTab = all|note|call|email|sms|meeting`, mutually exclusive); notifications need a **multi-select** of 15+ notification-type keys. Different models; can't map one onto the other.
  2. `ActivityFilterState` carries `events`/`owners`/`directions`/`outcomes`/`thread` — none have a notification equivalent.
  3. The component requires activity-specific props (`eventOptions`, `memberOptions`) → passing empties yields misleading dropdowns.
  4. Unconditional module-level imports from calls/meetings (`RECORDED_CALL_DISPOSITIONS`, `MEETING_OUTCOMES`, …) → bundle-couples the notifications page to those modules.
  5. URL-param keys are hardwired + activity-specific (`atab/aevent/aowner/adir/aoutcome/athread`); the notifications page is state-driven.
  6. The `FilterPills` pill-type union has no notification-type or contact pill.
- **DECISION (Mike, 2026-07-09):** satisfy the reuse rule at the **PRIMITIVE level** — `NotificationFilterStrip` reuses the shared `MultiSelectMenu` / `FilterPills` / `DebouncedSearchInput` (adding a contact picker + free-text search), **not** the activity-specific wrapper. **Do NOT** refactor `ActivityFilterStrip` into a generic strip now: that's a multi-session refactor of a working, memory-locked component with only **two** consumers, and the correct abstraction isn't knowable yet.
- **Rule of thumb (revisit trigger):** extract a shared `GenericFilterStrip` primitive **only once a THIRD consumer exists** (e.g. a Tasks or Events filter page) and the correct shape is obvious rather than guessed. Until then, primitive-level reuse is the standard — this is a deliberate deferral, **not** a violation of the reuse rule.
- **Severity:** internal / design-record. **Status:** Decided + implemented at primitive level (E1, Section E of `feat/notifications-inbound-fixes`).

### A.21 — Inbound email cleaner handles GMAIL quote markers only (Outlook / Apple Mail = known gap)

- **What:** `cleanEmailBody` (`src/modules/email-log/body-cleaner.ts`) does a structure-aware quote cut keyed on **Gmail** markers only — `gmail_quote` / `gmail_quote_container` / `gmail_attr` — taken from a **real captured prod payload** (row `xil9ac8293g055i9ywsjeko0`). A plain-text `>`/`On … wrote:` fallback also runs for the Resend text lane.
- **Gap:** **Outlook** and **Apple Mail** replies use different quote markup (e.g. Outlook's `#divRplyFwdMsg` / `<hr>` separator, Apple's `blockquote type="cite"`). We have **no real captured payload** for either, so — per the standing rule (do NOT invent markers) — they are **not handled**: an Outlook/Apple reply will fall back to the line-based cut (which usually won't fire on single-line HTML), leaving quoted history in the cleaned body. The raw HTML is retained in `body_html`, so nothing is lost.
- **Fix (when a real payload exists):** capture a real Outlook and a real Apple Mail inbound reply, add their observed container markers to `GMAIL_QUOTE_RE`'s sibling set, add each as a real-payload fixture (LAW 7). Do not add markers speculatively.
- **Severity:** internal (degraded display for non-Gmail replies; no data loss, no security impact). **Status:** Open (needs real payloads). Surfaced building Section 1 (D1), 2026-07-10.

### A.22 — Post-mortem: three features shipped broken through clean reviews (why LAW 7 exists)

- **What happened (2026-07-10):** three notification features passed per-section reviews (Spec ✅ / Quality Approved) AND a final whole-branch review (READY-WITH-NITS), then were found **broken in production**. The common failure: **tests verified that STATE was set, not that BEHAVIOR occurred.**
  - **D1 — email cleaner didn't clean real email.** `cleanEmailBody` split on `\n` and matched an anchored `^on … wrote:$` regex per line. Real Gmail HTML is a **single line, no newlines, entity-encoded**, so the cut never fired and quoted history + literal `&lt;`/`&gt;` rendered on the timeline. **Every fixture was newline-separated + entity-free** — the tests never exercised the shape that actually arrives.
  - **D2 — sort didn't sort.** The sort control was a `MultiSelectMenu` (multi-select); clicking "Oldest first" appended to `["newest","oldest"]` so `v[0]` stayed "newest". Tests asserted `filterStateToApiParams` mapped the param **given a sort value directly** — they never clicked the control and asserted the **rendered list order** changed.
  - **D3 — compact wasn't compact.** Compact differed from comfortable by ~8px padding only; the `data-density` attribute had **no CSS consumer**. Tests asserted the **attribute was present**, never that the row was **measurably denser**.
- **Root cause (systemic):** consistency with a fixture/attribute proves the code is internally consistent — not that it produces the right observable result on real input. Reviews traced code paths and found them coherent; the fixtures/assertions were the wrong target.
- **Remedy:** **LAW 7** (AGENTS.md → Standing design laws): assert the observable RESULT; test external-input parsers against REAL captured payloads. The D1/D2/D3 fixes each ship a LAW-7 test (real Gmail payload → output assertions; click-sort → rendered-order assertion; toggle → line-clamp assertion).
- **Recommended mechanical checks (not yet built — follow-ups):** (1) a **golden-file payload corpus** for inbound email (real captured Gmail/Outlook/Apple bodies) that the cleaner tests consume; (2) a lint/review checklist item: "does this test assert output/order/rendered-state, or just a prop/attribute/param?"; (3) a **"does this attribute/prop have a consumer" check** (the dead `data-density` would have been caught).
- **Severity:** process / internal. **Status:** LAW 7 locked; mechanical follow-ups open.

---

## SECTION B — DEFERRED SCOPE (intentionally postponed features — NOT bugs; do NOT "fix")

### B.1 — 3+-way contact merge

- **What:** merge more than two contacts at once. Current merge UI is pairwise/2-way (`src/modules/contacts/ui/contact-merge-side-by-side.tsx`).
- **Owner:** future Contacts merge enhancement. **Why deferred:** 2-way covers V1; N-way adds UI + conflict complexity.

### B.2 — Address whole-blob picking (merge)

- **What:** in merge, pick an entire address block as one unit vs field-by-field.
- **Owner:** Contacts merge enhancement. **Why deferred:** field-level pick ships V1; whole-blob is a refinement.

### B.3 — Custom-field rich editing / renderer wiring

- **What:** wire `CustomFieldsRenderer` into the Pipeline/Events/Companies UIs + saved-views custom-field columns.
- **file:lines (TODO markers):** `opportunities/actions.ts:135,140`; `projects/actions.ts:90,95`; `companies/actions.ts:31,36`; `custom-fields-renderer.tsx:459` (all tagged `TODO Push P4.x`).
- **Owner:** Push P4.x UI. **Why deferred:** backend exists; UI wiring scheduled for the P4.x UI push.

### B.4 — Native Gmail / Microsoft OAuth (email connector)

- **What:** direct per-provider OAuth connectors, replacing/augmenting Nylas.
- **Owner:** V1.5/V2 migration. **Why deferred:** `docs/decisions-since-may-docs.md:25` — "[LOCKED 06-28] V1 path: Nylas (HoneyBook pattern). Native OAuth deferred to V1.5/V2 migration." (No longer a scheduled cost-driven migration; kept as an option.)

### B.5 — Calendly integration

- **What:** photographer connects Calendly; bookings/reschedules/cancels flow into Pathway.
- **Owner:** V2/V3. **Why deferred:** `docs/decisions-since-may-docs.md:40` — "[LOCKED 06-28] [V2/V3 SCOPE] … NOT V1. Separate build from Nylas … webhooks require the photographer on a PAID Calendly plan."

### B.6 — Thread-reply UI (email)

- **What:** the inline email thread-reply UI surface.
- **Owner:** email round **Commit 5** (activity-feed close-out). **Why deferred:** sequenced after the delivery/notification work; `src/lib/email/nylas.ts` / `email-log` note thread grouping lands in Commit 5.

### B.7 — Outbound SMS send + inbound SMS webhook ingest (polish backlog #18)

- **What:** real outbound SMS (RC SMS REST recommended) + inbound SMS webhook ingest + `sms_messages` `source`/`external_id`/dedup-index migration + send UI.
- **Owner:** Telephony **3b / Push 5+**. **Why deferred:** `sms_messages` JSDoc — "V1 is manual … Provider integration (real outbound + inbound webhook ingest) ships in Push 5+." Bundle with the inbound-call webhook (shared RC webhook subscription infra). **NOT polish** (a feature build).

### B.8 — Contacts sync (Nylas) + Native scheduling (Nylas Scheduler)

- **What:** two-way Gmail/Outlook contacts sync; native booking on Nylas Scheduler.
- **Owner:** V1 future builds (§4.10 / §4.11, `decisions-since-may-docs.md:110,112`). **Why deferred:** ride the same Nylas connection; scheduled after email/notifications.

### B.9 — Workflow action stubs (deferred until their modules/providers ship)

- **What:** `send_invoice`, `take_payment` (Stripe Connect); `send_sms` (SMS provider); `send_smart_document`, `send_smart_doc_for_signature` (Smart Documents); `send_questionnaire` (questionnaires); `send_webhook` (outbound-webhook infra); `create_calendar_event` (calendar provider).
- **file:lines:** `src/modules/ai-workflow-builder/catalog.ts:84-94`; enforced in `workflows/dispatch.ts:107-108`.
- **Owner:** each named module/provider. **Why deferred:** intentionally stubbed until the dependency ships.

### B.10 — Multi-tenant email sender

- **What:** per-org sender domain vs SaaS-rebrand single sender.
- **Owner:** V2. **Why deferred:** `docs/V1_ROADMAP.md:88` + memory `project_multi_tenant_email_sender.md` — V1 is single-tenant K&K; don't bake the single-sender assumption deeper (route everything through `sendEmail`).

### B.11 — Account linking (one email → multiple orgs)

- **What:** relax one-email-one-org; add org switcher + `last_active_organization_id`.
- **Owner:** V2. **Why deferred:** `TODO.md` M18/M19 — V1 enforces one-email-one-org at invite time.

### B.12 — Background dedup scan cron

- **What:** Vercel Cron + results-cache table + notification UI for the existing Push-4 matching engine.
- **Owner:** V1 (deferred from Push 4). **Why deferred:** `docs/pathway-build-roadmap.md:365-369` — matching engine exists; the scheduled scan + surfacing is later.

### B.13 — Notification quiet-hours + digest: settings UI + scheduling + flush cron (Task 17, deferred as ONE unit)

- **What:** the deferred back half of the notification-center build (email round). Three pieces that only make sense TOGETHER: (1) a **quiet-hours + digest settings UI** (the front door — deliberately scoped OUT of the Task 16 settings panel); (2) **scheduling** — actually deferring a notification's delivery per the user's quiet-hours/digest window; (3) a **flush cron** that releases deferred notifications when their window opens / on a digest cadence.
- **Already in place (foundations, do NOT rebuild):** `computeScheduledFor` (`src/modules/notifications/types.ts`) + the `notifications.settings` KV row shape (Task 0 Option A). The engine currently emits every notification immediately (nothing is deferred), so a flush cron built alone would have **nothing to flush** — that's why it's deferred as a unit, not piecemeal.
- **Why deferred (conscious, Mike-approved 2026-07-07):** building the flush cron before the quiet-hours settings UI + scheduling is infrastructure for a feature whose front door isn't open. Ship it as one coherent follow-up: settings UI → scheduling on emit → flush cron, with tests end-to-end.
- **When picked up:** run the standing build path (research → synthesize → options → approval). Pairs with the notification center already shipped (Tasks 1-16 + 12).
- **⚠️ HARD ORDERING CONSTRAINT (final-review finding #2):** the flush cron MUST ship in the SAME unit as any quiet-hours settings writer. `dispatch.ts` already calls `computeScheduledFor` live; the moment a writer populates `user_preferences["notifications.settings"].quietHoursStart/End`, routine-tier notification **emails** get `scheduledFor` set and — with NO flush cron — **never send** (silently swallowed). Today it's dormant (the Task 16 settings UI writes only per-type channel toggles, never quiet-hours fields, so `parseNotificationSettings` yields null → immediate delivery). Do NOT ship a quiet-hours writer without the flush cron.
- **Severity:** deferred scope (not a bug). **Status:** Deferred (named unit).

---

## SECTION C — WATCH ITEMS (flagged — do NOT fix yet; monitor)

> These are explicitly do-not-touch until they actually cause a problem or get a scoped redesign. Touching them prematurely risks regressions. Source: `docs/pathway-ai-architecture.md` "Out-of-scope (locked — do not modify without separate scope)".

### C.1 — `insights-detector.ts` (AI Layer-3 insights) — WATCH / DEFERRED

- **Why watch-only:** verbatim — _"`insights-detector.ts` — watch item, deferred. Touching it now risks breaking lead-status badge insights without a full redesign."_
- **Note:** the real defects in §A.8 (referral miscompute) and §A.9 (brittle status matching) live in this file — they are **frozen here**: fix only inside a scoped insights-detector redesign, not piecemeal.

### C.2 — `lead-status-classifier.ts` (AI Layer-2 status) — LOCKED / DO NOT TOUCH

- **Why watch-only:** verbatim — _"`lead-status-classifier.ts` — separate Haiku call with its own prompt. Status classification is working; touching it risks regressions in the badge."_

### C.3 — Other locked AI surfaces (do not modify without separate scope)

Per the same doc block, treat as watch/locked: empty-floor logic in `regenerate-pipeline.ts` (must keep firing on truly-empty contacts), the `ai_usage_log` table/schema, the AI cache-invalidation hooks in `createContactNote`/`logCall` (polish #5 Fix 8), the 7-day summary cache TTL, the 24-hour lead-status cache TTL, and the fallback chain (no API key → rules; unparseable Haiku → fallback template).

### C.4 — AI "Regenerate" button removal (polish backlog #3) — VERIFY-FIRST, DO NOT REMOVE ON RECOLLECTION

- **Why watch-only:** verbatim from the backlog — Mike recalls agreeing to remove it, but the fix note requires: run `conversation_search "regenerate AI summary"` first; **"If no such decision exists → STOP and surface to Mike for a fresh decision; do not remove based on his recollection alone."** Button still present (`src/modules/contacts/ui/regenerate-ai-button.tsx`).

### C.5 — RC Developer Console phantom scope (polish backlog #17) — OPERATIONAL WATCH

- **Why watch-only:** LOW priority, external. Consent screen listed a role-management permission Pathway never requests in `SCOPES`. Likely a display artifact; verify Console scopes only when convenient (RC admin dashboard, not code). No production risk meanwhile.

---

_End of document. When an item is fixed, change its Status to `Fixed <commit> <date>` in place (do not delete — keep the history). When scope is reclassified, move the item between sections with a dated note._
