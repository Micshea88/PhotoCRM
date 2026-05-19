# PHOTOGRAPHY CRM/PM PLATFORM

## V1 Build Sprint Plan

**Version:** V1
**Companion to:** V1 Requirements, V1 Build Spec, V1 Template Library
**Purpose:** module build order, dependencies, critical path, realistic time estimates, and launch-readiness criteria.

**Honest framing:** this is not a 3-week MVP plan. With the project-management engine in V1 scope (task engine, dependencies, templated task plans, Team This Week), realistic V1 build time is **6-8 months** at the friend's framework's pace, including testing and polish. Anything faster is either scope cuts or quality cuts, and quality cuts ship a product that damages the brand before traction.

**Terminology note:** the core object is `project` in schema/API/code; photographers always see **"Event."** This plan uses "Event" for the object. Domain terms (Engagement Shoot, second shooter, the act of shooting) are preserved deliberately.

---

## 1. BUILD PHASE STRUCTURE

V1 build splits into four phases:

**Phase 1 — Foundation (Weeks 1-4)**
The platform skeleton. Nothing user-facing yet; everything depends on this.

**Phase 2 — Core Records, Pipelines & PM Engine (Weeks 5-13)**
The system becomes usable for tracking work. A photographer could start logging contacts and Events, run them through pipelines, and the project-management engine (tasks, dependencies, templated task plans, Team This Week) is built here because everything downstream — workflows, notifications, briefs — touches it.

**Phase 3 — Money & Communications (Weeks 14-21)**
Smart Documents, payments, email, SMS, IG DMs. The system becomes operational for running a business end-to-end.

**Phase 4 — Differentiation, Notifications & Polish (Weeks 22-32)**
Reporting, automation, briefs, onboarding, migration, reliability monitoring. The features that make the system better than competitors.

---

## 2. PHASE 1 — FOUNDATION (Weeks 1-4)

Goal: lay the technical foundation that everything else builds on.

### Week 1: Framework Setup & Architecture

- Confirm framework features (per Build Spec Section 1)
- Set up development environment, staging, production infrastructure
- Configure authentication, user model, workspace model, workspace memberships
- Set up Row-Level Security policies for multi-account isolation
- Initialize main database schema (workspaces, users, memberships, core record types as skeletons)
- Set up CI/CD pipeline
- Set up error monitoring (Sentry), logging, basic observability
- Submit Meta app for Instagram messaging review (long lead time — submit now)

### Week 2: Core Record Infrastructure

- Build custom fields engine (field definitions, value storage, type system) if not in framework
- Build formula field engine
- Set up audit logging and activity logging primitives
- Create the contacts, projects (UI label "Events"), opportunities table schemas with full fields
- Build basic CRUD API endpoints for all three record types
- Build basic frontend views (list and detail) for all three record types — placeholder UI, focus on data flow

### Week 3: Permissions & Roles

- Implement 8 user roles with default permissions matrix
- Build permission override system (granular per-user overrides)
- Apply RLS policies for all workspace-scoped tables
- Build user invite flow (email invite, role assignment, password setup)
- Build settings page for workspace owner to manage users

### Week 4: AI Foundation & Integration Scaffolding

- Set up AI service integration (Claude API or equivalent)
- Build AI command palette integration (leveraging framework's existing palette)
- Build integration credential storage (encrypted, per-workspace)
- Build webhook receiving infrastructure (inbound and outbound)
- Build background job queue / worker infrastructure
- Set up email sending infrastructure (Resend or Postmark)

**End of Phase 1 deliverable:** A multi-account platform where multiple users can sign in, see workspace-scoped data with proper permissions, and create/edit basic contacts / Events / opportunities. No client-facing features yet. No automation yet.

---

## 3. PHASE 2 — CORE RECORDS, PIPELINES & PM ENGINE (Weeks 5-13)

Goal: photographers can use the system to track their work end-to-end, even without billing or communications yet.

### Week 5: Contact Management Polish

- Complete contacts module: standard fields, custom fields per Section 4.3, activity timeline shell
- Contact list view with filtering, sorting, search, saved views
- Bulk operations
- Duplicate detection and merge flow
- Couples and billing contact handling
- CSV import (basic, without AI interpretation yet)

### Week 6: Event Management Polish

- Complete Events module: all field folders, multi-event coverage, photographer assignment, package and pricing fields
- Event list view with filtering
- Event detail page with collapsible folders, quick action bar (placeholders for sends until comms ready)
- Per-Event file space (upload, folders, client-visible flag riding the no-login link infra)
- Project template cloning
- Hide-empty-fields toggle

### Week 7: Pipeline & Kanban

- Five default pipelines pre-built per Section 6.3 of Requirements
- Pipeline configuration UI (add/edit/delete stages, reorder, color-code)
- Kanban view with drag-and-drop
- Stage totals, stale-card warnings, WIP limits
- Filter and bulk actions on kanban
- Auto-create opportunities on stage transitions (cross-pipeline)

### Week 8: Vendor Matrix & Custom Fields Polish

- Vendor matrix (saved Contact view with vendor-specific custom fields)
- Vendor ↔ Event association
- Vendor detail view with linked Events, communications, internal/public notes
- Custom field UI polish across all record types
- Folder organization for custom fields

### Week 9: Editing Boards & Time Tracking

- Editing boards table view (post-production status columns, inline editing)
- Customizable column visibility per user
- Time tracking module: timer, manual entry, categories, Event linking
- Time data feeds basic project profitability calculation

### Week 10: Sun Calculations & Photographer Briefs

- Sun/golden hour calculation library integration
- Auto-calculation on Event create/update
- Venue geocoding via Google Maps API
- One-pager photographer brief template engine
- PDF generation from Event data
- Brief auto-distribution scheduling (background job for 1-week and 24-hour triggers)

### Week 11: Task Engine + Dependencies + Checklists

- Tasks table + status state machine (Not Started / Blocked / Ready / In Progress / Done)
- `task_dependencies` join; completing a task runs the unblock pass over dependents
- `task_checklist_items` child table + inline-edit UI
- Per-Event stage table seeded from template but independently editable
- Task views: per-Event task list, "My Tasks", foundation for Team This Week
- Explicitly excludes critical path / Gantt / resource leveling

### Week 12: Templated Task Plans + Instantiation Engine

- `project_template_task_items` blueprint storage (relative offsets, assignee roles, checklist defaults)
- Instantiation engine: on Event creation, generate concrete tasks with absolute due dates from relative offsets, resolve roles to users, populate checklists
- Recompute-on-event-date-change with `due_date_overridden` protection (reuse payment-schedule recompute pattern)
- **This is the single highest-overrun-risk module. If the framework lacks a date-offset recompute pattern, this slips. Pin the developer down before committing.**

### Week 13: Team This Week + Universal Saved Views

- Universal saved-view engine: `{object_type, filters, sort, columns, grouping, name, owner, shared}` — every list renders from this
- Curated default views per object (discipline: custom-view creation is a deliberate second-level action)
- Team This Week: saved-view config (tasks grouped by assignee × day) + week-grid render reused from calendar component
- Vendor Matrix re-expressed as a saved-view configuration (no longer bespoke)

**End of Phase 2 deliverable:** A photographer can sign up, set up their workspace, log contacts and Events, move them through pipelines, manage vendors, track time, calculate sun timing, generate photographer briefs, **and the full project-management engine works — templated task plans instantiate on Event creation, dependencies block/unblock, Team This Week shows workload, saved views work everywhere**. No money, no comms, no automations yet.

---

## 4. PHASE 3 — MONEY & COMMUNICATIONS (Weeks 14-21)

Goal: the system becomes operational for running a business end-to-end.

### Week 14: Stripe Connect & Invoicing Foundation

- Stripe Connect onboarding flow per workspace
- Invoice data model and CRUD
- Invoice builder UI with line items, tax, discount
- Public payment portal (no-login secure links)
- Webhook handling for payment events
- Payment scheduling (Pay In Full, 50/50, Thirds, Quarters, Monthly, Custom)
- Smart due date calculation (relative to Event date or other dates)
- Multiple billing contacts per Event

### Week 15: Smart Documents

- Smart Document data model
- Template engine for proposals (multi-package selection)
- Client-facing Smart Document flow (no-login link, package picker, live-updating contract terms and payment schedule)
- Smart Document status tracking
- PDF generation on completion

### Week 16: E-Signature

- Native e-signature implementation
- Multi-party signing
- Audit trail (IP, timestamp, user-agent)
- Signed PDF generation
- Integration with Smart Documents and standalone contracts
- ESIGN-compliant audit log

### Week 17: Template Library

- Template storage and CRUD
- Rich-text editor with merge field plugin (TipTap or similar)
- Per-event-type template variants
- Version history
- Template picker integration on send actions
- Pre-installed templates per V1 Template Library document

### Week 18: Email Communication Hub

- Email send infrastructure (transactional + user-account via OAuth)
- Gmail OAuth integration
- Microsoft 365 OAuth integration
- IMAP/SMTP for fallback providers
- Email threading preservation (in-reply-to, references headers)
- Open and click tracking
- Inbound email sync per user account
- Auto-logging to Contact records
- Email composer with merge fields

### Week 19: SMS Communication Hub

- Twilio integration
- Multiple phone numbers per workspace
- Per-user permissions enforcement
- Two-way SMS via webhook
- MMS support
- SMS templates
- Auto-logging to Contact records

### Week 20: Instagram DM Integration

- Meta Graph API integration (Instagram Business)
- OAuth onboarding flow
- Webhook for inbound DMs
- AI intent classification on each message
- Outbound DM API
- AI-suggested reply drafting
- Token refresh background job
- Failed-auth alerts

### Week 21: Native Inbound Email Parser & Unified Inbox

- Cloudmailin or AWS SES inbound email setup
- Unique inbox address per workspace
- AI parsing of marketplace email formats
- Pre-trained parsers for The Knot, WeddingWire, Zola, top 7 others
- Contact + Opportunity creation from parsed leads
- Facebook Messenger integration (lower priority — slip to Phase 4 if needed)
- Unified inbox view aggregating email, SMS, IG DMs, FB Messenger

**End of Phase 3 deliverable:** the system runs a photography business end-to-end. Photographer can send Smart Documents, get paid via Stripe, communicate with clients via email/SMS/IG DM, see everything in unified inbox. No automation, reporting, or polish yet.

---

## 5. PHASE 4 — DIFFERENTIATION, NOTIFICATIONS & POLISH (Weeks 22-32)

Goal: features that make the system better than competitors, plus the polish that makes it actually shippable.

### Week 22: Workflow Automation Engine

- Workflow data model and execution engine
- Trigger system (event listeners + scheduled checker for date-based)
- Node types: triggers, conditions, actions, wait, branch
- Visual workflow builder UI
- Test mode (simulate without side effects)
- Execution log with success/failure per step
- Background workers running executions

### Week 23: Pre-Built Workflow Templates

- Install 30+ pre-built workflow templates per Template Library document
- Test each workflow end-to-end with sample data
- Workflow customization UI (clone template, edit)
- Workflow management (activate, pause, archive)

### Week 24: Reporting & Custom Report Builder

- Pre-built reports (25+) per Section 6.15 of Requirements
- Custom report builder UI
- Schema-aware query builder
- 12 visualization types via recharts or similar
- Dashboard system with drag-and-drop widgets
- AI report generation (natural language to report config)
- Export to CSV, Excel, PDF

### Week 25: Calendar & Scheduling

- Calendar event data model
- Calendar views (Day, Week, Month, Year, Agenda)
- Google Calendar two-way sync
- Outlook two-way sync
- Apple iCal subscription (read-only)
- Public scheduling pages
- Zoom, Google Meet, Microsoft Teams meeting link integration
- Conflict detection

### Week 26: Notification System

- `notifications` + `notification_preferences` tables
- Events catalog wired to existing triggers (contract signed, payment received/failed, proposal viewed, task assigned/due/unblocked, lead captured, IG DM intent, workflow failed, questionnaire completed, calendar booked/cancelled)
- Two delivery channels in V1: in-app notification center + email
- Channel-agnostic dispatcher so V2 native-app push is a new adapter, not a core rewrite
- Per-event-type / per-channel preference matrix with shipped sensible defaults
- This is load-bearing for trust and the future mobile experience — not deferred

### Week 27: Onboarding Flow & Migration

- 5-question onboarding wizard
- Logic to auto-install pipelines, workflows, templates based on answers
- Sample data seeding option
- AI-powered CSV migration interpretation
- Field mapping wizard with AI suggestions
- Conversational AI setup for migration

### Week 28: System Reliability & Automation Monitoring

- Real-time health dashboard
- Integration health monitoring
- Anomaly detection background job
- Failed automation alerts
- Manual retry endpoints
- Daily AI health report email (scheduled job)

### Week 29: Mobile Polish & Cross-Browser Testing

- Mobile responsive audit across all modules
- Touch optimization
- Mobile-specific UX adjustments (modal vs slide-over, etc.)
- Cross-browser testing (Chrome, Safari, Firefox, Edge)
- iOS Safari and Android Chrome testing
- Performance optimization

### Week 30-32: Beta, Hardening & Launch Prep

- Documentation and help articles for every module
- Customer support tooling setup (help desk, knowledge base)
- Marketing site
- Pricing page
- Privacy policy, terms of service, security documentation
- SOC 2 Type 1 process initiated (target completion 6 months post-launch)
- Beta customer onboarding
- Launch checklist completion

**End of Phase 4 deliverable:** V1 is launch-ready against the success criteria (now 18 criteria) in Section 9 of the Requirements doc — including the PM engine, notifications, and file management.

---

## 6. DEPENDENCIES AND CRITICAL PATH

### Hard Dependencies (must build before)

- Auth + Workspaces + Memberships → everything else
- Custom Fields Engine → all record modules
- Contact records → all other modules referencing contacts
- Event (project) records → pipelines, opportunities, smart documents, invoices, briefs, tasks
- Task engine → templated task plans → Team This Week (each depends on the prior)
- Universal saved-view engine → Vendor Matrix, Team This Week, all list views
- Task engine + workflow engine + notification system are mutually referencing — build task engine first, then workflow, then notifications
- Workflow Engine → all 30+ pre-built workflows
- Template Library → all send features (contracts, emails, SMS, Smart Docs)
- Stripe Connect → invoicing, Smart Documents payment
- E-signature → Smart Documents, contractor agreements
- Email Hub → workflow email actions, daily health report, brief distribution
- AI Foundation → AI features across multiple modules

### Soft Dependencies (better if before)

- Photographer briefs work better after sun calculations are built
- Editing boards work better after Events are polished
- Reporting works better after most data sources exist
- Workflow templates work better after Smart Documents, invoicing, and communications are built (workflows trigger sends)
- Notifications work better after the events they report on exist (payments, tasks, workflows) — built late in Phase 4 deliberately

### Critical Path

The longest dependency chain dictates minimum build time:

Foundation (4 weeks) → Records, Pipelines & PM Engine (9 weeks) → Money & Communications (8 weeks) → Differentiation, Notifications & Polish (11 weeks)
= **32 weeks minimum critical path**

The PM engine (Weeks 11-13) sits on the critical path because the task engine, workflow engine, and notification system are mutually referencing — they cannot be fully parallelized. This assumes work happens sequentially through the critical path. Parallel work can compress total calendar time but not the critical-path length itself.

---

## 7. PARALLELIZATION OPPORTUNITIES

If multiple developers are available, work can run in parallel along independent tracks:

**Track A — Core platform:** auth, permissions, custom fields, records, pipelines

**Track B — Payments and documents:** Stripe Connect, Smart Documents, e-signature, invoicing, templates

**Track C — Communications:** email, SMS, Instagram, Facebook, unified inbox, inbound email parser

**Track D — Differentiators & PM:** task engine, templated task plans, Team This Week, workflow engine, reporting, briefs, sun calc, editing boards, time tracking, notifications (note: task engine must precede workflow + notifications within this track)

With 2-3 developers working in parallel, calendar time compresses from 32 weeks to roughly 24-28 weeks. The PM engine chain (task engine → templated plans → Team This Week) and the Meta app review remain hard dependencies regardless — the PM chain because each layer needs the one below it, Meta because it's an external review queue.

---

## 8. RISKS AND MITIGATION

### Risk 1: Meta App Review Delay

Meta app review can take 2-6 weeks. If it takes 8+, Instagram DM integration is delayed.

**Mitigation:** Submit in Week 1. Build other modules in parallel. Have a fallback plan to launch without Instagram DM if Meta review stalls (IG DM becomes a "coming soon" feature; everything else ships).

### Risk 2: Stripe Connect Edge Cases

Stripe Connect has compliance and verification edge cases (international photographers, business entity issues, identity verification failures). These can take days each to resolve.

**Mitigation:** Build Stripe Connect early in Phase 3. Test with at least 5 different workspace setups (sole prop, LLC, S-corp, international). Have a Stripe support contact ready.

### Risk 3: Workflow Engine Reliability

The workflow engine is the second-highest-risk module after Stripe. Workflows that silently fail damage trust permanently.

**Mitigation:** Build reliability monitoring (Section 6.18 of Requirements) in the same phase as the workflow engine, not after. Test failure modes aggressively. Build manual retry from the start.

### Risk 4: Scope Creep During Build

The biggest historical risk. Adding "small" features mid-build cascades into delays and bugs.

**Mitigation:** The V1 Requirements doc is the scope lock. Any addition requires formal scope amendment with budget and timeline impact. Defer new ideas to V2 backlog. **Specific PM-engine watch:** Week 12 (templated task plans) invites creep toward Gantt / critical-path / resource-leveling. That is explicitly out of V1. Holding that line is the difference between a 4-6 week PM-engine add and a 4-6 month one.

### Risk 5: AI Quality

AI features need to actually be useful, not theater. Bad AI suggestions are worse than no AI suggestions.

**Mitigation:** Each AI feature gets explicit acceptance criteria. Quality testing before launch. Human override always available. Graceful degradation if AI fails.

### Risk 6: Beta Customer Feedback Reshapes Scope

Real customer usage in beta will surface issues that need fixing before launch.

**Mitigation:** Onboard 5-10 beta customers starting Week 22 (Phase 4). Their feedback shapes Week 25-26 polish. Some smaller items may slip to V1.1 patch release post-launch.

---

## 9. LAUNCH READINESS CHECKLIST

Before public launch (open signup), confirm:

**Functional**

- [ ] All 33 modules per Requirements Section 6 functional and tested (includes task engine, templated task plans, Team This Week, file management, notification system)
- [ ] All 30+ pre-built workflows installed and tested
- [ ] All 6 contract templates, 12+ email templates, 6 SMS templates, 6 questionnaire templates installed
- [ ] Onboarding wizard end-to-end completion in <1 hour
- [ ] CSV migration tested with exports from Honeybook, Dubsado, Tave
- [ ] Smart Document end-to-end (send, view, sign, pay) tested across browsers and devices
- [ ] Stripe Connect onboarding successful for at least 5 test workspaces
- [ ] Email threading preserved verified across Gmail, Outlook, iOS Mail, generic IMAP
- [ ] Instagram DM end-to-end tested (incoming with intent detection, outgoing with AI draft)
- [ ] All 5 pipelines functioning with auto-create across boundaries
- [ ] Templated task plan instantiates correctly on Event creation; moving event date recomputes non-overridden due dates without clobbering manual edits
- [ ] Task dependency works: blocked task flips to Ready when blocker completes; checklists populate from template and are editable per Event
- [ ] Team This Week shows each member's tasks/Events for the week
- [ ] Per-Event file space works with client-visible toggle through no-login link
- [ ] Notification system delivers in-app + email across the events catalog with working per-event/per-channel preferences
- [ ] Mobile responsive on iPhone Safari and Android Chrome

**Reliability**

- [ ] Workflow execution log captures every step success/failure
- [ ] Failed automations alert workspace admin within 5 minutes
- [ ] Daily AI health report email sending successfully
- [ ] Integration health dashboard live for all V1 integrations
- [ ] Anomaly detection active

**Compliance and Security**

- [ ] SOC 2 Type 1 process initiated with auditor
- [ ] Privacy policy and terms of service finalized
- [ ] GDPR/CCPA data export and deletion flows tested
- [ ] Encryption at rest and in transit verified
- [ ] 2FA available for all users
- [ ] ESIGN compliance verified by legal review

**Operations**

- [ ] Help documentation covers every module
- [ ] Customer support intake (email + in-app) functional
- [ ] Response time targets defined (e.g., <4 hours business hours, <24 hours weekend)
- [ ] Escalation path defined for critical issues
- [ ] Incident response plan documented
- [ ] Marketing site live
- [ ] Pricing page live
- [ ] Beta customer testimonials collected

**Business**

- [ ] Stripe account active and tested
- [ ] Pricing tiers configured in billing system
- [ ] Cancellation and refund policies documented
- [ ] First 10 paying customers committed (pre-launch waitlist or beta conversions)

---

## 10. POST-LAUNCH (V1.1 and V2 Planning)

V1.1 patches expected in weeks 1-12 post-launch. These are bug fixes and small refinements based on real customer usage — no new modules.

V2 planning starts post-launch month 3, informed by real customer data:

- Which modules are most used?
- Which features are most requested?
- What gaps in V1 are most painful?
- Which V2 backlog items are highest priority?

The V2 backlog from the Requirements doc is the starting point. Customer data determines priority.

---

## 11. HONEST FRAMING OF TIMELINE

**32 weeks is the minimum critical path** with the PM engine in V1 scope. Real-world V1 build with all the integration risks, the PM-engine overrun risk (Week 12 especially), customer beta feedback cycles, and polish work is realistically **32-40 weeks (6-9 months, planning number 7-8 months)** for a high-quality launch.

If you must compress, the options are:

- Drop modules from V1 (e.g., defer Facebook Messenger, defer some pre-built workflows, defer the custom report builder leaving only pre-built reports)
- Accept lower quality on edge cases (more bugs at launch, more support burden post-launch)
- Add more developers (calendar compression but not critical-path compression beyond a point)

The right call depends on whether the Honeybook disruption window matters more than launch quality. Best answer is probably: **plan for 34 weeks (~8 months), aim for 32, ship when ready not when calendar says.** The PM engine is the reason this grew from the earlier 26-week estimate — it is the right trade (real CRM+PM vs. CRM with project fields) but it is real time, and Week 12 (templated task plans / instantiation engine) is the single line item most likely to overrun. Confirm it with the developer before committing the timeline.

---

**END OF V1 BUILD SPRINT PLAN**
