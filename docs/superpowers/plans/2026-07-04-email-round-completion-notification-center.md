# Email-Round Completion + Notification Center — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **PLAN DOCUMENT ONLY.** No code, migrations, or commits were produced in authoring this. Per the standing CC-audits-first rule, **execution MUST begin with the Task 0 read-only audit** to re-confirm every file:line and schema fact below against current `main` before writing anything. Facts here are point-in-time (authored 2026-07-04, against migration 0054, git `ceef24e`).

**Goal:** Complete the email round by giving both send paths (Nylas connected-mailbox + Resend fallback/system) a unified delivery-event model with real bounce/complaint/failure/reply handling and grant-expiry, and build a reusable, greenfield in-app + email **Notification Center** that Pathway's other modules (Events, Pipeline, Calendar, Files) will later emit into.

**Architecture:** One append-only `email_delivery_events` table both paths write to (Nylas webhook types + Resend webhook types), plus denormalized status columns on `email_log` for fast timeline reads. Bounce/failure/disconnect/reply become notifications via a new **platform-generic `notifications` module** (bell/inbox + optional email, per-user × per-type × per-channel preferences, critical vs. routine tiers, own-action suppression). Opens stay log-only with a bot-vs-human classifier feeding a collapsed "Opens" UI that is honest about Apple MPP. Grant-expiry writes `email_connections.status="expired"` and drives a plain-English reconnect banner.

**Tech Stack:** Next.js (App Router, route handlers), React, Drizzle ORM + Neon Postgres (RLS), Better Auth, Vercel cron + queue jobs, Resend (Svix-signed webhooks + system mailer), Nylas v3 (grant-based email), existing `resend().webhooks.verify()` Svix verification.

---

## Global Constraints

Copy these into every task's working context. Values are verbatim locked decisions + house rules.

- **Sequencing = all-at-once.** Notification center is shared platform infra, not an email feature. Design the `notifications` module so any module can emit; email is its first producer.
- **Delivery events come from the provider's real event, NEVER reply-parsing** (avoid HubSpot's missed-bounce trap where a bounce is only caught if it's a direct reply).
- **`grant.expired` MUST write `email_connections.status="expired"`** — currently never written by any code (`isSendable` only reads it; `queries.ts:96-99`).
- **Resend bounce webhook = reuse the EXISTING endpoint + existing `RESEND_WEBHOOK_SECRET`.** Add `email.bounced` / `email.complained` / `email.delivered` to that one endpoint; branch the route by `event.type`. **Do NOT add a new endpoint or secret.**
- **NOTIFY types:** bounce/not-delivered, send-failure, inbox-disconnected/grant-expired (→ mailbox **owner + org admins**), reply-received.
- **LOG-ONLY types (no alert; still shown on timeline/threads with status + timestamp):** opens, clicks, ordinary sends, ordinary receives.
- **Never notify a user about their OWN action** — extended to automation/rule-triggered email the user configured. **But** bounces/failures on automated email STILL notify (the failure is not the user's "action").
- **No notification type is ever locked / non-disableable** (ClickUp's most-hated design choice).
- **Critical tier (bounce / fail / disconnect / @mention) = always delivered individually + guaranteed** (never batched away). **Routine tier = digestible.**
- **Read-state authoritative + cross-device** (server is source of truth; the "badge won't clear" bug hit Monday's CRM — do not repeat).
- **Automated emails remain first-class:** fully logged in the activity feed, shown in inline threads, open/click + delivery tracked exactly like manual email. Only the redundant self-notification is suppressed.
- **Opens are NEVER a notification.** Opens UI is directional and MPP-honest.
- **RLS:** every new table is org-scoped with an org-isolation policy AND `FORCE ROW LEVEL SECURITY` **hand-appended** to the generated migration (drizzle-kit emits ENABLE, not FORCE — AGENTS.md hard rule 10a). Mirror the `email_log` / `email_connections` policy.
- **Migrations:** additive only, no destructive column drops; generated into `src/db/migrations`, next number is **0055+**; schema in `src/db/schema.ts`; config `drizzle.config.ts`.
- **No new runtime dependencies** and **no new env vars/secrets** are required by this plan. Quiet-hours/timezone/digest settings are stored as a KV row in the existing `user_preferences` table (no new table, no migration to it). Flag loudly if any task discovers otherwise.
- **TDD, DRY, YAGNI, frequent commits.** Follow existing module conventions (`server-only`, `queries.ts`/`actions.ts`/`schema.ts` split, safe-action wrappers, org-scoped queries).

---

## File Structure / Module Map

**New module — `src/modules/notifications/` (platform-generic):**

- `schema.ts` — `notifications`, `notification_preferences` tables.
- `types.ts` — `NotificationType` enum, `NotificationChannel` enum, tier map, payload types.
- `dispatch.ts` — the single emit entrypoint every producer calls (`emitNotification`); applies preferences, tiering, own-action suppression, quiet-hours deferral, channel fan-out.
- `queries.ts` — org+user-scoped reads (bell list, unread count, preference fetch).
- `actions.ts` — safe-actions: mark-read, mark-all-read, archive, update preference.
- `email.ts` — renders + sends the optional notification email via the existing system mailer (`src/lib/email.ts:sendEmail`).
- `README.md` — how other modules emit (the plug-in contract).

**New module — `src/modules/email-delivery/`:**

- `schema.ts` — `email_delivery_events` table.
- `ingest.ts` — `recordDeliveryEvent()` — the unified writer both webhook paths call; updates denormalized `email_log` status + emits notifications for bounce/fail/complaint.
- `classify-open.ts` — bot-vs-human open classification.
- `queries.ts` — delivery-status + open-breakdown reads for the timeline/thread UI.

**Modified — email send + webhooks:**

- `src/modules/email-connections/schema.ts` — no new columns needed for expiry (status exists); add `expired_at`, `expired_reason` (nullable) for the reconnect banner copy.
- `src/modules/email-connections/nylas-inbound.ts` — rename/extend to dispatch webhook by `event.type` (today hard-drops all but `message.created` at `:54`).
- `app/api/webhooks/nylas/inbound/route.ts` — unchanged shape (still acks 200; still passes raw body + sig); handler does the branching.
- `app/api/webhooks/resend/inbound/route.ts` — branch by `event.type`: inbound-email → existing `ingestInboundEmail`; `email.bounced`/`email.complained`/`email.delivered` → `recordDeliveryEvent`.
- `src/modules/email-log/inbound.ts` — extract the Svix `verify` so both the inbound and delivery branches reuse one verifier (DRY).
- `src/modules/email-log/schema.ts` — add denormalized delivery-status columns (see data model).
- `src/lib/email/nylas.ts` — no tracking flags added (opens stay Pathway's pixel); confirm inbound-fetch reused for `thread.replied`.
- `src/modules/user-preferences/` — **no schema change.** Quiet-hours/timezone/digest are stored as a single KV row (`key="notifications.settings"`) in the existing `user_preferences` table (user-scoped RLS). Use its existing get/set-by-key accessors; add a typed accessor for the settings shape if the module doesn't already expose one.

**Modified — UI:**

- Activity-feed / email-thread components (existing email-log UI) — render delivery-status badge + the collapsed "Opens" control.
- Integrations area (`app/api/integrations/nylas/callback` neighbors + the integrations settings UI) — persistent reconnect banner.
- App shell — the notification bell + inbox panel.
- User settings — the notification preference matrix + timezone/quiet-hours.

---

## Data Model (new tables + columns)

### New table: `email_delivery_events` (append-only)

| Column              | Type                               | Notes                                                                                   |
| ------------------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| `id`                | text PK (cuid2)                    |                                                                                         |
| `organization_id`   | text NOT NULL FK→organization      | RLS scope                                                                               |
| `email_log_id`      | text NOT NULL FK→email_log(id)     | the message this event is about                                                         |
| `path`              | text NOT NULL                      | `"nylas"` \| `"resend"`                                                                 |
| `type`              | text NOT NULL                      | `sent` \| `delivered` \| `bounced` \| `failed` \| `complained` \| `opened` \| `clicked` |
| `bounce_class`      | text NULL                          | `hard` \| `soft` \| null (bounces only)                                                 |
| `detail`            | jsonb NULL                         | raw provider reason / message, defensively parsed                                       |
| `provider_event_id` | text NULL                          | for dedup (Svix `svix-id` / Nylas event id)                                             |
| `occurred_at`       | timestamptz NOT NULL               | provider timestamp                                                                      |
| `created_at`        | timestamptz NOT NULL default now() |                                                                                         |

- Partial **unique index** on `(organization_id, provider_event_id)` where `provider_event_id` is not null → idempotent webhook redelivery.
- Index `(organization_id, email_log_id, occurred_at desc)` for per-message timeline.
- RLS org-isolation policy + `FORCE ROW LEVEL SECURITY` (hand-appended).

### New columns on `email_log` (denormalized for fast reads)

| Column               | Type                           | Notes                                                                                                        |
| -------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `delivery_status`    | text NOT NULL default `"sent"` | `sent` \| `delivered` \| `bounced` \| `failed` \| `complained`                                               |
| `bounced_at`         | timestamptz NULL               |                                                                                                              |
| `bounce_reason`      | text NULL                      | plain-English, derived from `detail`                                                                         |
| `failed_at`          | timestamptz NULL               |                                                                                                              |
| `open_human_count`   | integer NOT NULL default 0     | classifier "likely human" → UI row **"Likely Human"**                                                        |
| `open_bot_count`     | integer NOT NULL default 0     | classifier "bot/scanner" (internal name) → UI row label is **"Automated Open"** (never "Bot" — reads spammy) |
| `open_unknown_count` | integer NOT NULL default 0     | MPP/ambiguous → UI row **"Unknown"**                                                                         |

- Keep existing `open_count` as the raw total (`= human+bot+unknown`) for back-compat; the three new counters are the classified split. **Store the raw count + classification internally regardless of what the UI displays** (settled 2026-07-04). The internal classifier category stays `bot`; only the user-facing row label is "Automated Open".

### New columns on `email_connections`

| Column           | Type             | Notes                               |
| ---------------- | ---------------- | ----------------------------------- |
| `expired_at`     | timestamptz NULL | set when `grant.expired` handled    |
| `expired_reason` | text NULL        | plain-English cause for banner copy |

### New table: `notifications`

| Column                      | Type                          | Notes                                                                         |
| --------------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `id`                        | text PK (cuid2)               |                                                                               |
| `organization_id`           | text NOT NULL FK→organization | RLS scope                                                                     |
| `recipient_user_id`         | text NOT NULL FK→user         | who sees it                                                                   |
| `type`                      | text NOT NULL                 | see `NotificationType` (extensible; email types today)                        |
| `tier`                      | text NOT NULL                 | `critical` \| `routine`                                                       |
| `title`                     | text NOT NULL                 | rendered, plain-English                                                       |
| `body`                      | text NULL                     |                                                                               |
| `link_path`                 | text NULL                     | deep link (e.g. the contact/thread, or integrations reconnect)                |
| `payload`                   | jsonb NULL                    | source refs (emailLogId, connectionId, contactId, actorUserId, source module) |
| `source_module`             | text NOT NULL                 | `"email"` today; future producers self-identify                               |
| `read_at`                   | timestamptz NULL              | authoritative read-state                                                      |
| `archived_at`               | timestamptz NULL              |                                                                               |
| `scheduled_for`             | timestamptz NULL              | quiet-hours deferral; null = deliver now                                      |
| `email_sent_at`             | timestamptz NULL              | if the email channel fired                                                    |
| `created_at` / `updated_at` | timestamptz NOT NULL          |                                                                               |

- Index `(organization_id, recipient_user_id, read_at, created_at desc)` for bell/unread.
- Index `(scheduled_for)` partial where not null — the quiet-hours/digest flush cron scans this.
- RLS: org-scoped AND recipient-scoped read; `FORCE ROW LEVEL SECURITY`.

### New table: `notification_preferences`

| Column                      | Type                          | Notes                    |
| --------------------------- | ----------------------------- | ------------------------ |
| `id`                        | text PK (cuid2)               |                          |
| `organization_id`           | text NOT NULL FK→organization | RLS scope                |
| `user_id`                   | text NOT NULL FK→user         |                          |
| `type`                      | text NOT NULL                 | one row per (user, type) |
| `in_app`                    | boolean NOT NULL              | channel toggle           |
| `email`                     | boolean NOT NULL              | channel toggle           |
| `created_at` / `updated_at` | timestamptz NOT NULL          |                          |
| unique                      | `(user_id, type)`             |                          |

- **No row = fall back to the coded default** for that type (quiet defaults; see matrix). A type is never "locked": the UI always renders both channel toggles as editable.
- **Org-default preferences are DEFERRED (out of scope, settled 2026-07-04).** This build ships per-user preferences with coded defaults only. When other modules begin emitting / the team grows, add an admin-set org-default layer (Monday-style: defaults applied to new users, existing users unaffected) as a future add-on. Design the default-resolution so a future org-default tier can slot in between "coded default" and "user row" without a rewrite.

### Quiet-hours / timezone / digest settings — **KV row in existing `user_preferences` (Option A, approved 2026-07-04)**

`user_preferences` is a **generic key/value store** (`src/modules/user-preferences/schema.ts`: `id, user_id, organization_id NULLABLE, key, value jsonb, timestamps`), **user-scoped RLS** (`user_id = current_setting('app.current_user_id')`), no soft-delete. **No new columns, no migration to `user_preferences`.**

Store all notification timing settings as ONE key/value row per user:

- `key` = `"notifications.settings"` (org-global for the user → `organization_id` NULL, following the existing global-pref precedent).
- `value` jsonb shape:

| Field             | Type                               | Notes                                                                 |
| ----------------- | ---------------------------------- | --------------------------------------------------------------------- |
| `timezone`        | string \| null                     | IANA tz; null → fall back to org tz or UTC + browser-detected capture |
| `quietHoursStart` | number \| null                     | 0–23 local hour; null = disabled                                      |
| `quietHoursEnd`   | number \| null                     | 0–23 local hour                                                       |
| `digestFrequency` | `"off"` \| `"daily"` \| `"weekly"` | default `"off"` (routine tier only)                                   |

- Read/written via the existing user-preferences module accessors (get/set by key); Task 16 UI and Task 17 flush cron both go through that accessor. Absent row → defaults (`digestFrequency:"off"`, quiet-hours disabled).

---

## The Preference Matrix (types, tiers, channels, defaults)

| Type                                 | Tier     | Default in-app           | Default email | Own-action suppressed?                                                              | Notes                                                     |
| ------------------------------------ | -------- | ------------------------ | ------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `email.bounced`                      | critical | ON                       | ON            | No (failure ≠ user action)                                                          | owner of the sending mailbox/user + org admins            |
| `email.complained`                   | critical | ON                       | ON            | No                                                                                  | spam-complaint; treat like bounce                         |
| `email.send_failed`                  | critical | ON                       | ON            | No                                                                                  | Nylas `message.send_failed` or Resend failure             |
| `email.disconnected` (grant.expired) | critical | ON                       | ON            | No                                                                                  | → mailbox **owner + org admins**; drives reconnect banner |
| `email.reply_received`               | routine  | ON                       | OFF           | Yes (never notify replies to your own thread action; notify on the _inbound_ reply) | inbound reply matched to a contact                        |
| `email.opened`                       | —        | **never a notification** | —             | —                                                                                   | log-only; timeline "Opens" UI                             |
| `email.clicked`                      | —        | never a notification     | —             | —                                                                                   | log-only (share-link downloads today)                     |
| `email.sent` / `email.received`      | —        | never a notification     | —             | —                                                                                   | log-only timeline entries                                 |

- **Critical tier** ignores quiet-hours/digest: always immediate + individual.
- **Routine tier** (`reply_received`) obeys quiet-hours deferral and can roll into a digest if the user set `digest_frequency`.
- **Own-action rule** is enforced in `dispatch.ts`: if `payload.actorUserId === recipient_user_id` → suppress. Extended: automation/workflow-sent email carries the configuring user as actor, so "your automation sent X" self-notifications are suppressed — but a _bounce_ on that automated send has no user actor (or actor = system) → it still notifies.

---

## Webhook Handler Changes

### Nylas (`nylas-inbound.ts` → dispatch by `event.type`)

Today: `if (event.type !== "message.created") return 0` (`:54`) drops everything else. Change to a dispatch:

- `message.created` → existing inbound ingest (unchanged).
- `message.bounce_detected` → `recordDeliveryEvent({path:"nylas", type:"bounced", ...})`.
- `message.send_failed` → `recordDeliveryEvent({path:"nylas", type:"failed", ...})`.
- `thread.replied` → resolve to the contact/thread and record a `reply_received` (reuses `nylasFetchMessage` for the body). _Note:_ inbound replies are already captured via `message.created`; `thread.replied` is used to fire the **notification** without double-logging — dedup on `provider_event_id`.
- `grant.expired` → set `email_connections.status="expired"`, `expired_at`, `expired_reason`; emit `email.disconnected` to owner + admins.
- Unknown types → ack 200, no-op (route already always acks 200).

Signature verification (`verifyNylasSignature`) unchanged; still requires `NYLAS_WEBHOOK_SECRET` (already provisioned this round).

### Resend (`app/api/webhooks/resend/inbound/route.ts` → branch by `event.type`)

- Verify once with the shared Svix verifier (existing `RESEND_WEBHOOK_SECRET`).
- `inbound`/received-email event → existing `ingestInboundEmail`.
- `email.bounced` → `recordDeliveryEvent({path:"resend", type:"bounced", bounce_class:"hard|soft"})`.
- `email.complained` → `recordDeliveryEvent({type:"complained"})`.
- `email.delivered` → `recordDeliveryEvent({type:"delivered"})`.
- **Dashboard step (manual, documented in plan, NOT code):** in Resend, add the three event types to the existing webhook endpoint. No new endpoint, no new secret.

### Unified writer: `recordDeliveryEvent()` (in `email-delivery/ingest.ts`)

- Idempotent insert into `email_delivery_events` (dedup on `provider_event_id`).
- Updates denormalized `email_log` status columns.
- For `bounced`/`failed`/`complained` → calls `emitNotification` (critical tier) to the sending user + org admins with plain-English `bounce_reason`.
- For `opened` (from the pixel route, not a webhook) → runs `classifyOpen()` and increments the matching classified counter.

---

## Open-Tracking Classification + UI

### Classifier (`email-delivery/classify-open.ts`)

Input: request IP, User-Agent, time-since-send, prior opens for this pixel. Output: `"human" | "bot" | "unknown"`.
Layered rules (documented honestly as best-effort, not exact):

1. **Apple MPP** → `unknown`: match Apple's published egress-IP ranges (Apple's `mask-api.icloud.com/egress-ip-ranges.csv`, fetched + cached daily) and/or the machine-open signal. MPP opens are fundamentally unresolvable → they go to **Unknown** (often the largest bucket).
2. **Known proxy/scanner UAs** → `bot`: `GoogleImageProxy`/`ggpht`, security-vendor and AI-agent UAs.
3. **Datacenter IP ranges** (AWS/GCP/Azure/known security vendors: Proofpoint, Mimecast, Microsoft) → `bot`.
4. **Timing heuristic** → `bot`: open firing within a few seconds of send (pre-delivery scanner behavior).
5. Otherwise → `human` (still imperfect; residual error acknowledged).

**Honesty in the plan (must survive into the ⓘ copy):** even at best this cannot produce a trustworthy human _count_ — Apple MPP alone obscures ~half of opens and human-vs-prefetch is indistinguishable per SendGrid; corporate scanners aren't fully strippable. The classifier's job is to move the obvious machine noise out of "human," not to certify a number.

### UI

- Collapsed control on a sent message: **`ⓘ Opens: 5 ›`** (5 = raw total).
- Expands to: **`Likely Human · N | Automated Open · N | Unknown · N`** — the middle bucket's row label is exactly **"Automated Open"** (NOT "Bot" — reads spammy), settled 2026-07-04.
- The **ⓘ popout** (plain English, no jargon): "Opens are an estimate, not an exact number. The **'Automated Open'** counts are automated opens from bots and email security scanners — not people. Apple Mail Privacy also hides whether many opens are real people, so those land in **'Unknown'**, which is often the largest group. Use opens as a rough, directional signal — **clicks and replies** are far more reliable."
- Opens are **never** a notification.

---

## Grant-Expiry / Reconnect UX

- On `grant.expired`: status→`expired`, store `expired_reason`; sends continue via dressed Resend fallback (existing behavior — never a blocked send).
- Notify mailbox **owner + org admins** (`email.disconnected`, critical).
- **Persistent banner in the integrations area** (plain English, actionable), e.g.: _"Your Gmail connection stopped working, so new emails are going out from your studio's Pathway address instead. Reconnect to send from your own inbox again."_ → **[Reconnect]** button (re-runs the existing Nylas OAuth connect flow). No raw error codes/jargon.

---

## Quiet-Hours / DND + Digests — Lift Assessment (Item 7)

**Verdict: LOW-to-MODERATE lift — INCLUDED (quiet-hours AND digests), settled 2026-07-04.** Not a significant scope expansion, because the flush mechanism reuses existing infrastructure.

- **Reuses existing infra:** Vercel **cron** (`app/api/jobs/cron/*`, `CRON_SECRET`) and **queue** (`app/api/jobs/queue/*`, `QUEUE_SECRET`) already exist. Quiet-hours = write routine-tier notifications with `scheduled_for` set to the end of the user's quiet window; a new cron route (`app/api/jobs/cron/notifications-flush`) scans due `scheduled_for` rows and delivers. **Digests (IN SCOPE)** = the same cron groups a user's routine notifications and sends one email per `digest_frequency`.
- **Critical tier bypasses both** — always immediate.
- **Per-user timezone (APPROVED — Option A):** stored as a single KV row (`key="notifications.settings"`, value `{timezone, quietHoursStart, quietHoursEnd, digestFrequency}`) in the existing `user_preferences` table — no new columns, no migration to it — plus a small capture UX (browser-detected default). This is _less_ work than a schema change, so the low-lift assessment holds.

---

## Build Order

Each task ends with an independently testable deliverable and a commit. Tests are Vitest (unit) + existing integration harness (RLS suites live in `tests/integration/`). TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.

- [ ] **Task 0 — Read-only audit (MANDATORY FIRST, no writes).** Re-confirm every file:line and schema claim in this plan against current `main`: the Nylas dispatch guard (`nylas-inbound.ts:54`), Resend inbound route + Svix verifier, `email_log`/`email_connections` schemas, `status` never written, pixel route, cron/queue routes, latest migration number, absence of a `notifications` table. Produce a short delta report. If anything drifted, update the plan before Task 1.

- [ ] **Task 1 — `email_delivery_events` table + migration.** Schema + additive migration (0055+) with FORCE RLS hand-appended; RLS integration test (cross-tenant read denied). Deliverable: table exists, RLS enforced.

- [ ] **Task 2 — `email_log` denormalized status + classified-open columns.** Additive migration; back-compat test that existing rows default correctly (`delivery_status="sent"`, counts 0).

- [ ] **Task 3 — `email_connections.expired_at`/`expired_reason` columns.** Additive migration.

- [ ] **Task 4 — Unified `recordDeliveryEvent()` writer (`email-delivery/ingest.ts`).** Idempotent insert (dedup on `provider_event_id`), denormalized status update. Unit tests: dedup, status transitions, bounce_class mapping. No notification emit yet (stubbed).

- [ ] **Task 5 — Shared Svix verifier extraction (`email-log/inbound.ts`).** Pull the `verify` into a reusable function; both branches use it. Test: valid/invalid signature.

- [ ] **Task 6 — Resend route branch by `event.type`.** `email.bounced/complained/delivered` → `recordDeliveryEvent`; inbound unchanged. Unit test each branch with a signed sample payload. **Includes doc step:** Resend dashboard — add the 3 event types to the existing endpoint (manual, noted for Mike; not code).

- [ ] **Task 7 — Nylas dispatch by `event.type`.** Add `message.bounce_detected`/`message.send_failed`/`thread.replied`/`grant.expired`; `message.created` unchanged. Unit tests per type incl. unknown-type no-op.

- [ ] **Task 8 — `grant.expired` handler writes `status="expired"` + `expired_at`/`reason`.** Integration test: handler flips status; `isSendable` now returns false → send resolves to Resend fallback.

- [ ] **Task 9 — `notifications` + `notification_preferences` tables + migrations.** FORCE RLS; RLS tests (recipient-scoped read).

- [ ] **Task 10 — `dispatch.ts` emit engine.** `emitNotification(input)`: resolve recipients, apply preference (default when no row), own-action suppression (incl. automation actor), tiering, quiet-hours `scheduled_for`, channel fan-out (in-app row always; email via system mailer when channel on + critical or non-deferred). Unit tests: own-action suppressed; bounce-on-automated still notifies; critical bypasses quiet-hours; routine defers.

- [ ] **Task 11 — Wire `recordDeliveryEvent` → `emitNotification`** for bounce/complaint/failed (critical, owner + admins) with plain-English `bounce_reason`. Integration test end-to-end from a signed webhook payload to a notification row.

- [ ] **Task 12 — Reply-received notification** from Nylas `thread.replied` + Resend inbound (routine, dedup so `message.created` + `thread.replied` don't double-fire). Test dedup.

- [ ] **Task 13 — Open classifier (`classify-open.ts`) + pixel-route wiring.** Apple egress-IP cache, UA/IP/timing rules; pixel route increments classified counter. Unit tests per rule; MPP→unknown; scanner→bot; plain→human.

- [ ] **Task 14 — Notification queries + safe-actions.** Bell list, unread count, mark-read, mark-all-read (authoritative + idempotent), archive, update-preference. Tests incl. cross-device read-state (server authoritative).

- [ ] **Task 15 — Bell + inbox UI.** App-shell bell (unread badge), inbox panel (read/unread, mark-all-read, archive, ~30-day auto-clear), deep links. Component tests.

- [ ] **Task 16 — Preference matrix UI + timezone/quiet-hours/digest settings.** Per-type × per-channel toggles (never locked), timezone capture, quiet-hours, digest frequency. Component tests: no type is non-disableable.

- [ ] **Task 17 — Quiet-hours/digest flush cron (`app/api/jobs/cron/notifications-flush`).** Scans due `scheduled_for` + builds digests per `digest_frequency`; `CRON_SECRET`-guarded like existing cron routes. Integration test: deferred routine delivered after window; critical never deferred.

- [ ] **Task 18 — Delivery-status badge + "Opens" control in the email thread/activity UI.** Renders status, bounce reason, the collapsed `ⓘ Opens: N ›` → split, and the honest ⓘ popout copy. Component tests.

- [ ] **Task 19 — Reconnect banner in integrations area.** Persistent, plain-English, `[Reconnect]` runs existing Nylas connect flow; shows when any of the user's connections is `expired`. Component test.

- [ ] **Task 20 — Docs + decisions-inventory update.** Record in `docs/decisions-since-may-docs.md`: delivery-event model, notification module, open-classification honesty stance, Resend endpoint event-types added, notification settings stored as a `user_preferences` KV row (Option A). (Doc only.)

---

## New Pieces — flagged

**New tables (3):** `email_delivery_events`, `notifications`, `notification_preferences` (+ additive columns on `email_log` and `email_connections`). **`user_preferences` is unchanged** — notification settings ride an existing KV row.
**New module dirs (2):** `src/modules/notifications/`, `src/modules/email-delivery/`.
**New route (1):** `app/api/jobs/cron/notifications-flush/route.ts` (reuses `CRON_SECRET`; add to `vercel.json` cron schedule).
**New env vars / secrets:** **NONE.** Resend reuses `RESEND_WEBHOOK_SECRET`; Nylas uses the already-provisioned `NYLAS_WEBHOOK_SECRET`; notification email uses the existing system mailer.
**New runtime dependencies:** **NONE.** (Apple egress-IP list is a fetched/cached CSV, not an npm package; Svix verification already ships via the Resend SDK.)
**New manual/dashboard step (not code):** add `email.bounced`/`email.complained`/`email.delivered` to the existing Resend webhook endpoint.
**New data (approved 2026-07-04, Option A):** per-user notification settings (`timezone` + quiet-hours + digest) stored as a single KV row in the **existing** `user_preferences` table — no new columns, no migration to it. Quiet-hours AND digests both in scope.
**Explicitly OUT of scope (deferred):** admin-set **org-default** notification preferences (Monday-style). Per-user × per-type × per-channel preferences remain in scope; org-defaults are a documented future add-on.

---

## Self-Review — spec coverage

- Sequencing all-at-once + reusable module → module map, Task 9–17, `source_module` column. ✅
- Unified delivery model both paths → `email_delivery_events` + `recordDeliveryEvent` (Tasks 1,4,6,7,11). ✅
- Nylas bounce/fail/replied/expired + `status="expired"` → Tasks 7,8,12. ✅
- Bounce from provider event, not reply-parsing → `recordDeliveryEvent` fed only by webhook events; ⚠️ noted in Global Constraints. ✅
- Resend reuse endpoint + secret, branch by type → Task 6 + Global Constraints. ✅
- Notification center greenfield, per-user×type×channel, notify vs log-only, own-action (+automation), no locked types, critical/routine tiers, cross-device read-state → Tasks 9,10,14,15,16 + matrix. ✅
- Automated email first-class, only self-notify suppressed, bounces still notify → dispatch rule (Task 10) + matrix notes. ✅
- Open UI collapsed→split + honest ⓘ + classification method + never a notification → Tasks 13,18. ✅
- Quiet-hours/DND + digests, lift-checked + flagged → assessment section + Task 17 + flagged tz columns. ✅
- Reconnect UX plain-English + banner → Task 19. ✅
- RLS FORCE + additive migrations → every table task. ✅
- Build begins with read-only audit → Task 0. ✅

---

## Settled Decisions (finalized 2026-07-04)

All four open decisions are resolved; the plan above reflects them. No decisions remain open — this plan is ready pending Mike's go to build.

1. **Per-user timezone / quiet-hours / digest** — ✅ APPROVED (**Option A**, refined after Task 0 audit). Stored as a single KV row (`key="notifications.settings"`) in the existing `user_preferences` table — which is **user-scoped** (not org-scoped), the correct fit for per-user settings. No new columns and no migration to `user_preferences`.
2. **Digests** — ✅ IN SCOPE. Quiet-hours **and** daily/weekly digests both built this round; they share the `notifications-flush` cron.
3. **Open-tracking labels** — ✅ SETTLED. Row reads `Likely Human · N | Automated Open · N | Unknown · N`. Middle label is exactly **"Automated Open"** (never "Bot"). ⓘ popout explains automated opens = bots + scanners, opens are an estimate, Apple Mail Privacy pushes many real opens into "Unknown" (often the largest bucket) → directional only, lean on clicks/replies. Raw count + classification stored internally regardless of display. Opens are never a notification.
4. **Admin org-default preferences** — ⏸️ DEFERRED (documented future add-on). Per-user × per-type × per-channel preferences remain in scope; default-resolution is designed so an org-default tier can slot in later without a rewrite.

**Status:** Plan finalized. Do NOT begin building — stays a plan pending Mike's explicit go. When approved, execution starts with the Task 0 read-only audit.
