# K&K Photography CRM — V1 Roadmap

**Status:** Phase 4 in progress (Contacts module)
**Last updated:** 2026-05-21

This document is the single source of truth for V1 scope, locked architectural decisions, and post-V1 deferrals. Anything not in this document and not in `PIVOTS_LEDGER.md` is not part of V1.

---

## V1 Mission

Build a photography studio CRM that combines HubSpot's UX patterns with Honeybook's industry-specific feature depth, plus AI-powered reporting and workflow automation that differentiate from existing photo-industry CRMs (which have weak reporting and rigid workflows).

---

## V1 Module Inventory

### Shipped

1. **Dashboard** — command center, lands on login (P4.1 — commit `6e49e1f`)
2. **Contacts** — list, create, detail skeleton (P4.2 — commit `a748fb8`)

### In Progress

3. **Contacts** — full inline editing + activity feed + HubSpot detail page (PUSH 3)

### Queued — Core CRM

4. **Companies** — same patterns as Contacts
5. **Events** — central object, every shoot/wedding is an Event
6. **Pipeline** — opportunity progression with Kanban board view; Proposals surface here as progression items (sent → viewed → signed → paid)
7. **Tasks** — assignments, due dates, recurring
8. **Calendar** — visualize Events, Tasks, payment dues across day/week/month views
9. **Questionnaires** — accessible via Event records and global search; no top-level sidebar item

### Queued — Finance Suite

10. **Finance Overview** — cashflow chart, payment summary cards, expense summary
11. **Invoices** — top-level list of all invoices across events
12. **Payments** — top-level list of all payments, Stripe-backed
13. **Expenses** — manual entry, categories, receipt image uploads
14. **Taxes (simple)** — sales tax + income tax estimate tracking, annual summary

### Queued — Templates Suite

15. **Template Gallery** — landing page, filter by type + search across all templates
16. **Invoice templates**
17. **Proposal templates** — modular composition (wraps existing invoice + contract + payment schedule)
18. **Contract templates** — with signature fields
19. **Questionnaire templates**
20. **Marketing Materials** — display-only branded documents (renamed from "Brochures")
21. **Email templates**

### Queued — Platform Features

22. **AI Assistant** — chat panel + Reports generation capability
23. **Reports** — standalone module + AI integration; users build custom reports against record data
24. **Automations (Workflow Builder)** — visual flow builder, triggered actions, scheduling, chains
25. **RingCentral Integration** — call logging, click-to-dial, SMS

### Capstone

26. **Custom Objects** — let users define their own entity types

---

## V1.5 — Post-V1 Release

Goals shipped after V1 validates with real users:

- **Plaid bank account linking** — financial tracker showing real bank balances
- **QuickBooks 2-way sync** — invoices/expenses sync to QB accounts, ongoing maintenance

---

## V2 — Later

- Real tax features: 1099 generation, sales tax automation, quarterly estimates, TurboTax integration
- Communication Subscriptions (email list / topic management)
- Website Activity Tracking (pixel-based)
- Data Quality audits (dupe detection, missing field reports)
- Board view for Contacts (Kanban)
- Saved view categories (Provided / Admin Promoted / etc.)
- Tickets (customer support)
- Community space
- **Restore CRM changes** — full per-record version history with restore. Each field update captures the previous value so users can undo any change after the fact. Requires versioning schema (a `record_changes` table keyed by `(record_type, record_id)` with `field_path`, `old_value`, `new_value`, `actor_user_id`, `changed_at`), a restore action that re-applies a captured snapshot, and a conflict-resolution UI for the case where the field has changed since the snapshot was taken. The Push 2c.2 "Restore records" affordance restores soft-deleted _rows_ — this V2 feature would restore individual _field changes_. Deferred because the storage + UI cost is substantial and V1 users can manually retype.
- **Client portal** — Clients receive read-only access to a dedicated portal showing their bookings, contracts, deliverables, and invoices. Invited via a separate flow keyed on the contact record (NOT via `/settings/organization/members`). Client accounts have no access to the CRM itself. Separate from the internal 5-role RBAC (Owner / Admin / Manager / Team member / Accountant). The `client` value in `EXTENDED_ROLES` is reserved for this future feature — it's still a valid stored role in `member_role` for forward compatibility, but is no longer surfaced in the org members picker (Push 2c.5.1).

---

## Cross-Cutting V1 Features

### Smart Files (Templates → Records)

- All templates have variable placeholders (`{{client_name}}`, `{{event_date}}`, etc.)
- Variables auto-fill from records when template is applied
- Filled instances can be manually edited inline — user overrides stick
- Underlying record changes don't blow away manual overrides on filled instances
- Pattern: **exactly like Honeybook's Smart Files**

### Global Search (header, left side)

- Predictive search bar in top header
- Searches across contacts, companies, events, templates, filled documents (contracts, questionnaires)
- Type "Wedding Contract 2026" → predictive results, click → navigate
- Separate from AI Assistant (which generates content)

### AI Assistant

- Chat panel for asking questions about your data
- Generates reports (handed off to Reports module for saving/scheduling)
- "Intelligence" capability on contact records — summarizes history, suggests next actions

### Bulk Actions (list pages)

- Multi-select via row checkboxes
- Bulk: delete, change owner, change lifecycle status, add tag, etc.

### CSV Import (entity pages)

- Bulk import contacts and other entities
- Field mapping, validation, dupe handling

### Edit Columns (list pages)

- Pick which columns appear, drag to reorder
- Per-user customization

### Pagination

- Explicit page numbers (Prev / 1 2 3 ... Next)
- 10,000 record cap per entity (up from 500)

### Saved Views (list pages)

- Saved views render as TABS above the table (HubSpot pattern)
- Soft limit: 8 saved views per user
- CRUD: save current view as, rename, duplicate, delete

### Filter Chips (list pages)

- 7 most-used chips visible at top
- "+ More filters" button opens panel with situational filters
- Outside-click closes dropdowns; Escape key too; click chip again to close
- Real popover behavior — replace native `<details>` element

### Delete Confirmation Modal

- Reusable across all destructive actions
- Type "delete" to enable Delete button
- Applies to soft-delete AND permanent-delete actions

### URL Validation Standard

- Auto-prepend `https://` if user types `www.something.com` or `something.com`
- Applies to ALL URL fields across the app

### Archived (separate from Deleted)

- Schema: `archived_at` timestamp column (separate from `deleted_at`)
- Archived records hidden from main entity lists
- Accessible via dedicated `/archived` pages per entity
- No auto-purge

### Notifications

- Bell icon in top-right header with badge count

### Bookmarks

- Pinned items for quick access
- User can bookmark records, saved views, or pages

---

## UI Architecture

### Sidebar (collapsible, icon-only when collapsed)

```
Dashboard
Calendar
Bookmarks
─────
CRM ▼
  Contacts
  Companies
  Events
  Pipeline
  Tasks
─────
Finance ▼
  Overview
  Invoices
  Payments
  Expenses
  Taxes
─────
Templates ▼
  Template gallery
  Invoice templates
  Proposal templates
  Contract templates
  Questionnaire templates
  Marketing materials
  Email templates
─────
Automations
Reports
AI Assistant
─────
Settings
```

Sidebar is HIDDEN on entity detail pages. Records use the full screen width.

### Top Header

```
LEFT:  [Org switcher]  [Search anything...]
RIGHT: [Phone]  [Notifications]  [Settings]  [User dropdown]
```

- Phone icon dormant until RingCentral integration ships
- Help icon floats bottom-right (not in header)

### Contact Record Layout (and other entity detail pages)

3-column HubSpot-style:

- **LEFT sidebar (contact card):** avatar, name, email, copy icon, quick action buttons (Note/Email/Call/Task/Meeting/More), "About this contact" with inline-editable fields
- **CENTER:** tabs (Overview / Activities / Intelligence) → Data Highlights → Recent Activities → Associated records
- **RIGHT sidebar:** related-record panels (Companies, Events, Tasks, Payments, Notes)

Activities tab sub-tabs: All / Notes / Emails / Calls / Tasks / Meetings.

---

## Locked Naming Conventions

- "Dashboard" not "Home"
- "Deleted" not "Trash" (URL: `/contacts/deleted`)
- "Open tasks" not "Next Task Due Date"
- "Vendor referral" not "Referral"
- "Client referral" not "Past client"
- "Marketing materials" not "Brochures"
- Plain language across all UI strings
- US conventions (LOC1)

---

## Locked Architectural Decisions

- **D1**: Never show raw cents to humans; use `formatCents()` everywhere
- **AI1**: Every AI write routes through `orgAction`
- **LOC1**: US-only locale
- **RBAC**: 6 stored roles — `owner`, `admin`, `manager`, `user`, `accountant`, `client`. Display labels (Push 2c.6.6): Owner / Admin / Manager / **Team member** / Accountant / Client. Internal storage uses the `user` enum key (preserves Drizzle schema + BA mapping + audit log integrity); UI renders it as "Team member" for clarity. Display labels centralised in `src/modules/rbac/display.ts:ROLE_DISPLAY`.
- **Display rule**: "First Last — Company" via `contactLabel()`
- **Smart Files**: Honeybook-pattern variable substitution + manual override
- **Proposals**: Modular (wraps invoice + contract + payment templates)
- **Filter layout**: 7 visible chips + "+ More filters" panel
- **Saved views**: Tabs above table, soft limit 8/user

---

## Reference Patterns

- **HubSpot** — contact list filter chips, saved view tabs, 3-column contact record, top header pattern, edit columns
- **Honeybook** — Smart Files (variable substitution + override), Template Gallery layout, proposal as modular wrapper, industry-specific module names
- **Photo-industry CRMs** (Tave, Studio Ninja, etc.) — what we're differentiating against: better AI-powered reporting + cleaner UX + workflow flexibility

---

## Build Order Through Phase 4

1. **Micro-commit** — UI fixes, label changes, delete confirmation modal (next)
2. **PUSH 2a.5** — Archived feature + Lead Source hideable defaults
3. **PUSH 2b** — Saved views CRUD (as tabs — refactor from current chip bar) + filter chip layout ("+ More filters" panel + real popover behavior) + Open tasks rename + edit columns
4. **PUSH 2c** — Bulk actions + CSV import + pagination with page numbers + 10,000 record cap
5. **PUSH 3** — HubSpot-style detail page rebuild + inline editing + Add Note + Log Call + activity feed + quick action icons + data highlights + right sidebar
6. **PUSH 4 — UI Shell Refactor** — new sidebar (collapsible, new structure), new top header (org switcher + global search left; phone/notifications/settings/user right), floating help icon bottom-right, "Dashboard" naming, hide sidebar on detail pages
7. **PUSH 5+ — remaining V1 modules** in order: Companies → Events → Calendar → Tasks → Pipeline → Finance suite → Templates suite (including Smart Files cross-cutting) → Workflow Builder → AI Assistant + Reports → RingCentral → Custom Objects

Phase 5 = visual polish across all modules once V1 module set is complete. Limited polish for contact record (HubSpot visual hierarchy + density) may be pulled forward into PUSH 3.
