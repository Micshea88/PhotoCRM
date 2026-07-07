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
