# Pathway V1 — Every Decision Made Since the May Docs Froze

**Compiled:** June 27, 2026
**Updated:** June 28, 2026 — Nylas cost figures corrected in §1.2; contacts sync (§4.10), native scheduling (§4.11), and Calendly deferral (§1.6) added; memory list extended to #17.
**Source:** Full reading of transcripts in /mnt/transcripts/ (May 31 – Jun 28, 2026)
**Purpose:** Source of truth for docs/v1-build-catalog.md. The catalog must reflect every decision in this file.

---

## Legend

- **[LOCKED <date>]** — Mike explicitly locked this decision on the given date
- **[MEMORY #N]** — Also stored in Claude runtime memory at this slot; CC prompts must copy the verbatim memory text when relevant
- **[SUPERSEDES <doc/decision>]** — This decision overrides existing locked text in a repo doc; the old doc must be updated
- **[ARCH-LOCK]** — Architectural intent locked; not built in V1 but must be designed forward-compatibly
- **[NEEDS MIKE ADJUDICATION]** — Conflicting locks exist; best read provided + conflict spelled out
- **Source:** filename in /mnt/transcripts/

---

## Section 1 — Provider / Connector Strategy

1.1 **[LOCKED 06-24] [MEMORY #14]** Phone/SMS provider strategy: Twilio is the PRIMARY for both Voice and SMS (for users without an existing phone system). RingCentral is the ALTERNATIVE for businesses with existing RC accounts. Aircall + OpenPhone also planned. Dialpad cut. All phone/SMS code must use a provider-agnostic interface. RC integration exists today; Twilio is a future build.

1.2 **[LOCKED 06-28 — REVERSES 06-27 native-OAuth lock]** Email connector — V1 path: Nylas (HoneyBook pattern). Native OAuth deferred to V1.5/V2 migration.

- Commit 4 = Nylas integration (Aurinko / Unified.to also acceptable equivalents).
- Resend stays as the fallback / system-email path for auth/invite emails and outbound when no Nylas connection exists.
- **Architectural requirement:** Nylas sits behind an EmailProvider interface so a future native-OAuth migration does NOT require a schema refactor. Same shape as the provider-agnostic phone interface in memory #14.
- **Cost (corrected 2026-06-28 from the live Nylas dashboard + nylas.com/pricing):** Building and testing is free in Nylas Sandbox. Production is the Full Platform plan at $15/month, which includes email, calendar, contacts, and scheduling, plus the first 5 connected accounts; each additional connected account is $2/month. A "connected account" = one end-user mailbox or calendar the app links (e.g. a photographer's Gmail or Outlook). Self-serve checkout is SOC 2 Type II with US/EU data residency. For Mike + Kelly: ~$15/month. At scale, cost is linear at ~$2 per connected photographer: ~$205/month at 100, ~$2,005/month at 1,000 — NOT the $15-25/account originally assumed.
- **Native-OAuth migration is no longer a planned cost-driven step:** at ~$2/connected account the "migrate off Nylas once it's painful at scale" rationale is moot. Keep native Gmail/Microsoft OAuth as a far-future option only (e.g. if showing your own brand on the sign-in screen is ever wanted), not a scheduled migration. The EmailProvider interface keeps that option open at no rebuild cost.
- **Calendar reuse:** calendar is included in the same $15 plan and rides the same per-account connection as email, so the Calendar module reuses the email connection at no extra per-account cost.

  1.3 **[LOCKED 06-16]** Google Voice = skipped entirely. Not deferred — explicitly dropped.

  1.4 **[LOCKED 06-16] [V2/Phase-2 SCOPE]** Twilio call/SMS masking = Phase 2 / V2, not V1.

  1.5 **[LOCKED 06-24]** Cloudmersive Virus Scan API = the chosen file scanner. Free tier now; Basic ($19.99/mo) when paid tiers warrant.

  1.6 **[LOCKED 06-28] [V2/V3 SCOPE]** Calendly integration = DEFERRED to V2/V3, NOT V1. This is a SEPARATE build from Nylas — Calendly's own OAuth + v2 REST API + webhooks; Nylas provides nothing here. Pattern: photographer connects their Calendly, and bookings/reschedules/cancels flow into Pathway in real time, matched to the contact by email and logged as a meeting/event. CAVEAT: Calendly webhooks require the photographer to be on a PAID Calendly plan (Professional / Standard / Teams / Enterprise) — free Calendly users cannot use webhooks. Coexists with Pathway's own native scheduler (two scheduling paths, intentional, HubSpot-style). V1 ships native scheduling only.

---

## Section 2 — RC Sync Pivot (June 14–16)

2.1 **[LOCKED 06-16]** Transcript pipeline is DEAD. Replacement: user types short notes after a call; Haiku reads the saved notes and generates a contact-level Overview summary + 1-5 suggested follow-up tasks. Notes stay verbatim; AI never overwrites them.

2.2 **[LOCKED 06-16]** AI summary lives in contact Overview only. Two-level: per-call AI notes (call_log.ai_notes) + contact-level rollup (contacts.aiSummaryText).

2.3 **[LOCKED 06-16]** Disposition picker = 5 controlled values: Connected / No Answer / Voicemail / Canceled / Do Not Contact. The 06-11 6+7 HubSpot set is dead.

2.4 **[LOCKED 06-16]** AI settings = master toggle + per-feature toggles. No per-record toggle.

2.5 **[LOCKED]** AI human-initiated only: every AI call traces to a user save. No background job calls Claude/Haiku.

2.6 **[LOCKED 06-16]** AI task suggestion UX = inline below the saved note. 1-5 task cards each with check + edit-pencil.

2.7 **[LOCKED 06-16]** Tasks tab on contact detail: Open section + Completed section (strikethrough, opacity 0.5, "Completed [date]").

2.8 **[LOCKED 06-16]** Notes box: active call widens the dialer, left = call controls, right = "Type notes as you talk..." On hangup → "Save call" with notes + auto-disposition, user can edit before saving.

2.9 **[LOCKED]** Unmatched-message rule: never auto-create a contact from inbound SMS/call from an unknown number. Log visibly, never auto-create.

2.10 **[LOCKED]** Inline dialer = HubSpot / Aircall / Dialpad pattern, persistent panel, NOT popup.

---

## Section 3 — Contact Tasks + Schema Keystone (June 19)

3.1 **[LOCKED 06-19] [SHIPPED — migrations 0047 + 0048]** Tasks table = nullable project_id + nullable contact_id + CHECK that at least one is non-null. Single tasks table.

3.2 **[LOCKED 06-19] [SHIPPED]** Tasks tab = top-level on contact detail. Order: Overview | Activities | Tasks.

3.3 **[LOCKED 06-19]** Activities feed chips: All / General / [Event 1] / [Event 2] ... plus a filter icon. Event detail page = strict filter to that event. "General" = not linked to any event.

3.4 **[LOCKED 06-19]** Per-user "View all events" permission flag (not a Contractor role). Default = View assigned. RLS re-keyed from role to permission/GUC.

3.5 **[LOCKED 06-19]** Files (Push 11) use the SAME pattern as comms: optional event link + optional contact link + safety rule. No polymorphic table.

3.6 **[LOCKED 06-19]** Contact-task ↔ event-task lifecycle: "Associate to event" sets project_id, contact_id stays. "Remove event association" reverts to contact-scoped. Reassignment via plain UPDATE.

3.7 **[LOCKED 06-19]** Three-case communication scoping: event-scoped (project_id), inquiry-scoped (opportunity_id), or general/unassigned. Canonical for notes/calls/emails/SMS/meetings.

3.8 **[LOCKED 06-19]** Email recipient dedup: one person with multiple roles gets exactly one email, resolved by contact_id with normalized email as backstop. Empty optional roles = skip + log, never fall back to all-contacts.

3.9 **[LOCKED 06-19] [SUPERSEDES "8 roles"]** 6 stored roles / 5 active per migration 0021.

---

## Section 4 — V1 Non-Negotiables Locked in Runtime Memory

4.1 **[MEMORY #3]** Lead capture / booking widget. Tentative Event (Variation A) or Opportunity (Variation B). Slots AFTER P6 Events, before V1 closes.

4.2 **[MEMORY #4]** Email deliverability instrumentation. (a) Resend config audit (DKIM/SPF/DMARC, sender reputation, IP warming); (b) reliable open/click tracking handling Gmail image proxy + scanner false positives.

4.3 **[MEMORY #5]** V3 non-negotiable: Mobile experience. Responsive web field-tested on contact detail, dialer, activity feed, tasks list.

4.4 **[MEMORY #9]** Smart Documents (Proposal + Contract + Invoice). Model exactly like HoneyBook smart files, plus easy mid-flow attribution edits. 06-28: lives INSIDE the Files module. See Section 7.

4.5 **[MEMORY #10]** Product positioning: 50/50 or 60/40 CRM-to-PM split. Reference Asana/ClickUp/Monday/Notion alongside HubSpot/Salesforce/Pipedrive/HoneyBook.

4.6 **[MEMORY #11]** Tasks Module (dedicated /tasks page). Full filter strip, "This week" default, saved views (shareable or private).

4.7 **[MEMORY #12]** Activity feed filter strip. Same HubSpot pattern as Tasks pane, extended to Activity tab.

4.8 **[MEMORY #13]** User removal + bulk record transfer workflow. Removal blocker + reassign modal + bulk transfer.

4.9 **[LOCKED 06-20]** Inbound email + SMS = V1. Inbound email via Resend Inbound webhook. Inbound SMS via RC. IG DMs stay manual. Unified Inbox is V1, ships near end of sequence.

4.10 **[LOCKED 06-28] [MEMORY #15]** Contacts sync via Nylas. Two-way sync between Pathway and the photographer's connected Gmail/Outlook, on the SAME Nylas connection as email (included in the $15 Full Platform plan, no extra per-account cost). User-controlled setting = on/off PLUS a direction choice (out only / in only / both). ONLY Pathway clients/vendors sync — NEVER the photographer's personal address book. Field-level sync (name/email/phone/groups), not enrichment. Exact on/off-plus-direction toggle UI finalized at build; do not invent beyond this.

4.11 **[LOCKED 06-28] [MEMORY #16]** Native scheduling feature (Pathway's own booking, built on Nylas Scheduler; included in the Full Platform plan, no extra per-account cost). User's choice: link it to their Gmail/Microsoft calendar via the Nylas connection for real availability + sync, OR schedule natively in Pathway with sync on or off. Modeled on HubSpot/HoneyBook scheduling. Covers consult booking, the meeting-scheduling form, and the lead-capture booking widget.

---

## Section 5 — V1 Audit Findings (June 20) — Backend Ahead of UI

5.1 **[LOCKED 06-20] [NEEDS MIKE ADJUDICATION — CC verify on disk]** Backend-only modules needing UI: Workflow Builder (engine + AI drafting shipped, no UI), AI Assistant (backend, no dashboard widget), Event tasks + dependencies (engine + state machine, no UI), Pipeline kanban (opportunities backend, no UI). CC must verify on disk before catalog entry.

5.2 **[LOCKED 06-20]** Events detail page = THE KEYSTONE. Comes first among unbuilt UI work.

5.3 **[LOCKED 06-20]** Reports + custom report builder + Financials = V1 critical.

5.4 **[LOCKED 06-20]** V1 build-order preference: cheap UI wins first → Smart Docs + Contracts + Invoices → Reports + Financials → fill-out → Unified Inbox last. (Later superseded by the 06-28 locked queue in Section 12.)

5.5 **[LOCKED 06-20]** Total V1 to feature-complete ≈ 35-50 CC sessions.

5.6 **[LOCKED 06-20]** V1-scoped modules needing catalog entries: Calendar (weekly + monthly), Command palette, Team This Week, Event tasks + dependencies UI, Editing board, Unified Inbox, Reports + Financials, One-pager brief, Notifications center, Smart Documents, Contracts, Files.

---

## Section 6 — Commit 3 Email Infrastructure (June 24–27) — SHIPPED

Shipped as commit 1d3f9ba + follow-ons (84cdf25, ba43695, 38143bd, 2932bd7, cb024b2, 90e3b8a, 774d1c4).

INBOUND: 6.1 multi-match → most recently updated. 6.2 unknown sender IGNORED (no log, no auto-create). 6.3 known reply → log to contact. 6.4 known new email → log to contact. 6.5 known forwards from unknown → log to forwarder, trust From, no body-parse. 6.6 build Resend Received-Emails API fetch (webhook is metadata-only).
OUTBOUND: 6.7 log only sends from the "Create an email" composer. 6.8 exclude auth/invite. 6.9 custom Message-ID with Resend ID fallback. 6.10 thread-replies UI built but NOT user-reachable until Commit 5.
COMPOSER: 6.11 To/CC/BCC. Known CC'd get it on their feed. Unknown CC ignored. BCC'd never logged on their feed.
ATTACHMENTS: 6.12 upload new OR choose existing. 6.13 Cloudmersive scan. 6.14 max 10 files/email. 6.15 per-file ceiling = 1 GB (Cloudmersive Basic scan max; the earlier 2 GB is dead). 6.16 direct attach 25 MB total/email. 6.17 over 25 MB → send-as-link. 6.18 stored in Files, referenced by fileId. 6.19 viewable/downloadable from timeline.
FILE TYPES: 6.20 allow list (PDF/DOCX/images/RAW/MP4/ZIP etc.; HEIC shows a compatibility notice). 6.21 blacklist executables + password-protected archives (Cloudmersive allowPasswordProtectedFiles=false; no custom ZIP parser).
SCAN: 6.22 files.scan_status pending|clean|infected. "Choose existing" shows only clean. "Upload new" polls before send.
SHARE LINKS: 6.23 tokenized expiring URL. 6.24 per-link expiration (NOT per-client). 6.25 body shows expiry. 6.26 reactivation keeps SAME link, no re-approval.
EXPIRATION: 6.27 natural-language options, 1 month default. 6.28 org default 1 month, configurable.
REACTIVATION: 6.29 Reactivate/Extend → same link/token → optional AI-drafted notice email → activity feed logs it.
OPEN TRACKING: 6.30 pixel-based, "Opened [time]" / "Not yet opened". 6.31 honest hover disclaimer. 6.32 no bot filtering in V1. 6.33 link-click tracking on downloads (count + timestamps tied to recipient; no IP/UA).
PASSWORD (auto-send): 6.34 6-digit code, hashed for client, plaintext for photographer, auto-sent ~30s later to PRIMARY (To:) only; same code persists; reactivation keeps it; photographer never enters it. 6.35 per-attachment toggle inline. 6.36 "Sharing & Security" expandable section on file detail (code, copy, regenerate w/ confirm, resend, send-to-different-email, expiration, share log). 6.37 regeneration nulls old, confirm auto-send (default yes). 6.38 rate limit 5 wrong / 15 min → 30-min lockout with live countdown + "Unlock now".
SMART DOC FORWARD-COMPAT: 6.39 [ARCH-LOCK] nullable file_share_links columns version_id, content_hash, requires_approval. No Smart Doc features in Commit 3.
COMPOSER STATE: 6.40 Cancel = HubSpot pattern (discard draft, "Open share link" button reappears). Shipped cb024b2.

---

## Section 7 — Smart Documents Architectural Intent (Locked 06-27, Not Built)

7.1 block-level edit detection. 7.2 "Show Changes" redline = PHOTOGRAPHER-INTERNAL only, default OFF, appears after V1 edited. 7.3 any edit to a signed contract invalidates signature + requires re-sign; no minor-edit exception. 7.4 no per-section editing; edit whole file for material changes. 7.5 abandoned-file trigger = Scenario D (A never opened; B opened not started; C partial then gone), each with its own rolling reminders + 3 trigger message types. 7.6 save as template (new or overwrite). 7.7 [V3] mobile editing parity. 7.8 same-link reactivation for pure reactivation only; edits invalidate.

---

## Section 7A — File Versioning Is System-Wide (Locked 06-28)

7A.1 File versioning applies to ALL files stored in Pathway, not just Smart Documents. file_versions table is first-class. files.current_version_id points to a row; every save creates a new row; old versions stay queryable. file_share_links.version_id points to the version a link was issued against. The Files module (queue position 4) owns the versioning system; Smart Documents is one consumer. Mike verbatim: "versioning should be a part of all files not just smart docs."

---

## Section 8 — Process / Behavior Rules (Memory-Locked)

8.1 **[MEMORY #6]** Read project docs AND research best-in-class software BEFORE suggesting anything. No inferring from training data when docs + research exist.
8.2 **[MEMORY #7]** CC autonomy: pre-authorized for migrations, git, tier verifies, Vercel CLI. Escalate only when blocked/STOP/out-of-scope.
8.3 **[MEMORY #8]** No inventing: never add a number, threshold, default, fallback, behavior, scope item, or requirement Mike didn't state. If a value is missing, STOP and ask. #1 source of bugs.
8.4 **[MEMORY #1, #2]** Plain English, no jargon, all responses. Step-by-step walkthroughs; confirm one step before the next.
8.5 **[LOCKED 06-27]** Pathway Tokenized Resource Rule: random tokens never derived from secrets; per-entry salts; graceful rotation; envelope encryption for future at-rest credentials.
8.6 **[LOCKED]** Zapier tools ignored per standing policy.
8.7 **[LOCKED 06-27]** Research pool size disclosure: always state source pool size; distinguish N=1 anecdote from consensus.

---

## Section 9 — Tasks UI Specifics

9.1 tab kick-off = ?tab=tasks, replace not push. 9.2 AI summary includes all incomplete tasks (cap 5) + event tasks. 9.3 priority = Low/Medium/High, nullable. 9.4 colors: green complete, yellow due-soon (3 days, Pathway-specific), red overdue. 9.5 week boundary = Mon-Sun ISO 8601. 9.6 new-task default assignee = creator. 9.7 reassign allowed on completed. 9.8 Tasks pane filter strip (3-row: search / Filters+dropdowns / pills+Clear all; URL persistence) SHIPPED. 9.9 sort-by-priority within sections. 9.10 avatar tooltips (dark inverted, 300ms) SHIPPED. 9.11 missing-assignee label = "Former team member".

---

## Section 10 — Activity Feed Commit Sequencing (06-24)

10.1 5-commit sequence: C1 shipped (schema 0050 + filter core + loader-bug fixes), C2 shipped (ActivityFilterStrip, unmounted), C3 shipped (email infra, Section 6), C4 = Nylas (per 1.2, was Gmail OAuth), C5 = mount filter strip + swap legacy UI + meeting scheduling local form + test rewrites. 10.2 tabs = type filter, no separate Type dropdown. 10.3 per-tab contextual dropdowns. 10.4 meeting outcome enum: Scheduled/Completed/Canceled/No show/Rescheduled. 10.5 call outcome reuses call_log.disposition. 10.6 event filter = project_id only; add opportunity_id now (forward-compat) but don't expose yet. 10.7 URL prefix a- (aq/adate/aevent/aowner/adir/aoutcome/athread). 10.8 sentinels "No event" + "Unassigned". 10.9 meeting scheduling = local form only; calendar sync waits for Calendar build. 10.10 compose email + SMS via RC + meeting local form built as action backends; no Google/Outlook sync yet. 10.11 new project_id + opportunity_id columns = plain columns only, no triggers/hooks. 10.12 date presets: past (Yesterday/Last Week/Last Month) + present-future (Today/This Week/This Month), Mon-Sun buckets.

---

## Section 11 — Terminology / Data Model

11.1 core object = projects in DB, "Event" on every user surface. 11.2 Inquiry = lifecycle_status Tentative. 11.3 Lead = the inquiring person. 11.4 Pipeline = kanban over Opportunities. 11.5 Planner role = "Planner/Organizer". 11.6 Variation A (date-specific) → Tentative Event + Opportunity; Variation B (dateless) → Opportunity only, requires opportunities.project_id nullable. 11.7 P6 Events schema gaps: opportunities.project_id nullable; comms tables carry project_id + opportunity_id (done C1); project_contacts.role multi-role array + vendor sub-types + is_signer + is_payee; sub-events need start/end times + per-sub-event pricing.

---

## Section 12 — Build Sequence Anchors

### Current in-flight build queue — LOCKED 06-28, exact order:

1. Finish email — Commit 4 (Nylas per 1.2) + Commit 5 (activity feed close-out: mount filter strip, swap legacy UI, meeting scheduling local form, test rewrites).
2. Events module — KEYSTONE (5.2). Scope = wireframe Screen 05 + 06-19 schema gaps (11.7). NOT pre-locked beyond that — requires a real scoping session with Mike before CC starts.
3. Pipeline.
4. Files — Smart Documents lives inside this module. System-wide file versioning (7A) is foundation work here.
5. Finances.
6. Analytics and Reports.
7. Dashboards.
8. Everything else — Tasks /tasks page (4.6), Lead capture widget (4.1), Email deliverability instrumentation (4.2), Calendar (Screen 09), Editing board (Screen 10), Notifications center (Screen 16), Workflow Builder UI (5.1), AI Assistant widget (5.1), Command palette (Screen 02), One-pager brief (Screen 15), CSV migration AI (Screen 19), User removal + bulk transfer (4.8), Unified Inbox (4.9), Contacts sync (4.10, rides the Nylas connection), Native scheduling (4.11, built on Nylas Scheduler).

### Post-V1:

- Calendly integration (1.6) — V2/V3, separate build from Nylas.
- Native Gmail OAuth + MS 365 OAuth — far-future option only (1.2), not a scheduled migration.
- Mobile audit + polish — V3 (4.3).

### Mike's outstanding manual to-dos (deploy-blockers):

- Nylas Full Platform plan + production API key — DONE 06-28.
- Nylas connectors + webhook URL — status updated 07-02-2026:
  - **Google (Gmail) connector — DONE 07-02-2026.** Created and enabled in the Nylas dashboard using a self-owned Google Cloud app (project name "PATHWAY", project id `pathway-501201`, US region). Pub/Sub provisioned (topic: `projects/pathway-501201/topics/nylas-gmail-realtime`). Connector scopes: openid, userinfo.email, userinfo.profile, gmail.modify, gmail.send, calendar, calendar.events, contacts, contacts.other.readonly. Gmail connections are live.
  - **Microsoft connector — NOT DONE, DEFERRED by Mike (07-02-2026)** to after the rest of the build. Blocker: a self-owned Microsoft/Azure app requires creating a free Azure (Entra) tenant, which Microsoft only allows via the Azure free-signup flow that puts a payment card on file; personal Gmail-based logins cannot register apps in Microsoft's default "Microsoft Services" tenant. Nylas has NO free shared-credentials option for Microsoft (unlike Google's, which was also a paid add-on). Revisit when ready to do the Azure signup.
  - **Yahoo, iCloud, and generic IMAP catch-all connectors — NOT DONE, DEFERRED by Mike (07-02-2026)** to after the rest of the build (same "come back to the IMAP-side providers later" decision). AOL rides the generic IMAP connector.
  - **Mike's exact instruction:** skip Microsoft and IMAP for now, come back to them, and add those connectors after the rest is built. Until each connector is created in the Nylas dashboard, its option in Pathway's provider picker will fail gracefully with the "may not be set up yet" message — expected, not a bug.
- RESEND_WEBHOOK_SECRET in Vercel env.
- Resend dashboard MX config (mail.kandkphotography.com — DKIM/SPF/DMARC).
- SHARE_LINK_HMAC_SECRET in Vercel env.

---

## Section 13 — Stale-Doc Conflict Map (Items CC Must Update)

When docs/v1-build-catalog.md is written, mark SUPERSEDED sections in: V1_ROADMAP.md (telephony order, email connector, disposition, tasks tab), pathway-build-roadmap.md (telephony, Google Voice, Resend-outbound), docs/spec/Photography_CRM_PM_V1_Build_Spec.md (8 roles, transcript pipeline, disposition), INTEGRATION_STRATEGY.md (Google OAuth-not-V1-task, RC prove-it, Resend outbound-only), PIVOTS_LEDGER.md (add entries listed below). Banner format: "SUPERSEDED by docs/v1-build-catalog.md §X.Y as of <date>. See docs/decisions-since-may-docs.md."
New PIVOTS_LEDGER entries: RC transcript → user notes (06-14); disposition 6+7 → 5 (06-16); telephony → Twilio PRIMARY (06-24); email connector → Nylas for V1, native OAuth deferred (06-28, reverses 06-27); Files ceiling 2 GB → 1 GB (06-24); Tasks tab top-level (06-19); V1 scope: Smart Docs + Reports + Financials (06-20); Unified Inbox inbound email + SMS = V1 (06-20); Activity Feed 5-commit sequencing (06-24); Smart Docs arch locked, build deferred (06-27); Contacts sync + native scheduling = V1 (06-28); Calendly deferred to V2/V3 (06-28).

---

## Section 14 — Adjudications (Resolved 06-28)

14.1 Disposition picker → 5 values FINAL (Connected / No Answer / Voicemail / Canceled / Do Not Contact). 14.2 Files per-file ceiling → 1 GB FINAL. 14.3 Backend-complete claim for Workflow Builder + AI Assistant + Event tasks/dependencies + Pipeline kanban → "V1 — needs full CC on-disk audit before catalog entry."

---

## Section 15 — Memory-Verbatim Reference (for CC Prompt Use)

#1 Pathway north star (LOCKED): best-in-class CRM UX like HubSpot/Salesforce, WITHOUT bloat/integration-overload/one-size-fits-all confusion. Simple+streamlined AND robust+integrated+intelligent. MUST be fully usable by non-technical humans — no jargon in UI, no architecture exposed, no developer-mode assumptions.
#2 Communication (LOCKED): plain English, no tech jargon, all responses. Real-world terms. Step-by-step walkthroughs; confirm one step before the next.
#3 V1 — Lead capture / booking widget. (§4.1)
#4 V1 — Email deliverability instrumentation. (§4.2)
#5 V3 — Mobile experience. (§4.3)
#6 Process — read docs + research best-in-class first. (§8.1)
#7 CC autonomy. (§8.2)
#8 NO INVENTING. (§8.3)
#9 V1 — Smart Documents. (§4.4)
#10 Positioning — 50/50 to 60/40 CRM-to-PM. (§4.5)
#11 V1 — Tasks Module /tasks page. (§4.6)
#12 V1 — Activity feed filter strip. (§4.7)
#13 V1 — User removal + bulk record transfer. (§4.8)
#14 Phone/SMS — Twilio PRIMARY, RC alternative, provider-agnostic interface. (§1.1)
#15 V1 — Contacts sync via Nylas: two-way, on the same Nylas connection as email (included in $15 plan, no extra per-account cost), user-controlled on/off PLUS direction choice (out/in/both), ONLY Pathway clients/vendors (never the personal address book), field-level sync not enrichment. (§4.10)
#16 V1 — Native scheduling feature built on Nylas Scheduler (included in the Full Platform plan, no extra per-account cost): user's choice to link Gmail/Microsoft calendar for real availability + sync OR schedule natively with sync on/off; HubSpot/HoneyBook style; covers consult booking, meeting form, lead-capture widget. (§4.11)
#17 Calendly integration = V2/V3, NOT V1. Separate build from Nylas (Calendly OAuth + v2 API + webhooks). Bookings flow into Pathway matched by email. Webhooks require the photographer on a PAID Calendly plan. Coexists with the native scheduler. (§1.6)
#18 V1 scope item (research-first) — Onboarding tutorial / guided product tour: in-app guided onboarding that walks a new photographer through setup and teaches them to use each page effectively. Serves north star #1 (usable without help docs). Distinct from the setup wizard (Screen 18). MUST be scoped + researched before building; do not design/build until the scoped plan is approved. (See §17.)

---

## Section 16 — What CC Must Do With This File

1. Read this entire file before drafting docs/v1-build-catalog.md.
2. Audit each entry against repo state — confirm shipped commits, migrations, and running modules.
3. The three ambiguities in §14 are RESOLVED. Only the §5.1 / §14.3 backend-complete claims still need a CC on-disk verify before catalog entry.
4. Update the conflicting docs per §13 in the same commit as the catalog write; mark superseded, do not delete.
5. Add the new PIVOTS_LEDGER entries per §13.
6. Do NOT invent any entry not in this file. If something is needed that this file doesn't cover, STOP and ask Mike.

---

## Section 17 — Onboarding Tutorial / Guided Product Tour (scope item — research + scope BEFORE build)

17.1 **[LOCKED 06-28 — scope item, NOT yet designed]** Pathway needs a guided onboarding experience that walks a new photographer through setting up their system and teaches them to use it effectively — an in-app tutorial/guide with messaging that walks them through the pages and shows them how to use the system well. Directly serves the north star (memory #1): the product must be fully usable by a non-technical photographer without external help docs.
17.2 **Status: do NOT build yet.** Mike's explicit direction: this must be scoped out AND researched against best-in-class onboarding / product-tour patterns BEFORE any build, to ensure it ships best-in-class. A scope + research session with Mike is required first. Do not design or build until Mike approves the scoped plan.
17.3 **Relationship to existing wireframes:** distinct from the Onboarding Wizard (wireframe Screen 18, the 5-question account setup) and CSV Migration (Screen 19). Those configure the account; this tutorial teaches the photographer to USE the system, page by page.
17.4 **To be decided at scope time (do NOT invent):** V1-vs-later slotting; which pages/flows the tour covers; trigger and timing; messaging tone; format (interactive walkthrough vs. tooltips vs. checklist vs. video); dismiss/replay behavior. Research targets: best-in-class SaaS onboarding and product tours, plus how HoneyBook / Dubsado / HubSpot onboard non-technical users.

---

## Section 18 — Events/PM Views + Timeline/Dependency Decisions (07-08)

18.1 **[LOCKED 07-08 — REVERSES the earlier "no Gantt / no critical-path" call]** **Timeline/Gantt view is IN.** Rationale: wedding tasks are interconnected, sub-projects overlap in time, and dates change often (esp. shoot/session dates) — manually re-dating every downstream task when a date moves is the misery to eliminate. Tasks render as bars showing overlap + dependencies, viewable at **BOTH levels**: **project level** (ALL sub-projects on one shared timeline, so cross-sub-project overlaps are visible — e.g. engagement editing finishing before the wedding, album work overlapping the tail of wedding editing) AND **sub-project level** (drill into one sub-project, every task on its own row).

18.2 **[LOCKED 07-08 — the core value]** **Dependency DATE-CASCADE.** When a task/sub-project date moves, dependent tasks **auto-reschedule** relative to it. **Manual override of any individual date is still allowed, and a manual override STOPS cascading for that specific task (it becomes pinned).**

18.3 **[LOCKED 07-08 — conscious skip]** Full **critical-path BOTTLENECK ANALYSIS** (auto-highlighting the longest chain + slack calculations) is **SKIP / lightweight-only, deferred.** The date-cascade is the value; the bottleneck-analysis layer is enterprise bloat — skip or keep very lightweight, later.

18.4 **[LOCKED 07-08 — final task view set, trimmed to avoid bloat]** **KEEP: List, Board, Timeline/Gantt.** **CUT: Table** (too similar to List — List already does the job with phase grouping + gating; not worth the extra surface). **Calendar stays SEPARATE** (upcoming tasks + who's assigned), NOT a task-view tab. (Supersedes the `docs/pm-lifecycle-vision-and-events-prep.md` §2 "Board/List/Timeline/Table" view list.)

18.5 **[APPROVED 07-08 — working design direction]** The interactive PM wireframes reviewed this session — **linear-vs-branching dependency tree, the 3-view switcher (List / Board / Gantt), and the project-level vs sub-project-level timeline** — are approved as the working design direction for the Events/PM views. **P6 references them.**

18.6 **[Feature — tracked in `docs/features-backlog.md` F7]** User-created sub-project type templates (self-serve workflow building): users build/save/edit their own reusable sub-project types (tasks + dependencies), reusable across projects, generating into the SAME task-tree/workflow schema as the shipped templates + AI-import (shared generation target, `pm-lifecycle-vision-and-events-prep.md` §10.3). Relabelable per vertical.

### 18.7–18.11 — Events / Tasks / Pipeline / Calendar navigation + screen homes (07-08)

**Reconciles with the existing V1 wireframe — does NOT rebuild or change it.** Sidebar nav stays as-is: **Dashboard / Contacts / Events / Pipeline / Tasks / Settings.** Wireframe Screen 08 (Team This Week), Screen 09 (Calendar), Screen 07 (per-event tasks) stand. This section only clarifies which job lives on which screen.

18.7 **[LOCKED 07-08] Per-event Tasks/PM screen — PER-EVENT ONLY.** Each event has its OWN dedicated Tasks/PM screen = that event's task tree + dependencies + Gantt + soft-gates (the deep-work surface for ONE event). It is **strictly per-event / per-project — it NEVER shows all-events tasks** (that job is Calendar, 18.8). It does **NOT** get its own left-sidebar tab (no sidebar change). Reached by drilling IN:

- (a) **Pipeline Kanban board → DOUBLE-CLICK a card** opens that event's Tasks/PM screen. Single-click/drag is reserved for moving a card between stages, so opening the detail MUST be double-click, not single-click.
- (b) **Events tab → opening an event** (whose task list is created when the event is booked) opens that event's full Tasks/PM screen.
  (Note: this is distinct from the sidebar **Tasks** tab — the dedicated /tasks list page, memory #11 — which stays as-is; the per-event Tasks/PM deep screen is a drill-in, not that list.)

18.8 **[LOCKED 07-08] Calendar = the all-events upcoming / workload view (CONFIRMS + extends Screen 09).** Upcoming tasks/deliverables ACROSS ALL booked events live here — NOT in Tasks/PM. Views: **Day / Week / Month / Agenda** (already in Screen 09) PLUS **custom date range** (new), quickly switchable. **CAPACITY-PLANNING behavior:** heavy/crunch days stand out visually — a day cell surfaces its LOAD (e.g. "Jun 23 — 2 weddings shooting + 3 galleries due; day before has 2 culls; day after owes sneaks for 2 weddings"), so the user spots collisions before they hit and can plan (move a delivery, add a 2nd shooter, warn a client). Highlight daily LOAD, don't just list tasks. **Ties to Gantt/date-cascade (§18.2):** moving an overloaded day's delivery reschedules dependents.

18.9 **[LOCKED 07-08] Team This Week = people / assignment view (CONFIRMS Screen 08, unchanged).** Assigning people to tasks and seeing who's doing what lives here — NOT in Tasks/PM, NOT in Calendar. Per-person workload.

18.10 **[LOCKED 07-08 — Law 5 clarity: three distinct homes, no overlap]**

- **Tasks/PM** = deep work on ONE event (per-event only).
- **Calendar** = all-events time/workload view with crunch-day highlighting.
- **Team This Week** = people / assignment.

18.11 **[SUPERSEDES]** This supersedes the earlier working idea of an "all-events workload view inside the Tasks section" — that job belongs to **Calendar** (18.8) per the wireframe.

---

**End of inventory.**
