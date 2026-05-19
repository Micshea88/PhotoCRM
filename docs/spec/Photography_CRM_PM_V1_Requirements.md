# PHOTOGRAPHY CRM/PM PLATFORM

## V1 Requirements Specification

**Version:** V1
**Document type:** Master scope specification
**Purpose:** The complete, locked scope for V1 build. Module-by-module, with what's in and what's explicitly out.

**Scope lock principle:** every module below has a defensible reason for being in V1. Every deferred item has a defensible reason for being deferred. This document is the scope contract.

---

## 1. WHAT V1 IS

A complete operating system for wedding and event photography businesses — contacts, events, pipelines, contracts, payments, communications, calendar, reports, automations, and a real project-management core (tasks, dependencies, templated task plans, team workload), plus the photographer-specific tooling competing CRMs don't do well. Targets a roughly 60/40 CRM-to-PM balance: a best-in-class CRM that is also a genuine project-management system, not a CRM with project fields bolted on.

Built for businesses ranging from solo photographer with assistant up through multi-photographer studios (2-15 staff).

Multi-account, multi-user system with role-based permissions. **Not** multi-tenant white-label SaaS — that complexity is out of V1.

## 2. WHAT V1 IS NOT

- Multi-tenant SaaS / white-label / partner network
- Native gallery hosting (URL field only on the Event record)
- Integration with five gallery platforms (URL field only)
- Coaching, education, or community platform
- International tax handling
- Inventory and gear management
- Full e-commerce / print sales fulfillment
- Mini-session module
- Wedding day timeline collaboration with planners
- Native iOS/Android apps (responsive web only)
- Custom domain per workspace
- Heavy AI features beyond drafting and report generation

These have reasoning in the V2/V3 backlog at the end of this document.

---

## 3. GUIDING PRINCIPLES

**Keep it simple.** Plain language, sensible defaults, photographer terminology. Six-item top navigation. Search-first via command palette.

**Photographer-first.** Built around shoots, galleries, second shooters, anniversaries — not generic "deals" and "projects."

**Automation with human oversight.** Workflows assist; humans approve high-stakes actions. AI suggests; humans send. Every automation logs success or failure.

**Data sovereignty.** Full export at any time. No lock-in.

**Reliability is a feature.** Failed automations alert the user. Integration health monitored. The platform tells you when something broke.

**Mobile-aware.** Critical actions work on a phone. Native apps after V1.

---

## 4. ARCHITECTURE

### 4.1 Three-Record Data Model

Three records, linked by named associations:

**Contact** — a person. Permanent data that doesn't change between projects.

**Project** — an individual engagement (a wedding, an event, a session). One Contact has unlimited independent Projects. Repeat clients never overwrite previous project data.

**Opportunity** — a pipeline tracking instance for a Project. One Project generates multiple Opportunities across its lifecycle (Sales → Production → Post-Production → Album), each as a kanban card in the respective pipeline.

> **CRITICAL ARCHITECTURE DECISION — object name vs. display label.** The core object is named generically in the schema, API, and codebase: `project`, `project_id`, `/projects`, `project_templates`, `project_tasks`, etc. The photographer-facing **display label is "Event"** — every UI string, button, and screen says "Event," never "Shoot" and never the raw word "Project." "Event" is chosen deliberately: it is understood universally by photographers _and_ by the broader wedding/events industry (planners, venues, florists, DJs, videographers, caterers), so the same product language survives a future vertical expansion without diluting the photographer-first product in V1. See Section 4.7 for the display-name layer that makes this systematic.
>
> Rationale: deciding this now costs effectively zero (it is a naming convention in a spec, not a refactor). Retrofitting a generic object name after code exists is a multi-day refactor across tables, routes, queries, and tests. This is the single highest-leverage cheap-now/expensive-later decision in the build. It is locked.

### 4.2 Multi-Account, Not Multi-Tenant SaaS

Multiple accounts and users per business, with isolated data and role-based permissions. No white-label/partner-network plumbing.

### 4.3 Custom Fields Engine

Every record type supports unlimited custom fields, organized into collapsible folders with hide-empty-fields toggle.

Field types: text, multi-line text, number, currency, date, date/time, email, phone, URL, single-select, multi-select, radio, checkbox, file, image, user reference, contact reference, event reference (the project object), formula field.

### 4.4 Formula Fields

Auto-calculated from other field values. Math, date arithmetic, conditional logic, text concatenation, references to other fields and associated records. Powers package totals, payment amounts, due dates, lifetime client value, project profit, profit margin.

### 4.5 Associations

- Contact ↔ Project (one-to-many, with optional secondary contact and billing contact roles)
- Project ↔ Vendor contacts (many-to-many)
- Project ↔ Contractor users (many-to-many)
- Project ↔ Opportunity (one-to-many across pipelines)
- Project ↔ Task (one-to-many; see Section 4.8)
- Task ↔ Task (`blocked_by` dependency, see Section 4.8)

### 4.6 Couples and Billing Contacts

A Project can have:

- One or two primary Contacts (couples)
- Zero or more billing Contacts separate from primary contacts (parents paying for senior portraits, corporate AP paying for a wedding, separate families paying different parts)

Invoices route to the assigned billing contact via unique secure link — no shared codes, no logins required.

### 4.7 Display-Name Layer (Terminology as Configuration)

Object display labels are not hard-coded strings. A per-workspace terminology map resolves each object key to a display label, e.g. `project → "Event"`, `contact → "Contact"`, `opportunity → "Opportunity"`. The UI renders every label, button, breadcrumb, and empty-state string by reading this map — it never hard-codes "Event" or "Shoot."

In V1 this map ships with one configuration: the photographer pack, where `project` displays as **"Event."** The layer exists in V1 not because V1 needs multiple verticals, but because building it now (a small lookup table plus a UI label resolver, ~2–3 days) is the difference between future vertical expansion being a configuration change versus a codebase fork. This is V1 architecture, deliberately, even though V1 ships only the photographer terminology.

Out of scope for V1: actually shipping non-photographer terminology packs, an admin UI for editing the map, or per-user terminology. V1 ships the mechanism and one pack. Nothing more.

### 4.8 Task Model (Project Management Core)

This is what makes the system a real project-management tool, not a CRM with project fields.

**Task** — a unit of work. Fields: title, description, assignee (a user, or a role that resolves to a user — see Templated Task Plans), due date, status (Not Started / Blocked / Ready / In Progress / Done), priority, Project link, parent stage, `blocked_by` (zero or more Task references), order.

**Dependencies (`blocked_by` only).** A Task can be blocked by one or more other Tasks. While any blocker is incomplete, the Task shows as **Blocked**. When all blockers complete, it flips to **Ready** and can fire a notification and/or shift its due date by a configured offset. This is a foreign-key relationship plus a status rule — deliberately _not_ critical-path analysis, _not_ Gantt charts, _not_ resource leveling. The wedding/events task chain is largely linear and the professional knows the sequence; full PM-suite scheduling is explicitly out of scope and adds months for value this audience does not need.

**Checklists / subtasks.** A Task or a stage can contain an ordered list of checklist items: label, done flag, optional assignee. Checklist items are templatable (they come from the task-plan template) but fully editable per Project.

**Stages are user-editable per Project.** The default task/stage structure comes from the Project's template, but on any individual Project the user can add, remove, rename, and reorder stages and tasks freely without affecting the template. Separately, the user can edit the template itself so future Projects inherit their version. Two independent levels: edit this Event, or edit the blueprint for all future Events.

### 4.9 Templated Task Plans and the Instantiation Engine

**Template (blueprint).** A Project template carries, in addition to package/payment-schedule/default-workflow (already in V1), a **task plan**: a tree of task definitions with _relative_ timing (e.g., "T−90 days: send welcome packet," "T−7 days: confirm timeline," "T+2 days: back up files," "T+5 days: deliver sneaks") and default assignee _roles_ (e.g., "Lead Photographer," "Editor") rather than specific people. Checklist items are defined here too.

**Instantiation engine.** When a Project is created from a template and its event date and role assignments are set, the engine reads the blueprint and produces real records: concrete Tasks with absolute due dates computed from the relative offsets, assigned to the actual users holding those roles on this Project, with checklist items populated. It runs once on creation and **recomputes on change**: if the event date moves, every due date that has not been manually overridden recalculates; tasks the user has manually customized are protected from being clobbered. This recompute-with-override-protection logic is the same class of problem as the V1 payment-schedule auto-recalculation and should reuse that pattern.

This is V1 scope. The honest build cost (per the build spec): the base task engine is foundational and needed regardless; dependencies and checklists are small; the template-with-task-plan storage is small; the instantiation + relative-date + recompute-with-override-protection engine is the meaningful chunk (~2–3 weeks done properly). Total real add over the base task engine: ~4–6 weeks. It is built in V1 because retrofitting it later means re-touching the Project record, workflow engine, notifications, and saved-views a second time — strictly more total work.

### 4.10 Team This Week (Workload View)

A single screen: rows are team members, columns are the days of the current week, each cell shows that person's assigned Tasks and Events for that day, color-coded by type, with a simple count or hours total. No algorithm, no auto-balancing, no resource-leveling. It is a specific configuration of the saved-views engine (Tasks grouped by assignee and date) plus a week-grid render shared with the Calendar module. V1 scope; ~1 week because the data and grouping are free from infrastructure already being built.

### 4.11 Universal Saved Views

Every object list (Contacts, Events, Opportunities, Tasks) renders from one saved-query engine: `{ object_type, filters[], sort, visible_columns, grouping, name, owner, shared }`. Any filter/sort/column/grouping combination can be saved as a named view. Vendor Matrix and Team This Week are both just saved-view configurations, not bespoke features.

Discipline constraint (product, not architecture): ship a small curated set of well-designed default views per object; make "create custom view" a deliberate second-level action, not something users trip into. The system stays clean because defaults are curated and view-creation is intentional — this is an enforced design constraint, not an automatic property.

---

## 5. USER ROLES AND PERMISSIONS

**Owner** — full access including billing.

**Admin** — full operational access. Cannot modify billing or remove Owner.

**Manager** — manages clients, events, communications, workflows. Can be granted invoicing permission. Cannot see financial reports unless granted.

**Photographer** — only assigned Events and contacts. No financial visibility.

**Contractor** (external) — only assigned Events. Limited client info visibility. Sees pay status.

**Editor** (external) — only editing assignments. File delivery instructions, deadlines, pay status.

**Accountant** (external) — read-only financial access.

Granular permission overrides per user beyond role defaults:
View Contacts / Edit / Delete; View Events / Edit / Delete; View Financial Data; View Reports; Send Invoices; Send Contracts; Manage Workflows; Manage Templates; Manage Users; Access Vendor Matrix; View Contractor Pay; Manage Settings; Export Data; API Access; Send SMS (per phone number); View SMS Conversations (own vs all).

Audit log: every data modification logged with user, timestamp, action, record affected, before/after values, IP address.

---

## 6. V1 MODULES

### 6.1 Contact Management

Standard fields: first/last name, **company** (see below), primary/secondary email, primary/secondary phone, mailing address, date of birth, anniversary date, Instagram handle, Facebook URL, website, lead source, contact type (Lead, Active Client, Past Client, Vendor, Contractor, Referral Partner), lifecycle status (Active, Inactive, VIP, Do Not Contact), tags, owner, created date, last contact date.

**Company (first-class, lightweight reference — not a heavy object):** Company is a field on every Contact, populated from a typeahead picker with inline "create new" (so the same business is never typed five different ways). It is globally searchable (command palette), and usable as a filter, sort, column, and grouping anywhere the saved-view engine runs — including the Vendor Matrix. It is deliberately scoped: a Company is a name plus optional **website/URL**, **company main phone**, Instagram, and category — it is **not** a HubSpot-style company object with its own pipelines, activity timeline, or record page in V1 (that is explicit V2+ scope and a known creep risk). The reason it must be a reference and not a free-text string: the differentiator case (two "Kelly Smith" contacts who are both wedding planners at different companies) only resolves cleanly if every Kelly-at-Evergreen points at the _same_ company record; a free-text company string fragments and makes the disambiguation worse, not better.

**Phone modeling (personal vs. company):** the Contact keeps its own primary/secondary phone — these are the _person's_ direct/cell numbers. The _company main line_ lives on the Company reference, not duplicated onto each contact, so it stays consistent for every contact at that company and never has to be re-entered. A vendor view shows both: the person's direct number(s) and the company's main number and URL. Company URL is often the single cleanest differentiator between two same-named vendors — two "Kelly Smith" planners will almost never share a website — so it is a searchable/filterable field in its own right.

**Contact disambiguation display rule (mandatory, applies everywhere):** anywhere a contact appears in a list, picker, autocomplete, association field, or search result, the display is **"Name — Company"** (and falls back to "Name — email" if no company). This is so two same-named contacts are always distinguishable at a glance without opening either record. This is a display rule, low cost, but it must be enforced consistently or the two-Kelly-Smiths problem persists in the UI even when the data is correct.

Unlimited custom fields per Section 4.3.

Activity timeline: auto-populated from emails, SMS, IG DMs, calls, payments, document events, workflow actions, pipeline changes.

Summary panel on Contact record: name, photo, contact details, lifecycle status, event count, lifetime value, last interaction, next scheduled action, active opportunities, quick action buttons (call, email, SMS, IG DM, schedule meeting, add note).

Bulk operations: tag, add to workflow, email, SMS, export, delete, reassign owner.

Duplicate detection: email, phone, name+address matching with merge or confirm flow.

Couples and billing contacts per Section 4.6.

CSV import with field mapping wizard. CSV export of any filtered list. vCard import/export.

### 6.2 Event (Project) Management

Standard fields organized into folders.

**Core info:** event name (auto-generated as "[Last Name] — [Type] — [Date]"), event type (Wedding, Engagement Shoot, Proposal, Social Event, Family, Portrait, Corporate, Custom), lifecycle status, primary event date, start/end date and time, hours of coverage, photographer count, primary venue, ceremony venue, reception venue, venue notes, lead source, referred by, event notes, internal notes.

**Daylight & golden hour:** auto-calculated from venue coordinates and event date. Sunrise, sunset, golden hour (morning and evening), blue hour, civil twilight, solar noon. Recalculates if date or venue changes. Per Section 6.20.

**Package and pricing:** package name, base price, add-on line items, discount, tax, subtotal (formula), total project value (formula), package description.

**Pricing — discount and tax mechanics (precise):**

- _Discount_ — applied to the line-item subtotal as **either** a percentage **or** a flat dollar amount (workspace and per-Event selectable). Not both simultaneously on the same Event unless entered as separate discount line items.
- _Tax_ — a configurable local tax rate that can be **added to or subtracted from** the total. Tax rate is a per-workspace default, overridable per Event. Applied per-line-item where applicable (tangible goods such as prints/albums taxable; service portions handled per the workspace's tax rule). Full multi-state/multi-jurisdiction tracking is V2; V1 is single configurable rate.
- _Order of operations (fixed, must not vary by implementation):_ **(1)** sum line items → **(2)** apply discount (% or $) to the subtotal → **(3)** apply tax (+ or −) to the discounted subtotal → **(4)** result is the total project value → **(5)** the payment-schedule split runs on that final total. This sequence is mandatory because tax-before-discount and tax-after-discount produce different totals; the order is specified here so it is never left to developer assumption.

**Payment schedule:** unlimited payment installments. Split method is one of:

- _Pay in full_ — single installment for the total.
- _Even split by count_ — N equal installments; the system divides the total into N parts and absorbs rounding remainder on the **final** installment so the sum of installments always exactly equals the total (e.g., $6,800 / 3 → $2,266.67, $2,266.67, $2,266.66).
- _Percentage split_ — each installment is a percentage of the total; percentages must sum to exactly 100 (validated); amounts auto-calculate.
- _Fraction split_ — exact fractions (halves, thirds, quarters); used instead of percentages where exact fractional rounding is cleaner than 33.33%.
- _Manual_ — each installment's dollar amount and date set by hand; the system validates that the installment sum equals the total and visibly flags any mismatch (it does not silently accept a schedule that doesn't reconcile).

Each installment has: amount (formula from split method, or manual), due date (formula or manual — see smart due dates in Section 6.7), billing contact assignment, status (Scheduled, Sent, Paid, Overdue, Refunded).

**Recalculation rule:** if base price, an add-on, the discount, the tax rate, or the Event date changes, every installment **not manually overridden** recomputes from the split method; manually-overridden installments are protected from the recompute. This reuses the same override-protection pattern as the templated-task-plan instantiation engine (Section 4.9) — it is not a separate mechanism.

**Photographer assignment:** primary photographer, second shooter, backup, photographer notes, confirmation status.

**Multi-event coverage:** engagement, rehearsal dinner, wedding day, post-wedding brunch, bridal portraits, custom add-on — each with included checkbox, date, venue, photographer, gallery delivered date.

**Production tracking:** questionnaire dates, photographer 1-week-out reminder, day-before brief sent, flat lay reminder sent, vendor list received, vendor list (Vendor Matrix references), shot list, family/group photo list, music preferences.

**Gallery and delivery:** files backed up date (multiple locations), footage/files dumped to studio date, culling started/completed dates, sneaks selected/sent to editor/received/delivered dates, file transfer URL (Dropbox/WeTransfer/Google Drive — free text), gallery URL, gallery password, gallery expiration, vendor gallery URL, blog post URL, print release sent date.

**Album (wedding):** purchased, type, material, page count, selection dates, draft dates, approval, ordered, received, shipped, delivered.

**Anniversary:** auto-set from wedding date for re-engagement workflows.

Card view (kanban): client name, event type, date with countdown, project value, days in stage, assigned photographer, status indicators, next action.

Detail view: single page, collapsible folders, quick action bar (send email/SMS/Smart Doc/invoice), activity timeline sidebar, associated records, linked documents, financial summary, status badges.

Project templates: reusable per event type, pre-populating package/payment schedule/workflows/questionnaire/contract.

### 6.3 Pipeline & Kanban

Five default pipelines, all configurable:

**Sales:** New Inquiry → Contacted → Qualified → Consultation Scheduled → Proposal Sent → Contract Signed → Retainer Paid / Booked → Closed Lost

**Production:** Booked → Photographer Assigned → Engagement Shoot (conditional) → Pre-Event Questionnaire Sent → Pre-Event Questionnaire Completed → Timeline In Progress → Timeline Approved → Event Prep Finished → Event Complete

**Wedding/Event Post-Production:** Files Backed Up → Culling → Sneaks Selected → Sneaks Sent to Editor → Sneaks Received → Sneaks Delivered → Full Cull → Full Edit → Gallery Uploaded → Gallery Delivered → Vendor Gallery Delivered → Review Requested → Project Complete

**Family/Portrait Post-Production:** Files Backed Up → Culling → Proofing Edits → Proofing Gallery Created → Proofing Sent → Client Selections Received → Finals Edited → Gallery Delivered → Project Complete

**Album Production:** Album Invoice Sent → Album Purchased → Options Sent → Selections Portal Sent → Client Selections Completed → 1st Draft → Design Meeting Scheduled → Design Meeting Completed → Proof Sent → Proof Approved → Album Ordered → Received → Shipped → Delivered → Project Complete

Pipeline configuration: add/edit/delete stages, reorder, color-code, automation rules per stage, stage duration tracking, stale-card warnings, WIP limits.

Kanban view: drag-and-drop, filter by photographer/date/type/value/status, search, bulk actions, stage totals (count + sum), stale-card warnings.

Auto-create opportunities in subsequent pipelines on stage change: Sales → Production (when Booked), Production → Post-Production (when Event Complete; routes by event type), Post-Production → Album (if Album Purchased).

### 6.4 Workflow Automation Engine

**Triggers:** form submission, contact created/updated, event created/updated, opportunity stage changed, date-based (X days before/after a date field), email opened/clicked, SMS received, IG DM received, calendar event scheduled/cancelled/completed/no-show, payment received/overdue, contract sent/viewed/signed/expired, tag added/removed, manual trigger, webhook received, scheduled (cron).

**Conditions:** field comparisons, date comparisons, number comparisons, tag presence, owner checks, combinations with AND/OR/NOT, nested.

**Actions:** send email (template), send SMS (template), create task, update field, change pipeline stage, add/remove tag, add to/remove from workflow, create record, send Smart Document, send invoice, send questionnaire, create calendar event, send webhook, mark won/lost, create note, assign owner, wait, if/else branch, end workflow.

**Pre-built templates (ship with V1):** see Template Library document. Includes lead capture, sales follow-up, production prep, post-event delivery, anniversary re-engagement, contractor coordination, financial reminders, operational briefs.

Workflow management: visual node-based builder, test mode with sample data, version history, execution log with success/failure per step, failure alerts to workspace admin.

### 6.5 Smart Documents (Proposal + Contract + Invoice Unified)

Single client-facing flow combining all three documents.

**Photographer side:**

- Create from template, customize per client
- Offer multiple package options (e.g., Essential, Classic, Premium) and selectable add-ons
- Preview as client will see it
- Send via email (optional human-review task before send)
- Track status: Sent, Viewed, In Progress, Signed, Paid, Expired
- Completed Smart Doc auto-stored as PDF on Contact and Event records

**Client side:**

- Opens secure no-login link on any device
- Branded experience
- Picks package, toggles add-ons — pricing/contract terms/payment schedule update live
- Single signature pad covers all three documents
- Pays first installment in same flow
- Receives confirmation email with PDF

**Multiple billing contacts within one Smart Document:** different sections of the invoice route to different billing contacts. Couple signs the contract; parents pay one invoice; couple pays another.

Configurable expiration (1-30 days), reminders before expiration, one-click extension.

Audit trail: IP, timestamps, action log. ESIGN Act and UETA compliant.

### 6.6 E-Signature

Native implementation. Legally binding (ESIGN, UETA). Multi-party signing. Audit trail. Mobile-friendly. Signed PDF auto-attached. Workflow triggers on signature.

Used by Smart Documents and standalone contracts (model releases, contractor agreements, vendor agreements).

### 6.7 Invoicing + Stripe Payments + Payment Schedules

Stripe Connect — each workspace has its own connected Stripe account. Payments flow directly to the workspace's Stripe.

Supports credit cards, ACH, Apple Pay, Google Pay.

Invoice builder: line items, tax application per line, discount line items, custom branding, merge fields, payment terms, memo, attachments.

Smart payment scheduling per Section 6.2. Smart due date calculation: "X days before event date," "X days after contract signed," "X days after previous payment," "on specific date," "monthly on the Nth." Auto-recalculates with confirmation if the Event date changes.

Multiple invoices per Event, multiple billing contacts. Each billing contact accesses payment portal via unique secure link.

Auto-invoice generation on configurable triggers: invoice 1 on contract send, subsequent invoices on due date or N days before due date.

Payment tracking: real-time status, history per Contact and per Event, outstanding balance, overdue dashboard, auto-update Event fields, workflow triggers.

Refunds: full or partial, linked to original invoice, audit trail, email confirmation, auto-update the Event record.

Late payment auto-reminders: configurable (1 day before due, day of, day after, weekly until paid).

Basic tax handling: single configurable rate, per-line-item application, addable or subtractable from the total. Discount and tax follow the fixed order of operations defined in Section 6.2 (line items → discount → tax → total → split); invoicing must not re-implement a different order. Full multi-state sales tax tracking deferred to V2.

### 6.8 Email Communication Hub

Native two-way email sync: Gmail, Google Workspace, Microsoft 365, Outlook, IMAP/SMTP.

Per-user inbox OR shared workspace inbox, configurable.

**Email threading preserved.** All platform-sent emails use the real configured sending address, not platform-generated proxies. Replies thread correctly. Subject lines preserved. (Specifically engineered against the documented Honeybook problem.)

Open and click tracking. Email scheduling. Email templates with merge fields. Per-user signatures. Attachments. Conversation threading. Internal notes (team-only). Auto-logged to Contact records.

### 6.9 SMS Communication Hub

Two-way SMS via Twilio.

Multiple phone numbers per workspace (different brands, sales vs ops, per user).

Per-user SMS permissions: Send and Receive on Number X / Send Only / View Only / No SMS Access.

Conversation visibility configurable: all team members see all / users see only their own / owner + manager visibility.

Templates with merge fields. Scheduling. Workflow-triggered. MMS support. Delivery receipts. Auto-routed to correct Contact. Auto-logged.

### 6.10 Instagram DM Integration (V1 Priority Channel)

Two-way Instagram Direct Message integration via Instagram Messaging API.

OAuth connection to photographer's Instagram Business account at onboarding.

Incoming DMs:

- Webhook-delivered within seconds
- Routed against existing Contacts (match by IG handle) or creates new Contact if first-time sender
- AI intent detection categorizes message: booking intent (creates lead and opportunity) / active client communication (logs to Contact) / non-business (logs silently)
- DM thread appears in unified inbox

Outgoing DMs:

- AI-suggested replies based on photographer's tone and templates (human reviews and sends — no auto-replies in V1)
- Templates with merge fields

Token management:

- Auto-refresh of access tokens in background
- Failed token alerts notify photographer immediately (per Section 6.18 reliability monitoring)

Meta app review required for permissions (`instagram_manage_messages`). Submit early in build, not at end. 2-6 week approval window.

### 6.11 Facebook Messenger Integration

Same model as Instagram DM. Lower priority — IG is the higher-value channel for wedding photographers. Build after Instagram DM is shipped. If V1 timeline is constrained, can slip to early V2.

### 6.12 Native Inbound Email Parser (Marketplace Leads)

Unique inbound email address per workspace (e.g., `leads@inbox.[workspace].com`).

Photographer sets up email forwarding from The Knot, WeddingWire, Zola, Bridal Buds, Style Me Pretty, Junebug Weddings, and similar marketplace notification emails.

AI parser extracts: name, email, phone, wedding/event date, venue, budget range, message body.

Creates Contact + Opportunity with lead source automatically tagged.

Pre-trained parsers for the top 10 wedding marketplaces. AI fallback for everything else.

Forwarded personal-email inquiries also work — photographer forwards a casual inquiry and it becomes a tracked lead.

Webhook endpoint also exposed for Zapier/Make/custom integrations as catch-all.

### 6.13 Unified Inbox

Single view across email, SMS, Instagram DM, Facebook Messenger.

Filter by channel, status (unread/replied/archived), assignment, date range, client, tag.

Speed-to-respond timer on unread leads.

Compose new message in any channel. Reply from same view.

### 6.14 Calendar + Scheduling

Views: Day, Week, Month, Year, Agenda/List.

Calendar entry types: events (auto from Event records), client meetings, internal meetings, deadlines, reminders, tasks, travel time (auto-blocked before/after events), editing time blocks.

Filter by team member and event type. Color-code by category or photographer. Multi-day events, all-day events, recurring events.

Two-way sync: Google Calendar, Outlook Calendar. Apple iCal subscription (read-only).

**Public scheduling pages:** one per scheduler type. Pre-built types: Consultation Call, Design Meeting, Album Reveal. Plus custom. Each scheduler defines duration, available days/times, buffer, advance notice required, max bookings per day, location (Zoom / Google Meet / Microsoft Teams / phone / in-person).

Embeddable on photographer's website. Auto-confirmation email + SMS. Auto-reminders. Reschedule/cancel links.

**Auto meeting link generation:** native Zoom, Google Meet, Microsoft Teams integration. Calendar invite includes meeting link.

Calendar-triggered automation: scheduled/cancelled/completed/no-show events trigger workflows.

Conflict detection: overlapping events, event date conflicts, insufficient travel time.

### 6.15 Reporting + Custom Report Builder

**25+ pre-built reports:**

- Revenue by month/quarter/year, by lead source, by event type
- Average project value
- Lifetime client value
- Conversion rate (inquiries to bookings)
- Lead source ROI
- Pipeline forecast (sum of opportunities × stage probability)
- Win rate by stage
- Average time in stage
- Lost lead reasons breakdown
- Top referring vendors
- Top clients by lifetime value
- Geographic distribution
- Booking lead time (days from inquiry to booking)
- Days from booking to event
- Days from event to gallery delivery
- Repeat client rate
- Referral rate
- Workload distribution per team member
- Profit per project (basic — revenue minus time cost in V1)
- Outstanding invoices and aging
- IG DM lead conversion rate
- Marketplace lead conversion rate

**Custom report builder:**

- Drag-and-drop interface
- Any field from any record type as dimension or measure (count, sum, average, min, max)
- Filter combinations
- Group by any field
- Sort
- Save as named report
- Schedule auto-email (weekly, monthly)
- Share with team members

**Visualization options:** table, bar chart (vertical/horizontal/stacked/grouped), line, area, pie, donut, funnel, heat map, geographic map, KPI card, gauge, combination charts.

**Dashboards:** customizable, drag-and-drop widgets, multiple per user, real-time refresh, date range selectors, comparison mode (this month vs last).

**AI report generation:** natural language queries ("revenue by lead source this year") build the report automatically with appropriate visualization and plain-language summary.

**Exports:** CSV, Excel, PDF.

### 6.16 Template Library

Centralized storage for all reusable templates. See companion Template Library document for actual default content shipped with V1.

Categories: contract templates, proposal templates, Smart Document templates, invoice templates, questionnaire templates, email templates, SMS templates, workflow templates, print release templates (basic — full tiered library deferred).

Per-template features:

- Rich-text editor with merge fields from Contact, Event, Opportunity records
- Per-event-type variants
- Clone and edit
- Version history (track changes over time)
- Active/inactive flag
- Tags for organization

When sending a contract, invoice, questionnaire, or email, photographer picks from template list. Merge fields auto-populate from the relevant record.

### 6.17 Vendor Matrix

Implemented as a saved Contacts view with `contact_type = "vendor"` plus vendor-specific custom fields.

**Company is a primary search and filter criterion in this view** (it is the shared first-class Contact field from Section 6.1, not a vendor-only field). Because vendors are frequently differentiated only by company — two "Kelly Smith" wedding planners at different firms — the Vendor Matrix must support searching by company, filtering by company, grouping by company, and showing company as a column. Per-company rollups (events worked together, referrals sent/received) aggregate on the company reference.

Vendor-specific fields (in addition to the shared Contact fields including Company):

- Primary contact person
- Secondary contacts
- Email, phone, website
- Instagram handle (with optional auto-validation against Instagram presence)
- Facebook page
- Mailing address
- Vendor category (Wedding Planner, Florist, DJ, Band, Catering, Venue, Officiant, Videographer, Hair & Makeup, Cake, Stationery, Rentals, Transportation, Other)
- Tier rating (1-5 stars)
- Internal notes (honest take, quirks)
- Public notes (shareable description)
- Preferred vendor status
- Referral relationship (sends clients / receives clients / both / none)
- Referrals sent count, referrals received count, average referral value

Vendor ↔ Event association (many-to-many) per Section 4.5. Each Vendor-Event link can store specific notes for that event.

On any Event record, the Vendors field is a multi-reference: type to search, autocomplete suggests vendor contacts.

Vendor list on the Event is used for: blog post tagging, social media tagging, gallery delivery to vendors, day-of contact list.

Per-Vendor detail view: all contact info, all events worked together (filterable), revenue from referrals (if tracked), communication history, internal notes, quick actions (email, call, SMS, schedule).

Vendor reports: top referring vendors, vendors worked with most, inactive vendors, vendor performance.

### 6.18 One-Pager Photographer Briefs

Auto-generated brief from Event record data.

**Content:**

- Header: client names, event date, primary venue, photographer brand
- Schedule: timeline (if filled in) or condensed key moments
- Locations: all venue addresses with map links
- Key contacts: couple with phone numbers, day-of contact, hair/makeup, other key vendors
- Vendor list: all vendors with Instagram handles for tagging
- Coverage hours: start/end time, total
- Light timing: sunrise, sunset, golden hour (evening), blue hour
- Photographer team: lead, second shooter, videographer with each person's role
- Must-have shots from questionnaire and shot list
- Family/group photos numbered list
- Special moments
- Style notes
- Logistics: parking, vendor meals, getting-ready spaces
- Equipment reminders
- Day-before reminders for client (flat lay items, etc.)

**Auto-generation timing:**

- Initial brief auto-generated 1 week before the event
- Updated brief 24 hours before if anything changed
- Mobile-friendly day-of version morning of the event

**Distribution:**

- Auto-emailed to lead photographer
- Auto-emailed to second shooter and other assigned team members
- PDF version + mobile web version

**Customization:**

- Brief template configurable per workspace
- Different formats per event type
- Sections can be added/removed/reordered

### 6.19 Editing Boards (Post-Production Table View)

Spreadsheet/Notion-style table view of all events currently in post-production.

Each row = one Event. Columns are post-production status fields, inline-editable:

- Event name + date
- Post status (Awaiting Backup / Backed Up / Culling / Sent to Editor / Editing / Delivered to Client)
- Files backed up date + locations
- Footage/files dumped to studio date
- Culling started / completed dates
- Number of images sent for editing
- Sneaks sent to editor (date + file transfer URL + editor assigned)
- Sneaks received back (date + notes)
- Sneaks delivered to client (date + gallery URL)
- Full set sent to editor (date + file transfer URL + editor assigned)
- Full edit completed (date)
- Gallery uploaded to platform (date + gallery URL)
- Gallery delivered to client (date)
- Vendor gallery delivered (date)
- Editing deadline (calculated from event date)
- Days in current status (auto-calculated)
- Days until / past deadline (auto-calculated, color-coded)

Customizable columns per user — show only the fields the photographer actually uses.

Filter, sort, search. Bulk actions on selected rows. Stale-event warnings.

Editor-role users see only rows for their assigned events (limited view).

### 6.20 Sun + Golden Hour Calculations

Auto-calculated from venue coordinates and event date using open-source astronomical library (no API cost, no external dependency).

Calculated values displayed on every Event record:

- Sunrise
- Sunset
- Golden hour (morning)
- Golden hour (evening)
- Civil twilight (start and end)
- Blue hour (morning and evening)
- Solar noon

Recalculates automatically if event date or venue changes.

Surfaced on Event record (Daylight & Golden Hour folder) and embedded in the One-Pager Photographer Brief.

Venue address geocoded once via Google Maps or Mapbox API; coordinates cached on the Event record.

### 6.21 Time Tracking

Start/stop timer (running timer visible at top of screen).

Manual entry fallback: date, hours, project, description.

Time categories: Shooting, Editing, Client Communication, Travel, Admin, Meeting, Other (configurable).

Link time entries to a specific Event.

Per-user time tracking. Daily, weekly, monthly summaries.

Billable / non-billable flag.

Per-user hourly rate configuration. Auto-calculates time cost per event.

Time data feeds basic project profitability calculation: Revenue minus (Time × Rate) = Gross Profit.

Full expense tracking, Schedule C categorization, and detailed project profitability deferred to V2. V1 ships with basic time-cost-only profitability.

### 6.22 Multi-User and Role-Based Permissions

Per Section 5.

Implementation: workspace memberships table with role + granular permission overrides. Row-level security enforces access at the database level.

Invite users by email. They get an invite link, set password, join workspace.

Per-user notification preferences.

### 6.23 Mobile-Responsive Web

Mobile-first responsive design. All critical actions work on phone:

- View Contact details
- View Event details
- Send email or SMS or IG DM
- Update pipeline stage
- Log a payment
- Update post-production status
- View today's schedule
- Add a quick note
- Check off a task
- Sign contracts
- Approve sends

Desktop-recommended for: Workflow builder, custom report builder, mass record editing.

Native iOS/Android apps deferred to V2.

### 6.24 AI Command Palette

Already in the development framework — leveraged, not custom-built.

Cmd/Ctrl+K opens the palette. User types intent:

- Contact or event name → opens that record
- "Send invoice to..." → starts invoice creation
- "Create a new contact" → opens contact creation
- Natural language questions → AI provides answers or surfaces resources
- "How do I..." → opens help/documentation

The palette eliminates the need to navigate menus to find features.

### 6.25 AI Features (Lean V1 Set)

Limited and focused. AI is a feature, not the product.

**AI email drafting:** compose new email from context, reply suggestions on incoming emails, tone adjustment (formal/friendly/urgent), personalization using Contact and Event data.

**AI SMS drafting:** same as email, optimized for SMS length.

**AI Instagram DM reply suggestions:** drafted replies to incoming DMs, human reviews and sends.

**AI marketplace email parser:** powers the Inbound Email Parser (Section 6.12) by extracting structured fields from forwarded marketplace emails.

**AI report generation:** natural language queries build reports automatically.

**AI workflow drafting:** "When a wedding inquiry comes in, send the welcome series and notify me" → AI generates workflow structure, human reviews/edits/approves before activation.

**AI migration interpretation:** during CSV import, AI suggests how imported fields should map to system fields and asks clarifying questions.

**Daily AI health report:** per Section 6.18.

Everything else AI-related (meeting transcription, sentiment analysis, predictive analytics, AI agents, marketing copy generation beyond emails) deferred to V2 or later.

### 6.26 Onboarding Flow

Self-service signup. AI-powered setup wizard with five questions:

1. What types of events/sessions do you offer? (Wedding, Engagement Shoot, Family, Corporate, etc.)
2. What's your typical wedding package price range?
3. What payment schedule do you typically use? (Pay In Full, 50/50, Thirds, Custom)
4. What's your primary brand vibe? (Light and airy, dark and moody, classic, modern)
5. Are you migrating from another CRM? (Yes — go to migration / No — start fresh)

System auto-configures pipelines, workflows, templates, tax settings based on answers.

Optional integrations connected: Gmail/Calendar/Stripe/Twilio/Instagram. Skip available — can connect later.

Sample data option for exploration without commitment.

Target: operational within 1 hour for basic operations.

### 6.27 CSV Migration Import + AI Interpretation

Upload CSV from any source.

Field mapping wizard: system suggests field mappings based on column headers and sample data. User reviews and adjusts.

AI interpretation layer: after mapping, AI analyzes the imported data and asks clarifying questions ("These appear to be wedding clients booked in the past — should they be marked as Past Clients or Active Clients?" / "We see these payment statuses — how would you like them categorized in the new system?").

Deduplication: matches against existing Contacts by email/phone/name+address. Flags potential duplicates for user resolution.

Import report: count of contacts imported, count of events imported, count of opportunities imported, list of flagged edge cases for review.

Conversational AI setup: user can chat with the AI about their current process, and the AI configures the system to match (pipelines, workflows, templates customized based on the conversation).

Login-credential-based migration (auto-scrape from Honeybook/Dubsado/Tave) deferred to V2.

### 6.28 System Reliability + Automation Monitoring

Every automation logs its outcome (success or failure) with timestamp, trigger record, and result detail.

**Real-time health dashboard:** all connected integrations (Stripe, Gmail, Twilio, Instagram, Google Calendar, etc.) show status. Recent automation success/failure rate. Email deliverability metrics. Payment processing health. Scheduled automations queue.

**Anomaly detection:** AI monitors for unusual patterns and alerts on:

- Workflow that normally fires X emails per week suddenly fires 0 or 10x
- Email open rates drop suddenly
- Sudden spike in failed payments
- Calendar sync hasn't updated in 24 hours
- Instagram token failed authentication
- Email-marketplace parser failed on incoming email

**Manual retry:** any failed automation can be manually retried. Bulk retry from dashboard.

**Daily AI health report email:** sent every morning to workspace admin. Summarizes yesterday's automation success rate, failures with recommended action, email open rates, overdue invoices, integration health, anything requiring attention.

**Incident banner:** if a system-wide issue occurs (Stripe down, email throttling), banner notification in app and email to admins.

### 6.29 Task Engine + Dependencies + Checklists

Per Section 4.8. This is the project-management core that makes the system more than a CRM with project fields.

**Tasks:** title, description, assignee (user or role-resolved-to-user), due date, status (Not Started / Blocked / Ready / In Progress / Done), priority, Event link, parent stage, `blocked_by`, order. Created manually, via workflow action, or via templated task plan instantiation.

**Dependencies:** a Task can be `blocked_by` one or more Tasks. Blocked Tasks display as Blocked; when all blockers complete, status flips to Ready, optionally fires a notification, optionally shifts the due date by a configured offset. Explicitly NOT critical path, NOT Gantt, NOT resource leveling — those are out of scope as PM-suite features this audience does not need.

**Checklists / subtasks:** an ordered list of items (label, done, optional assignee) inside a Task or stage. Items are populated from the task-plan template but fully editable per Event.

**User-editable stages per Event:** the default stage/task structure comes from the Event's template, but on any individual Event the user can add, remove, rename, reorder stages and tasks without affecting the template. Editing the template itself is separate and affects only future Events.

Task views: per-Event task list, "My Tasks" across all Events, and Team This Week (Section 6.31). All are saved-view configurations (Section 4.11).

### 6.30 Templated Task Plans + Instantiation Engine

Per Section 4.9. The Event template carries a task plan: task definitions with relative timing (T−/T+ offsets from the event date) and default assignee roles, plus templated checklist items. On Event creation (date + roles set), the instantiation engine produces concrete Tasks with absolute due dates and real assignees, and recomputes non-overridden due dates if the event date changes, protecting manually customized tasks. Reuses the payment-schedule recompute pattern. This is the single biggest CRM-vs-PM differentiator and is V1 scope. Honest cost (see build spec): ~4–6 weeks over the base task engine; cheaper now than retrofitted.

### 6.31 Team This Week (Workload View)

Per Section 4.10. One screen: team members as rows, the current week's days as columns, each cell showing that person's assigned Tasks and Events for the day, color-coded, with a count or hours total. No algorithm, no auto-balancing. A saved-view configuration (Tasks grouped by assignee + date) plus a week-grid render shared with the Calendar module. Lets a studio owner see at a glance who is overloaded and rebalance manually. V1 scope; ~1 week because data and grouping come free from the saved-view and task engines.

Out of scope for V1: capacity forecasting, utilization %, resource leveling, drag-to-rebalance. (Time-tracking-for-capacity is explicitly deferred — see deferred list.)

### 6.32 File Management (Per-Event File Space)

A real per-Event file area, not just scattered attachments.

- Each Event has a Files area: upload, organize into folders, rename, replace
- Stored in S3-compatible object storage (Supabase Storage or equivalent — already in stack)
- Each file has a **client-visible** toggle; client-visible files surface in the no-login client link infrastructure already built for Smart Documents
- Common contents: signed contracts, model releases, vendor COIs, timelines, shot lists, planning PDFs, delivery receipts
- Files attach to the Event and appear on the Event record's Files folder
- Template Library (Section 6.16) remains separate — that is reusable blueprints; this is the working file space for a specific Event

Out of scope for V1: file versioning history, per-file granular permissions, in-app file commenting/annotation. Basic structured per-Event files with a client-visible flag only.

### 6.33 Notification System

A real user-facing notification system — not just the reliability health email (Section 6.28).

**Events catalog:** contract sent / viewed / signed; payment received / failed / overdue; proposal (Smart Doc) viewed; invoice paid; task assigned to me / task due / task blocked-cleared; new lead captured (form, IG DM, marketplace parser); IG DM received with booking intent; workflow failed; calendar event booked/cancelled; client questionnaire completed.

**Channels:** in-app notification center, email. Architecture is channel-agnostic so push can be added in V2 with the native app as a configuration change, not a rebuild.

**Preferences matrix:** per event type × per channel, per user. Sensible defaults shipped (don't make users configure before value).

Honest scope and limitation: in-app + email notifications are V1 (~2 weeks). True push notifications depend on the V2 native app (web push is unreliable on iOS, which is most photographers) — V1 ships the notification system, events catalog, and preference matrix with in-app + email delivery, and the push channel lights up when the native app ships. The architecture is built channel-agnostic in V1 specifically so the V2 push addition does not require touching the notification core.

---

## 7. INTEGRATIONS (V1 Required)

**Payment:** Stripe (Stripe Connect for per-workspace accounts, Stripe Tax optional).

**Email sending:** Resend or Postmark for transactional email; Gmail/Microsoft 365/IMAP/SMTP for user inboxes.

**Email receiving:** Cloudmailin or AWS SES for inbound email parsing (marketplace lead capture).

**SMS:** Twilio.

**Calendar:** Google Calendar API, Microsoft Graph API (Outlook). Apple iCal subscription.

**Video conferencing:** Zoom API, Google Meet (via Workspace), Microsoft Teams.

**Instagram:** Instagram Messaging API (Meta Graph API).

**Facebook Messenger:** Meta Graph API.

**Maps and geocoding:** Google Maps API or Mapbox (venue geocoding for sun calculations and drive-time).

**Webhooks and automation:** native webhook endpoints (inbound and outbound), Zapier integration.

**Public API:** REST API with OAuth 2.0 for external integrations.

---

## 8. V2 BACKLOG (Explicitly Deferred)

Each item below is deferred from V1 with a stated reason. The list exists so deferred work isn't lost and so V1 scope stays locked.

| Item                                                             | Reason for deferral                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wedding day timeline collaboration with planners                 | Real customer value but not in Tier 1 complaints; V2                                                                                                                                                                                                                                                       |
| Client portal                                                    | Most photographers communicate via email; portal is V2                                                                                                                                                                                                                                                     |
| Vendor/planner portal (anti-Honeybook design)                    | Real differentiator but planners can be served via email threading in V1; portal V2                                                                                                                                                                                                                        |
| Heavy AI features (meeting transcription, sentiment, predictive) | Wishlist not purchase driver per market research; V2                                                                                                                                                                                                                                                       |
| Print release library (5 tiers)                                  | Basic print release in V1 templates is enough; tiered upsell V2                                                                                                                                                                                                                                            |
| Commercial usage rights with monetization tracking               | V2                                                                                                                                                                                                                                                                                                         |
| Inventory and gear management                                    | Real photographer pain but no current CRM has it; addressable post-launch; V3                                                                                                                                                                                                                              |
| QuickBooks integration (bidirectional sync)                      | CSV export sufficient in V1; sync is V2                                                                                                                                                                                                                                                                    |
| 1099-NEC contractor tax compliance                               | W9 upload in V1; full 1099 generation V2                                                                                                                                                                                                                                                                   |
| AI-powered migration via login credentials                       | CSV import + AI interpretation sufficient in V1; login-based scraping V2                                                                                                                                                                                                                                   |
| Native iOS and Android apps                                      | Mobile-responsive web covers V1 critical actions; native app is the **headline V2 deliverable** — a focused 5-job app (check today, respond to lead, send contract, log payment, get notified), not a web-app port. V1 notification + API architecture is built so V2 push/native is config, not a rebuild |
| Push notifications (true mobile push)                            | Coupled to V2 native app; web push unreliable on iOS. V1 ships notification system with in-app + email; push channel lights up in V2                                                                                                                                                                       |
| Time-tracking-for-capacity (estimates → forecasting/utilization) | V1 has time tracking for basic profitability and the Team This Week manual workload view; estimate-based capacity forecasting deferred — minor for photography, additive later without rework                                                                                                              |
| Critical path / Gantt charts / resource leveling                 | Cut from V1 scope deliberately — wedding/events task chains are largely linear; PM-suite scheduling is months of work for value this audience does not need                                                                                                                                                |
| Custom domain per workspace                                      | White-label feature; not in V1 since no partner network                                                                                                                                                                                                                                                    |
| Multi-tenant SaaS / white-label / partner network                | Cut from V1 scope; the `project` generic object + display-name layer (Section 4.7) make a future vertical config-pack possible without a fork, but no vertical beyond photography ships in V1                                                                                                              |
| Non-photographer vertical terminology packs                      | Display-name layer mechanism is V1 architecture; actually shipping planner/videographer/venue packs is a V2/V3 go-to-market decision, not a V1 build                                                                                                                                                       |
| TikTok Lead Generation Ads integration                           | Inbound email parsing + webhook covers most lead capture in V1; native TikTok V2                                                                                                                                                                                                                           |
| Native gallery hosting                                           | Cut from scope entirely; not load-bearing for any other feature                                                                                                                                                                                                                                            |
| Print sales revenue ingestion from gallery platforms             | V4 vision                                                                                                                                                                                                                                                                                                  |
| Consented life-event re-engagement                               | V4 vision                                                                                                                                                                                                                                                                                                  |
| Print lab brokering partnerships                                 | V4 vision                                                                                                                                                                                                                                                                                                  |
| Mini-session module                                              | V4 vision                                                                                                                                                                                                                                                                                                  |
| Multi-currency, multi-language                                   | V2                                                                                                                                                                                                                                                                                                         |
| Tipping prompts on invoices                                      | V2                                                                                                                                                                                                                                                                                                         |
| OCR receipt scanning                                             | V2                                                                                                                                                                                                                                                                                                         |
| Full expense tracking with Schedule C tax categorization         | V2 — basic time-cost-only profitability in V1                                                                                                                                                                                                                                                              |
| State sales tax multi-jurisdiction tracking                      | V2 — basic single-rate tax in V1                                                                                                                                                                                                                                                                           |
| Reviews tracking aggregator (Google, The Knot, etc.)             | Review request workflow in V1; aggregator V2                                                                                                                                                                                                                                                               |
| Editing software integrations (Lightroom, Aftershoot)            | Cut from scope; status tracking only in V1                                                                                                                                                                                                                                                                 |
| Gallery platform deep integration (Pic-Time, ShootProof APIs)    | Cut from scope; URL field only in V1                                                                                                                                                                                                                                                                       |
| Native album design tool                                         | V3                                                                                                                                                                                                                                                                                                         |
| Coaching / education / community platform                        | Cut from scope entirely                                                                                                                                                                                                                                                                                    |
| Live chat widget on photographer's website                       | V2                                                                                                                                                                                                                                                                                                         |
| AI chatbot for off-hours website inquiries                       | V2                                                                                                                                                                                                                                                                                                         |
| Landing page builder                                             | V2                                                                                                                                                                                                                                                                                                         |

---

## 9. SUCCESS CRITERIA FOR V1 LAUNCH

V1 is launch-ready when:

1. A new photographer can sign up, complete onboarding, and have a configured workspace in under 1 hour
2. A photographer can migrate from CSV export of Honeybook/Dubsado/Tave with under 60 minutes of guided work
3. A photographer can send a Smart Document and a client can pick a package, sign, and pay in one no-login flow
4. Pipeline kanban works smoothly with drag-and-drop, stage automation, and 30+ pre-built workflow templates installed
5. Email, SMS, and Instagram DM all work in the unified inbox with AI reply suggestions
6. At least 25 pre-built reports are available, custom report builder works, AI natural-language report generation works
7. Photographer brief auto-generates from Event data, includes sun/golden hour timing, and emails to assigned photographer 1 week before
8. Editing board table view shows all events in post-production with file transfer URL fields and editor assignment
9. Creating an Event from a template instantiates the full task plan with correct relative due dates and role-resolved assignees; moving the event date recomputes non-overridden due dates without clobbering customized tasks
10. Task dependencies work: a blocked task shows Blocked and flips to Ready when its blocker completes; checklists populate from the template and are editable per Event
11. Team This Week shows each team member's tasks/events for the week so a studio owner can rebalance manually
12. Per-Event file space works with a client-visible toggle that surfaces files through the no-login client link
13. Notification system delivers in-app + email notifications across the events catalog with a working per-event/per-channel preference matrix
14. System reliability dashboard shows integration health and daily AI health report sends to admin
15. Mobile-responsive web covers all critical actions verified on iPhone Safari and Android Chrome
16. SOC 2 Type 1 process initiated (Type 1 expected within 6 months of launch)
17. Documentation and help articles cover every module
18. Customer support workflow established (channels, response time targets, escalation path)

---

## 10. THE SCOPE LOCK

This document is the V1 scope contract. Adding to V1 means renegotiating the build budget and timeline. Anything not in this document is V2 or later by default.

The biggest risk to this build is scope creep. The next biggest risk is optimism about timeline. Both are guarded against by:

- Discipline on the V2 backlog (deferred is deferred)
- Realistic build time estimates per the Sprint Plan companion document
- Module-level cost estimates with explicit "what's included" definitions per the Build Spec companion document

---

**END OF V1 REQUIREMENTS SPECIFICATION**
