# PHOTOGRAPHY CRM/PM PLATFORM

## V1 Technical Build Spec

**Version:** V1
**Companion to:** V1 Requirements Specification
**Audience:** the developer building this (your friend + any additional devs)
**Purpose:** module-by-module build breakdown with implementation decisions, integration specs, database schema highlights, API surface, and honest cost estimates at the framework's $1-2K/module pricing.

---

## 1. TECH STACK — VERIFIED FROM REPO AUDIT

This is no longer an assumptions list. The foundation ("Pathway Foundation" starter, repo `Micshea88/PhotoCRM`) was audited read-only on 2026-05-18. These are facts, not guesses.

**Stack (confirmed):**

- **Next.js 16** (App Router; root middleware is `proxy.ts`, the Next 16 idiom — not `middleware.ts`), **React 19**, **TypeScript 6** strict
- **Better Auth 1.6.9** with the organization plugin — owns auth + multi-tenant org tables
- **Drizzle ORM 0.45** + drizzle-kit; migrations in `src/db/migrations`
- **Postgres** — vanilla Postgres 16 local (docker-compose), **Neon Postgres on Vercel** in production. NOT Supabase. No Supabase client, no Supabase Auth, no Supabase Storage anywhere.
- **Vercel** hosting — `@vercel/blob` (private file storage), Vercel Cron (job scheduling), region `iad1`
- **Resend** transactional email + React Email templates
- **Sentry** + pino observability; Vitest + Playwright + lefthook + tiered CI

**The foundation already provides (genuinely built — do not re-build):**

- Multi-tenant org structure: sign-up, email verification, password reset, org creation, invitations, membership (Better Auth organization plugin)
- The module pattern: `src/modules/items/` is the canonical clone-this template (schema → types → queries → actions → ui). Every product feature is built by copying it. `/new-module` scaffolder + add-module skill exist.
- `orgAction` server-action middleware: every mutation resolves `ctx.activeOrg.id` and `ctx.activeOrg.role`, enforces org membership
- Append-only `audit_log`, mandatory on every state-changing action (IP/UA auto-captured)
- Soft-delete (`deletedAt`/`deletedBy`) on every app table + daily 04:00 UTC purge cron (only hard-delete path)
- Private file storage: Vercel Blob, org-scoped, signed-token client-upload + download proxy (`src/modules/files/`)
- Job scheduling: Vercel Cron + `verifyCronAuth`/`verifyQueueAuth` shared-secret middleware (`src/modules/jobs/`) — **this is the scheduling substrate for the recompute engine; the cron plumbing exists, the recompute logic does not**
- Transactional email via Resend, wired to auth flows

**The foundation does NOT provide (confirmed absent — net-new build, this document):**

- **Row-Level Security: ZERO policies exist.** Postgres supports it; nothing implements it. All tenancy isolation is currently application-layer (`orgAction`), not database-enforced. Writing RLS policies table-by-table is our job.
- **Real role-based access control.** Only `owner|admin|member` strings exist and **no shipped code checks them**. The 8-role model, per-user permission overrides, and field-level financial restrictions are entirely net-new (module 4.23).
- Stripe / payments — explicitly out of scope in the foundation, zero scaffolding
- E-signature — nothing (native build, module 4.6, fully net-new)
- Email/calendar OAuth (Gmail/Microsoft Graph/IMAP), SMS (Twilio), Instagram/Meta, AI SDKs (Anthropic/OpenAI) — none wired
- Custom-fields engine, command palette, kanban/table UI components, GDPR/CCPA export UI — none present
- Admin panel / settings UI — explicitly listed as deliberately excluded by the foundation

**What this changes vs. the prior assumptions:** the foundation removes real plumbing work (multi-tenancy, audit, soft-delete, file storage, job scheduling — weeks of unglamorous infra). It does NOT reduce the product build: every CRM/PM module is a net-new `items`-pattern clone. The permissions layer and the AI command palette, previously assumed "framework-provided," are confirmed net-new and are costed as such below. Module costs in this document already reflect the verified state.

---

## 2. DATA MODEL

### Core Tables

**workspaces**

- id, name, slug, plan_tier, owner_user_id, branding_config (jsonb), settings (jsonb), stripe_connect_account_id, created_at, updated_at, deleted_at

**users**

- id, email, encrypted_password, full_name, phone, avatar_url, timezone, created_at, updated_at, last_login_at

**workspace_memberships**

- id, workspace_id, user_id, role, permission_overrides (jsonb), invited_at, accepted_at, created_at, updated_at

**contacts**

- id, workspace_id, contact_type, lifecycle_status, first_name, last_name, company_id (nullable FK → companies), primary_email, secondary_email, primary_phone, secondary_phone, mailing_address (jsonb), date_of_birth, anniversary_date, instagram_handle, instagram_user_id, facebook_url, website, lead_source, source_detail, referred_by_contact_id, tags (array), owner_user_id, custom_fields (jsonb), notes (text), internal_notes (text), created_at, updated_at, last_contact_at, deleted_at
- Display rule (application layer): contact label is rendered "Last, First — Company" in all lists/pickers/search/association fields; fall back to "Name — primary_email" when company_id is null. Enforce centrally (one display helper), not per-screen.

**companies** (lightweight reference — deliberately NOT a full CRM company object in V1)

- id, workspace_id, name, website, main_phone, instagram_handle, category, created_at, updated_at
- Picked via typeahead with inline create. No pipelines, no activity timeline, no company record page in V1 (explicit V2+ scope). Indexed (workspace_id, name) for typeahead; contacts.company_id indexed for "all contacts at company X" and Vendor Matrix grouping/rollups. `website` and `main_phone` live here (company-level, shared across all contacts at the company) — they are NOT duplicated onto contacts. The contact's own primary_phone/secondary_phone remain the person's direct/cell numbers. Both website and main_phone are searchable/filterable in the saved-view engine; website is frequently the cleanest disambiguator between same-named vendors.

**contact_couples**

- id, workspace_id, primary_contact_id, partner_contact_id, relationship_type, created_at

> **Object naming (locked architecture decision).** The core engagement object is named **`projects`** in the schema, API, and code — never `shoots`. The photographer-facing display label is **"Event"**, resolved via the `terminology_map` table below. Do not hard-code "Shoot" or "Event" in table, column, route, or model names. This costs nothing now and is a multi-day refactor if deferred.

**projects** (displayed to photographers as "Event")

- id, workspace_id, name, project_type, lifecycle_status, primary_date, start_datetime, end_datetime, hours_of_coverage, photographer_count, primary_venue_name, primary_venue_address (jsonb), primary_venue_coordinates (point), ceremony_venue (jsonb), reception_venue (jsonb), venue_notes, package_name, package_base_price, line_items (jsonb), subtotal (computed Σ line_items), discount_type (none/percent/flat), discount_value, tax_rate, tax_sign (add/subtract), tax_amount (computed), total_value (computed per fixed order of operations), anniversary_date (auto-calculated), project_notes, internal_notes, custom_fields (jsonb), sun_data (jsonb — cached sunrise/sunset/golden hour), template_id (nullable — source template for task-plan instantiation), created_at, updated_at, deleted_at

**project_contacts**

- id, project_id, contact_id, role (primary, partner, billing, vendor)
- Allows multiple contacts per project in different roles

**project_photographers**

- id, project_id, user_id, role (lead, second, backup), confirmation_status

**project_sub_events** (multi-event coverage: engagement, rehearsal, wedding day, brunch, etc.)

- id, project_id, event_type, included, event_date, venue, photographer_user_id, gallery_delivered_at

**terminology_map** (display-name layer — Section 4.7 of requirements)

- id, workspace_id, object_key (project, contact, opportunity, task, ...), display_label_singular, display_label_plural
- V1 ships one row set: the photographer pack (project → "Event"). UI label resolver reads this; never hard-codes object display strings.

**tasks** (project-management core — Section 4.8 of requirements)

- id, workspace_id, project_id, stage_id (nullable), title, description, assignee_user_id (nullable), assignee_role (nullable — resolved to user at instantiation), due_date, status (not_started/blocked/ready/in_progress/done), priority, order, created_from_template_item_id (nullable), due_date_overridden (bool — protects manual edits from recompute), created_at, updated_at, completed_at

**task_dependencies**

- id, task_id, blocked_by_task_id
- Task shows Blocked while any blocker incomplete; flips to Ready when all clear. No critical-path computation.

**task_checklist_items**

- id, task_id, label, done (bool), assignee_user_id (nullable), order

**project_stages** (per-project, user-editable; seeded from template, divergeable)

- id, project_id, name, order, color

**project_templates** (extends existing template concept with a task plan)

- id, workspace_id, name, project_type, package_defaults (jsonb), payment_schedule_defaults (jsonb), default_workflow_ids (array), questionnaire_id, contract_template_id, created_at, updated_at

**project_template_task_items** (the task-plan blueprint)

- id, project_template_id, stage_name, title, description, relative_offset_days (negative = before event date, positive = after), assignee_role, blocked_by_template_item_id (nullable), checklist_items (jsonb), order

**opportunities**

- id, workspace_id, project_id, contact_id, pipeline_id, stage_id, value, probability, status, owner_user_id, expected_close_date, stage_changed_at, created_at, updated_at, lost_reason

**pipelines**

- id, workspace_id, name, type, order, config (jsonb)

**pipeline_stages**

- id, pipeline_id, name, order, probability, color, config (jsonb — automation rules, stale-card threshold, WIP limit)

**custom_field_definitions**

- id, workspace_id, record_type, name, field_type, options (jsonb), folder, order, required, formula

**workflows**

- id, workspace_id, name, description, status (draft/active/paused), trigger_config (jsonb), nodes (jsonb), version, created_at, updated_at

**workflow_executions**

- id, workflow_id, trigger_record_id, status, started_at, completed_at, current_node_id, execution_log (jsonb), failed_step_id, retry_count

**workflow_step_executions**

- id, workflow_execution_id, step_id, step_type, status, started_at, completed_at, input_data (jsonb), output_data (jsonb), error_detail

**templates**

- id, workspace_id, name, template_type (contract, proposal, smart_doc, invoice, questionnaire, email, sms, workflow), content (jsonb — rich text or workflow structure), merge_fields (array), project_type_variant, version, active, created_at, updated_at

**smart_documents**

- id, workspace_id, project_id, primary_contact_id, name, template_id, status, package_options (jsonb), addons (jsonb), selected_package, selected_addons, contract_content, payment_schedule (jsonb), signature_data (jsonb), sent_at, viewed_at, signed_at, paid_at, expires_at, pdf_url

**invoices**

- id, workspace_id, project_id, billing_contact_id, smart_document_id, invoice_number, line_items (jsonb), subtotal, discount_type, discount_value, tax_rate, tax_sign, tax_amount, total, status, due_date, sent_at, viewed_at, paid_at, payment_intent_id, payment_method, stripe_invoice_id

**payment_installments** (the payment schedule — one row per installment)

- id, workspace_id, project_id, sequence_no, split_method (pay_in_full/even_by_count/percentage/fraction/manual), split_param (jsonb — e.g. {count:3} or {pct:50} or {fraction:"1/3"}), amount_cents (integer cents, never float), amount_overridden (bool — protects from recompute, same pattern as task due_date_overridden), due_date, due_date_rule (jsonb — e.g. "14 days before event date"), due_date_overridden (bool), billing_contact_id, status (scheduled/sent/paid/overdue/refunded), invoice_id (nullable, set when invoice generated)
- Constraint enforced in application logic: Σ amount_cents across a project's installments == project.total_value to the cent; mismatch surfaces a visible warning, never silently persists

**payments**

- id, workspace_id, invoice_id, payment_installment_id, amount, status, stripe_payment_intent_id, paid_at, refunded_amount, refund_log (jsonb)

**communications**

- id, workspace_id, contact_id, channel (email, sms, ig_dm, fb_messenger, call), direction (in/out), thread_id, subject, body, attachments (jsonb), from_address, to_address, status, sent_at, delivered_at, opened_at, clicked_at, replied_at, ai_intent_classification, ai_suggested_reply, created_at

**calendar_events**

- id, workspace_id, type, related_project_id, related_contact_id, owner_user_id, attendees (array), title, description, location, start_at, end_at, all_day, recurring_rule, video_link, external_event_id, sync_source, created_at, updated_at

**schedulers**

- id, workspace_id, name, scheduler_type, slug, duration_minutes, buffer_minutes, advance_notice_hours, max_per_day, available_windows (jsonb), location_type, owner_user_id

**bookings**

- id, scheduler_id, contact_id, calendar_event_id, status, created_at

**post_production_status**

- (Stored on projects table as fields, surfaced in editing board view; separate table not needed)

**time_entries**

- id, workspace_id, user_id, project_id, category, description, start_at, end_at, duration_minutes, billable, rate_at_entry, created_at

**project_files** (per-Event file space — Section 6.32)

- id, workspace_id, project_id, file_name, storage_key, mime_type, size_bytes, folder, client_visible (bool), uploaded_by_user_id, created_at

**notifications** (Section 6.33)

- id, workspace_id, user_id, event_type, channel (in_app, email; push reserved for V2), payload (jsonb), read_at, delivered_at, created_at

**notification_preferences**

- id, workspace_id, user_id, event_type, channel, enabled (bool)

**integrations**

- id, workspace_id, integration_type (stripe, gmail, twilio, instagram, facebook, google_calendar, outlook, zoom, etc.), credentials (encrypted jsonb), status, last_health_check_at, error_count, created_at

**activity_log**

- id, workspace_id, user_id, action, record_type, record_id, before_state (jsonb), after_state (jsonb), ip_address, user_agent, created_at

**audit_log**

- id, workspace_id, user_id, action, resource, ip_address, metadata (jsonb), created_at

### Row-Level Security (NET-NEW — must be written, table by table)

The audit confirmed **zero RLS policies exist** in the foundation. This is not framework-provided; it is our build and it is load-bearing for the "Photographer cannot see financials" promise.

Implementation approach (every workspace/org-scoped table):

1. `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;` plus `FORCE ROW LEVEL SECURITY` so even the table owner is subject to policy.
2. A session/connection setting carries the requesting user's `organization_id` and role (set per-request from the Better Auth session in the DB connection context — Drizzle supports running a `SET LOCAL` in the same transaction).
3. Org-isolation policy on every table: rows visible only where `organization_id = current_setting('app.current_org')`.
4. Role-scoped policies layered on financial tables (invoices, payments, payment_installments, the profit fields): additionally require the role to be one permitted to read money.
5. Assignment-scoped policies for photographer/contractor/editor roles: rows visible only for events they're assigned to.
6. Field-level (e.g. Event visible but its `profit` hidden): enforced via column-level grants + the application read layer composing role-aware projections — RLS is row-grain, so field-grain is a combination, documented per table.

This is module 4.23's core and is the single highest-risk security item: a missing policy is a silent cross-tenant or cross-role data leak, not a visible bug. Every app table's migration MUST include its RLS policy in the same migration that creates the table — never a follow-up — and the integration test suite MUST include a negative test per table (a wrong-org / wrong-role query returns zero rows from the database, verified with the application layer bypassed).

### Indexes

- All foreign keys indexed
- (workspace_id, status) on most operational tables
- (workspace_id, primary_date) on projects for calendar/dashboard queries
- (workspace_id, project_id, due_date, status) on tasks for task lists and Team This Week
- (workspace_id, user_id, read_at) on notifications for the notification center
- (workspace_id, contact_id, channel, created_at) on communications for inbox views
- GIN indexes on custom_fields jsonb columns for filtering

---

## 3. API SURFACE

REST API with standard verbs. Auth via Bearer token (workspace-scoped JWT).

**Base path:** `/api/v1`

Modules expose typical CRUD plus module-specific endpoints. Examples (not exhaustive):

**Contacts:** GET/POST `/contacts`, GET/PATCH/DELETE `/contacts/:id`, POST `/contacts/bulk`, GET `/contacts/:id/timeline`, POST `/contacts/:id/merge`

**Projects** (UI label "Events"): GET/POST `/projects`, GET/PATCH/DELETE `/projects/:id`, POST `/projects/:id/clone`, POST `/projects/:id/instantiate-task-plan`, GET `/projects/:id/brief`, POST `/projects/:id/calculate-sun`, GET/POST `/projects/:id/tasks`, PATCH `/tasks/:id`, GET/POST `/projects/:id/files`

**Tasks:** GET `/tasks?assignee=me`, GET `/tasks/team-week` (Team This Week view), PATCH `/tasks/:id/complete` (triggers dependency unblocking)

**Opportunities:** GET/POST `/opportunities`, POST `/opportunities/:id/move-stage`, GET `/pipelines/:id/board`

**Workflows:** GET/POST `/workflows`, POST `/workflows/:id/activate`, POST `/workflows/:id/test`, GET `/workflows/:id/executions`

**Smart Documents:** POST `/smart-documents`, GET `/smart-documents/:id`, POST `/smart-documents/:id/send`, POST `/public/smart-documents/:token/select`, POST `/public/smart-documents/:token/sign`, POST `/public/smart-documents/:token/pay`

**Invoices:** POST `/invoices`, GET `/invoices/:id`, POST `/invoices/:id/send`, POST `/invoices/:id/refund`, POST `/public/invoices/:token/pay`

**Communications:** GET `/communications/inbox`, POST `/communications/send` (channel-aware), POST `/webhooks/email`, POST `/webhooks/sms`, POST `/webhooks/instagram`

**Reports:** GET `/reports/prebuilt/:slug`, POST `/reports/custom`, POST `/reports/ai-generate`

**Templates:** GET/POST `/templates`, GET/PATCH/DELETE `/templates/:id`

**Integrations:** GET `/integrations`, POST `/integrations/:type/connect`, DELETE `/integrations/:id`, GET `/integrations/health`

**Public:** unauthenticated endpoints for client-facing flows (Smart Doc, invoice payment, scheduler booking). Token-based access, no login.

Webhooks (outbound) configurable per workspace for workflow integration.

---

## 4. MODULE-BY-MODULE BUILD BREAKDOWN

Each module below includes scope, key implementation notes, integration dependencies, and estimated cost at $1-2K/module pricing. Costs are rough — confirm with developer.

### 4.1 Contact Management — $1.5K

Core CRUD with three-record model setup. Custom fields engine (if not in framework, adds $1K). Activity timeline materialized from events. Includes the `companies` lightweight-reference table + typeahead-with-inline-create picker on the contact form, and the central "Name — Company" display helper used by every list/picker/search. Scope is small (one thin table, one picker, one display helper) and is absorbed in this estimate — but only if held to the lightweight definition; a full company object with its own record page/timeline/pipelines is V2+ and would not fit this number.

Key implementation: contact_couples table for partner linkages; flexible contact-project roles for billing contact handling.

### 4.2 Event (Project) Management — $2K

Larger module due to many fields and folders. Project template cloning. Multi-event coverage as sub-records. Field group organization (folders) with hide-empty toggle.

### 4.3 Pipeline + Kanban — $1.5K

Drag-and-drop kanban UI. Stage configuration. Auto-create opportunities on stage triggers (cross-pipeline). Stale-card detection runs as scheduled job.

### 4.4 Workflow Automation Engine — $2K

Node-based workflow representation in jsonb. Trigger system (event listeners on records). Execution engine runs as background workers. Step types: action, condition, wait, branch. Test mode runs without side effects. Execution log table.

This is the highest-risk module to get right. Reliability monitoring (Section 6.18 of requirements) is critical here.

### 4.5 Smart Documents — $2K

State machine: Draft → Sent → Viewed → In Progress → Signed → Paid → Expired. Client-facing flow with live-updating pricing/contract/schedule. Single signature pad. Payment integration with Stripe. PDF generation on completion.

### 4.6 E-Signature — $3-4K (native, locked decision)

**Decision locked:** native e-signature in V1 (not DocuSeal/integrated). The owner accepted the deferral case and chose native anyway; this is final, not revisited here.

Native implementation: typed + drawn signature capture; multi-party (couple + studio), sequential or parallel; document binding (the exact rendered document is locked and hashed at signing — what was signed is provably what is stored, byte-for-byte); tamper-evident audit trail (signer identity, email verification, IP, timestamp, document hash, explicit consent capture) retained for the life of the account and producible years later; immutable signed-PDF generation stored with the same backup/retention as account data; ESIGN/UETA posture owned by the platform. Wired into Smart Documents and standalone contracts (model/contractor/vendor releases).

This is ~3–4 weeks and sits on the critical path. It is the second legally-load-bearing component in V1 (with module 4.30) where "refine post-launch" does not apply — a flawed audit trail is an unenforceable contract, not a bug. **Separate required line item, not in this build estimate: a one-time legal review of contract templates + the e-sign flow before launch.** Budget it distinctly; skipping it is the single highest-risk shortcut on the project.

### 4.7 Invoicing + Stripe Connect + Payment Schedules — $2K

Stripe Connect for per-workspace payments. Smart payment scheduling with formula-based amounts and dates. Auto-invoice generation. Refunds. Webhook handling for payment events. Unique-link payment portal (no login).

**Payment-schedule calculation — implement exactly:**

- Fixed order of operations: `subtotal = Σ line_items` → `discounted = subtotal − (discount_pct ? subtotal*pct : discount_flat)` → `total = discounted ± tax_rate*discounted` → split runs on `total`. Do not vary this order; tax-before-discount changes the result.
- Split methods: `pay_in_full`, `even_by_count` (rounding remainder absorbed on the LAST installment so Σ installments == total to the cent), `percentage` (validate Σ pct == 100), `fraction` (exact rational arithmetic for thirds/quarters to avoid 33.33% drift), `manual` (validate Σ installments == total; surface a visible mismatch warning, never silently accept).
- Use integer-cents arithmetic internally (no float accumulation) to guarantee installments reconcile exactly.
- Recompute trigger: on change to base price, add-on, discount, tax rate, or Event date, recompute every installment where `amount_overridden = false`; protect `amount_overridden = true` installments. This is the **same override-protection mechanism** as the templated-task-plan instantiation engine (module 4.30) — share that code path, do not build a second one.

Stripe Connect onboarding (KYC, identity verification) handled by Stripe's hosted flow.

### 4.8 Email Communication Hub — $1.5K

IMAP/SMTP for inbox sync (or Gmail/Microsoft API for OAuth-based sync). Email threading preserved via in-reply-to and references headers. Open and click tracking via pixel and link rewriting. Templates with merge field engine.

Sending: Resend or Postmark for transactional; Gmail/Microsoft for user-account sending.

### 4.9 SMS Communication Hub — $1.5K

Twilio integration. Multiple phone numbers per workspace. Per-user permission enforcement. Templates. Inbound webhook for two-way.

### 4.10 Instagram DM Integration — $2K

Meta Graph API for Instagram Business Account. OAuth onboarding. Webhook for inbound messages. AI intent classification on each message. AI reply drafting.

Meta app review required — submit during build, allow 2-6 weeks for approval.

Token refresh (60-day Instagram tokens) handled by background job. Failed-auth alerts.

### 4.11 Facebook Messenger Integration — $1K

Same model as Instagram but for Facebook Messenger. Shared infrastructure with Instagram cuts cost roughly in half.

### 4.12 Native Inbound Email Parser — $1.5K

Cloudmailin or AWS SES inbound email routing. Unique inbox address per workspace. AI parsing of marketplace email formats. Contact + Opportunity creation. Pre-trained parsers for top 10 marketplaces with AI fallback.

### 4.13 Unified Inbox — $1K

Aggregated view across communication channels. Existing communications table powers this; UI layer for filtering, replying, marking read.

### 4.14 Calendar + Scheduling — $2K

Calendar event storage. Two-way sync with Google Calendar and Outlook (webhook + periodic sync). Public scheduling pages with available-window logic. Auto Zoom/Meet/Teams link generation. Conflict detection.

### 4.15 Reporting + Custom Report Builder — $2K

Pre-built reports: SQL queries with parameterized filters, rendered to visualizations. Custom report builder: schema-aware query builder UI generating SQL. AI report generation: natural language → SQL → render. 12 visualization types via recharts or similar.

This module is the headline differentiator — invest in making it actually good.

### 4.16 Template Library — $1.5K

Rich-text editor (TipTap or similar) with merge-field plugin. Template storage with versioning. Per-event-type variants. Template picker UI on send actions.

### 4.17 Vendor Matrix — $0.5K

Saved view of contacts with type=vendor plus vendor-specific custom fields. Mostly configuration of the existing Contact module. Low custom build cost.

### 4.18 One-Pager Photographer Briefs — $1K

Brief template stored as configurable per workspace. PDF generation from project (Event) data using template. Auto-generation scheduled via workflow (1 week before, 24 hours before). Mobile-friendly web version. Auto-email distribution.

### 4.19 Editing Boards — $1K

Custom column view of projects filtered to active post-production. Inline editing of post-production fields. Customizable column visibility per user. Editor-role view restriction.

Mostly UI work since data lives on the existing project record.

### 4.20 Sun + Golden Hour Calculations — $0.5K

SunCalc.js or similar library. Geocoding via Google Maps or Mapbox API. Cache calculated values on the project record. Recalculation triggered on date or venue change.

Low cost — well-trodden math.

### 4.21 Time Tracking — $1K

Timer UI (start/stop, running indicator). Manual entry form. Time category configuration. Per-user rate configuration. Project profitability calculation feeds reports.

### 4.23 Multi-User RBAC + Row-Level Security — $3-4K (confirmed net-new)

The audit confirmed the foundation ships only `owner|admin|member` strings with no enforcement and zero RLS policies. This is the data-layer security build and it is entirely ours. Scope: expand the role model to the 8 V1 roles; per-user permission-override layer (jsonb on membership); **Postgres RLS policies written table-by-table per the approach in the Data Model section** (org-isolation on every table, role-scoped policies on financial tables, assignment-scoped policies for photographer/contractor/editor); field-level financial restriction via column grants + role-aware read projections; invite-by-email flow (extends the Better Auth org-invitation already present). ~3–4 weeks. Highest-risk security item in V1: a single missing policy is a silent cross-tenant or cross-role leak. Negative tests per table are mandatory (wrong-org/wrong-role query returns zero rows with the app layer bypassed). Was previously costed at $1.5K assuming framework support — that assumption is now disproven; this is the corrected number.

### 4.34 Settings & Administration — $2K (net-new, added)

The foundation explicitly excludes an admin/settings UI. This is a real module added after the spec review identified it as a genuine V1 gap. Two halves:

- _Account/Admin (admin-only):_ business profile + branding (logo/colors applied to Smart Docs/invoices/client pages), tax rate + not-liable disclaimer, Stripe Connect status/management, team & user management (invite/deactivate/reassign), role assignment + per-user permission overrides UI, billing & subscription self-service (plan/payment method/cancel), full-account data export (GDPR/CCPA button), audit-log viewer (the audit_log already exists — this gives it a screen), default templates & pipeline config, integration health.
- _User level:_ personal profile, own email/calendar OAuth linking, own SMS permissions, notification preferences matrix, personal signature, password/2FA, active sessions + log-out-all-devices.

### 4.23-LEGACY Mobile-Responsive Web — N/A

Responsive design is a discipline applied across all modules, not a standalone build. Budgeted as part of UI work on every module.

### 4.24 AI Command Palette — $2K (net-new, confirmed)

The audit confirmed this is NOT in the foundation (previously assumed framework-provided). Net-new build: ⌘K global palette, entity search across contacts/events/opportunities/tasks, natural-language command routing, AI help line via Anthropic SDK (also not wired — added here). Costed accordingly; this is a real module, not a freebie.

### 4.25 AI Features (Lean Set) — $1.5K

Claude API integration for: email drafting, SMS drafting, IG DM reply suggestions, marketplace email parsing, report generation from natural language, workflow drafting, migration interpretation. Each feature is a focused prompt + UI surface; aggregated into one module.

### 4.26 Onboarding Flow — $1K

5-question wizard. Logic to auto-install pipelines/workflows/templates based on answers. Integration connection flow. Sample data seeding option.

### 4.27 CSV Migration Import + AI Interpretation — $1.5K

CSV upload, field mapping wizard, AI suggestion of mappings, deduplication logic, import report, conversational AI setup interface.

### 4.28 System Reliability + Automation Monitoring — $1.5K

Real-time health dashboard aggregating data from workflow_executions, integrations health, communication delivery. Anomaly detection job (compares rates to historical baseline). Daily AI health report email (scheduled job, AI summarizes data). Manual retry endpoints.

### 4.29 Task Engine + Dependencies + Checklists — $2K

Tasks table with status state machine. `task_dependencies` join table; completing a task runs an unblock pass over dependents (status blocked→ready, optional notification, optional due-date shift). `task_checklist_items` child table with inline-edit UI. Per-project stage table seeded from template but independently editable. This is foundational PM infrastructure the rest of the PM features build on. Explicitly excludes critical-path/Gantt/resource-leveling computation.

### 4.30 Templated Task Plans + Instantiation Engine — $3-4K

The single biggest PM build. `project_template_task_items` blueprint storage (cheap). The instantiation engine: on project creation with event date + role assignments, generate concrete tasks with absolute due dates from relative offsets, resolve assignee roles to users, populate checklists. Recompute-on-event-date-change with `due_date_overridden` protection so manual edits survive. This recompute-with-override logic is the genuinely fiddly part and the main cost driver — it parallels the payment-schedule recompute pattern, so reuse that code if the framework already has it (lowers this estimate toward $3K; without it, $4K+). Honest: this is the module most likely to overrun. Confirm with developer specifically.

### 4.31 Team This Week (Workload View) — $1K

A saved-view configuration (tasks grouped by assignee × day) plus a week-grid render that reuses the Calendar module's grid component. No scheduling algorithm. Low cost because data, grouping, and the grid render already exist from the saved-view, task, and calendar modules — this is assembly, not new infrastructure.

### 4.32 File Management (Per-Event File Space) — $1.5K

`project_files` table + Vercel Blob storage (confirmed in foundation: org-scoped, private, signed-token client-upload + download proxy — `src/modules/files/` is the working pattern to clone). Upload/folder/rename UI on the project record. `client_visible` flag rides the existing signed-token no-login link infrastructure built for Smart Documents — no new sharing system. Excludes versioning, per-file ACLs, annotation.

### 4.33 Notification System — $2K

`notifications` + `notification_preferences` tables. Events catalog wired to existing triggers (contract signed, payment received, task assigned/due/unblocked, lead captured, IG DM intent, workflow failed, etc.). Two delivery channels in V1: in-app notification center + email. Channel-agnostic dispatcher so V2 push is a new channel adapter, not a core rewrite. Preference matrix UI with shipped defaults.

---

## 5. INTEGRATION ADAPTER SPECS

### 5.1 Stripe Connect

- Onboard workspace via Stripe Express or Standard Connect
- Store stripe_connect_account_id on workspace
- All payments flow direct: PaymentIntent with `stripe_account` header set to connected account
- Webhooks for payment events: payment_intent.succeeded, payment_intent.payment_failed, charge.refunded, account.updated
- Stripe Tax for tax calculation (optional, additional fee per transaction)
- Test mode/live mode toggle in workspace settings

### 5.2 Email (Send + Receive)

Send:

- Transactional (system notifications): Resend or Postmark with verified domain
- User-account sending: OAuth-connected Gmail or Microsoft 365 sends via the user's own account, preserving deliverability and threading

Receive:

- Marketplace lead parsing: Cloudmailin or AWS SES inbound with unique addresses per workspace
- Personal inbox sync: IMAP for IMAP-supporting providers; Gmail API and Microsoft Graph API for OAuth providers

### 5.3 Twilio (SMS + Voice)

- Twilio Messaging Service per workspace
- Multiple phone numbers managed via Twilio Phone Numbers API
- Inbound webhook for two-way SMS
- Delivery status webhooks
- MMS support
- Twilio Voice for click-to-call (future)

### 5.4 Meta (Instagram + Facebook Messenger)

- Meta App with Instagram Messaging permission, Messenger Platform permission
- App review required for permissions
- OAuth flow connects workspace to Instagram Business Account and Facebook Page
- Webhook subscription for `messages` event
- Send API for outbound DMs
- 60-day Instagram token refresh handled by background job

### 5.5 Google Calendar + Outlook

- OAuth-based two-way sync
- Watch channel for push notifications from Google
- Microsoft Graph subscriptions for Outlook
- Conflict resolution: last-write-wins with audit trail
- Periodic full sync to catch missed webhooks

### 5.6 Zoom / Google Meet / Microsoft Teams

- Zoom: server-to-server OAuth, create meeting on scheduler booking
- Google Meet: Calendar API includes meeting link by default for Workspace users
- Microsoft Teams: Graph API onlineMeeting endpoint

### 5.7 Maps and Geocoding

- Google Maps API or Mapbox
- Geocode venue addresses at first save; cache coordinates on the project (Event) record
- Drive-time calculation between venues (Phase 1 timeline builder is V2, but data available for future)
- Static map images for photographer brief

---

## 6. WORKFLOW ENGINE IMPLEMENTATION

Workflow execution engine runs as background workers (Inngest, Sidekiq, or similar).

**Trigger handling:**

- Event subscribers on record changes (contact created, project updated, payment received, etc.)
- Date-based scheduler runs hourly to evaluate date triggers
- External webhook receivers (Meta, Stripe, etc.) translate events to internal triggers

**Execution model:**

- Each trigger fires creates a workflow_executions row
- Worker picks up execution, walks the node tree
- Each step creates workflow_step_executions row with status
- On step failure, logs error and either retries (up to N times) or marks execution failed
- Failure alerts go to workspace admin
- Conditional branching evaluates and follows correct path
- Wait/delay steps schedule re-entry at specified time

**Test mode:**

- Same execution path but side-effects (send email, create record) are mocked
- Returns simulated results for review
- Used by workflow builder's test feature

**Reliability:**

- Idempotency keys prevent double-execution
- Dead-letter queue for unprocessable executions
- Manual retry endpoint
- Execution log retained 90 days minimum

---

## 7. AI INTEGRATION

Claude API (or your friend's existing AI infrastructure) integrated for:

**Email/SMS/DM drafting:**

- Prompt includes: contact context, project (Event) context, conversation history, photographer's tone preferences, current message thread
- Output: draft message
- Surface: chat-style composer with "Draft with AI" button, accept/edit/reject flow

**Inbound DM intent classification:**

- Prompt classifies into: booking_intent / active_client / non_business / spam
- Routes accordingly (creates lead, logs to existing contact, silent log, mark spam)

**Marketplace email parsing:**

- Prompt extracts: name, email, phone, event_date, venue, budget, message
- Returns structured JSON
- Falls back to manual review if confidence low

**Report generation:**

- Prompt translates natural language query to: report config (dimensions, measures, filters, visualization)
- Renders using same engine as custom report builder
- Includes plain-language summary of findings

**Workflow drafting:**

- Prompt translates "When X happens, do Y, then Z" into workflow node structure
- Returns draft workflow for human review and edit

**Migration interpretation:**

- Prompt analyzes CSV sample data, suggests field mappings, identifies edge cases
- Conversational follow-up for clarification

**Daily health report:**

- Prompt summarizes yesterday's automation success rate, failures, integration health, items needing attention
- Sends as formatted email to admins

Cost management: cache common AI responses; rate-limit per workspace; track token usage per workspace for future billing.

---

## 8. AUTHENTICATION AND AUTHORIZATION

**Auth:** Email + password with bcrypt; magic link option; OAuth (Google, Microsoft) for SSO; 2FA via TOTP or SMS.

**Authorization:** Workspace memberships table is source of truth. Every authenticated request derives user's workspace_id and role + permission overrides. RLS at database level enforces workspace isolation. API middleware checks role/permission for each endpoint. Frontend hides UI elements user lacks permission for.

**Session:** JWT with 24-hour expiry, refresh tokens for longer sessions.

**Public access:** Smart Documents, invoices, scheduler booking pages use signed-token URLs. Tokens are workspace-scoped, record-scoped, action-scoped, and time-limited.

---

## 9. COST SUMMARY

| Module                                           | Estimated Cost      |
| ------------------------------------------------ | ------------------- |
| 4.1 Contact Management                           | $1,500              |
| 4.2 Event (Project) Management                   | $2,000              |
| 4.3 Pipeline + Kanban                            | $1,500              |
| 4.4 Workflow Engine                              | $2,000              |
| 4.5 Smart Documents                              | $2,000              |
| 4.6 E-Signature (native, locked)                 | $3,000–4,000        |
| 4.7 Invoicing + Stripe + Schedules               | $2,000              |
| 4.8 Email Hub                                    | $1,500              |
| 4.9 SMS Hub                                      | $1,500              |
| 4.10 Instagram DM                                | $2,000              |
| 4.11 Facebook Messenger                          | $1,000              |
| 4.12 Inbound Email Parser                        | $1,500              |
| 4.13 Unified Inbox                               | $1,000              |
| 4.14 Calendar + Scheduling                       | $2,000              |
| 4.15 Reporting + Custom Builder                  | $2,000              |
| 4.16 Template Library                            | $1,500              |
| 4.17 Vendor Matrix                               | $500                |
| 4.18 Photographer Briefs                         | $1,000              |
| 4.19 Editing Boards                              | $1,000              |
| 4.20 Sun Calculations                            | $500                |
| 4.21 Time Tracking                               | $1,000              |
| 4.23 Multi-User RBAC + Row-Level Security        | $3,000–4,000        |
| 4.24 AI Command Palette (net-new)                | $2,000              |
| 4.25 AI Features                                 | $1,500              |
| 4.26 Onboarding Flow                             | $1,000              |
| 4.27 CSV Migration                               | $1,500              |
| 4.28 Reliability Monitoring                      | $1,500              |
| 4.29 Task Engine + Dependencies + Checklists     | $2,000              |
| 4.30 Templated Task Plans + Instantiation Engine | $3,000–4,000        |
| 4.31 Team This Week (Workload View)              | $1,000              |
| 4.32 File Management (Per-Event Files)           | $1,500              |
| 4.33 Notification System                         | $2,000              |
| 4.34 Settings & Administration                   | $2,000              |
| **Module total**                                 | **~$52,500–55,500** |
| Integration setup, polish, testing (20%)         | **~$10,500–11,000** |
| **Total V1 build**                               | **~$63,000–66,500** |

**Plus operating costs during build:**

- Infrastructure (low-scale): $1-2K
- AI API costs during build/test: $2-3K
- Legal review of contract templates + e-sign flow (REQUIRED, separate, not optional given native e-sign): $3-5K
- Marketing/branding setup: $5-15K (your choice)
- Initial customer support tooling: $1-2K

**Realistic total launch budget: $80-105K**

(Delta from the earlier ~$54.5K figure: the repo audit disproved four "framework-provided" assumptions. E-signature (native, locked) and RBAC+RLS are each ~$3–4K not $1.5K; the AI command palette is $2K not $0; and a Settings & Administration module ($2K) was added after the spec review found it genuinely missing. None of this is scope creep — it is the cost of what was always required, now measured against the real foundation instead of an optimistic assumption. Modules 4.30 (templated task plans) and 4.6 (native e-sign) and 4.23 (RLS) are the three highest-overrun-risk items; treat the high end of each as the planning number.)

**Notes on this estimate:**

- These costs are measured against the VERIFIED foundation (Section 1, repo-audited 2026-05-18), not assumptions. The four prior over-optimistic assumptions have been corrected in-line.
- These costs cover initial build to working state. They do not cover ongoing maintenance, bug fixes, or post-launch customer support.
- The "20% polish and testing" buffer is conservative — real projects often need more.
- Honest timeline with the PM engine included: the earlier 5–7 month estimate becomes **6–8 months**. Modules 4.29–4.33 add roughly 4–6 real weeks; module 4.30 (templated task plans / instantiation) is the single most likely source of overrun and the one to pin the developer down on before committing.
- Scope-lock warning: 4.30's recompute logic invites scope creep toward Gantt/critical-path/resource-leveling. That is explicitly out. Holding that line is what keeps this 4–6 weeks instead of 4–6 months.
- Module-level costs are estimates; complex modules may run higher.

**Three questions to confirm with the developer before committing:**

1. **What is actually included at $1-2K per module?** Does it include edge cases, error handling, UI polish, mobile responsive — or does it just cover the happy path?

2. **Stripe Connect, native e-signature, and Meta integrations are confirmed net-new** (none in the foundation). These plus RLS and module 4.30 are the highest-risk items; their high-end estimates are the planning numbers.

3. **What's the model for ongoing maintenance and bug fixes after launch?** Hourly? Monthly retainer? Equity? This is where small build budgets blow up.

---

## 10. OPEN TECHNICAL DECISIONS

These are the calls that need to be made before build starts.

**Native e-signature vs DocuSign/PandaDoc integration.** Native saves per-customer cost but adds build complexity and ongoing legal compliance maintenance. Recommend native; revisit if compliance burden becomes painful.

**Stripe Connect Standard vs Express.** Standard gives photographers more control and full Stripe dashboard access; Express is simpler. Recommend Standard.

**IMAP/SMTP fallback for non-OAuth email providers.** Adds support breadth but increases reliability burden. Recommend supporting OAuth (Gmail, Microsoft) at launch; add IMAP later.

**AI provider.** Claude (Anthropic) is the recommended primary for instruction-following and structured output quality. OpenAI as fallback if needed.

**File storage.** Confirmed Vercel Blob (in foundation). Cost matters at scale; revisit at customer 500.

**Mobile native (iOS/Android) build deferred to V2.** Confirmed.

**Multi-language UI.** Deferred to V2. English only for V1.

**SOC 2 timing.** Type 1 process initiated during V1 build, achieved within 6 months of launch. Type 2 achieved by year 2.

---

**END OF V1 TECHNICAL BUILD SPEC**
