# Post-P6 Product Map (vision / forward scope — NOT locked build)

Status: forward-looking. Reconcile against locked decisions + V1 wireframe before building. Governed by the standing laws in AGENTS.md (persona separation, PM performance, AI-is-a-tool, tenant-data-never-cross-referenced, plain-English UI).

> **How to use this doc:** this is a captured product map from an extended planning session — FORWARD-LOOKING SCOPE, not locked build decisions. Before building ANY of it, reconcile against the locked decisions in `docs/decisions-since-may-docs.md` (esp. §11 terminology, §12 build sequence, §18 Events/PM views + nav) and the V1 wireframe. Every item is governed by the standing **LAWS in `AGENTS.md`** → "Standing design laws" (LAW 1 persona separation, LAW 2 PM frontend performance, LAW 3 AI-is-a-tool, LAW 4 tenant-data-never-cross-referenced, LAW 5 plain-English UI) and the multi-tenant RLS hard rules (§4/§10a; `docs/multi-tenant-remediation-plan.md`). Cross-references to `docs/features-backlog.md` (F#) and `docs/pm-lifecycle-vision-and-events-prep.md` are noted inline.

## 1. PM ENGINE & NAVIGATION (refines Events/Pipeline/Tasks)

- STRUCTURE: bounded branching hierarchy — Project → sub-projects → tasks → subtasks (shallow, not infinite recursion; not purely linear). A wedding = Project; engagement session / rehearsal / wedding day / album = sub-projects, each with its own task chain. Tasks soft-gate the next (suggested order, manual override always allowed). Tasks can spawn sub-projects.
- PIPELINE vs TASKS/PM (two altitudes, no word-overload): PIPELINE = cross-event board (many events, one card each, moving through stages; Sales/Production/Post-Production instances); views = Funnel, Kanban, sortable/filterable List. TASKS/PM = per-event ONLY (one event's task tree + dependencies + Gantt + soft-gates); views = List, Board, Timeline/Gantt (Table CUT). EVENTS = the booked jobs list. Calendar and Team This Week are separate (below).
- CROSS-LINKING: each event has its own dedicated Tasks/PM screen (NOT a sidebar tab — reached by drilling in). From a Pipeline Kanban board, DOUBLE-CLICK a card opens that event's Tasks/PM screen (single-click/drag = move the card between stages). From the Events tab, opening an event opens its Tasks/PM screen.
- GANTT + DATE-CASCADE (reverses earlier "no Gantt"): Timeline/Gantt VIEW at BOTH project level (all sub-projects on one timeline) and sub-project level. DEPENDENCY DATE-CASCADE = moving a task/sub-project date auto-reschedules dependents; manual override of a date pins it (stops cascading). Full critical-path bottleneck analysis is SKIPPED / lightweight-only (deferred).
- USER-CREATED SUB-PROJECT TEMPLATES: users build a sub-project from scratch (tasks + dependencies), save as a reusable project-type template; picking it drops in the name + standard tasks with (−) to remove per-instance, (+) to add one-off, and an inline plain-English prompt "Does this task have dependencies, or is it the end of the chain?". Generates into the SAME task-tree schema as shipped templates + AI-import.
- SOFT-GATE OVERRIDE: "Was this task completed?" Yes/No; Yes = done; No = optional free-text reason (NOT required); whether the reason is required is an admin/org setting (or later add-on).
- CALENDAR = all-events upcoming/workload view (confirms wireframe Screen 09): Day/Week/Month/Agenda + custom date range; highlights CRUNCH DAYS visually (e.g. "Jun 23 — 2 weddings shooting + 3 galleries due") for capacity planning. NOT in Tasks/PM.
- TEAM THIS WEEK = people/assignment view (wireframe Screen 08): who's doing what, per-person workload. NOT in Tasks/PM or Calendar.
- EVENTS LIST/INDEX PAGE (gap in wireframe — needed): the browse-all-events page (like the Contacts list), reusing the Contacts-list pattern + searchability (filter chips, saved views, sortable columns, search). Distinct from Pipeline (Pipeline = active-motion stage view; Events list = full database browse).

## 2. FILES/DOCS & TEMPLATES (two separate systems)

- FILES/DOCS = live document instances: contracts, invoices, proposals, questionnaires, intake forms, signature-required AND fillable/interactive docs. Its own page(s); links to and references events/contacts; client-visible/internal flags; signed/completed state; client-sending; duplicable; searchable; labeled (most-used / last-used date / used-for-X-project). Left sidebar organizes by doc type (All / Contracts / Invoices / Proposals / Questionnaires / etc). Ties to Smart Docs. (Screen 05 Files section is the locked seed.)
- TEMPLATES = ONE unified home for all reusable blanks (file templates, email templates, gallery). The "unused master" versions you build/store and clone from. Follows the template→instance pattern already core to the PM engine (clone copies content, never the prior record's identity).
- ASSETS are NOT here — docs and creative media are separate systems (see §5).

## 3. FINANCE / "QB-LIGHT" (a product within the product; multiple pushes, ~P11+; weeks of work)

- Built as QB-Light AMBITION, not a thin payment-collection layer: income tracking, expense tracking, discounts, sales tax, contractor-payment/1099 tracking. NO actual payroll (W-2 withholding/filing) — contractor-payment tracking only.
- TAX: slots for local / state / sales / resale tax, and SEPARATE service-tax vs product-tax fields (they differ; law can change what's taxable). None required — user owns/enters rates, Pathway tracks. AI helper SURFACES current rates + the service-vs-product distinction + regulation changes for the user to verify and enter (never auto-applies); disclaimer (information, not tax advice) keeps liability near-nil.
- PROCESSOR-AGNOSTIC PAYMENTS: architecture processor-agnostic from V1 (Stripe Connect Standard = "your money, your processor" — the direct counter to HoneyBook's hated processor lock-in). V1 scope = Stripe; add the standard processor set later as config. PRE-BUILD RESEARCH REQUIRED: research the top processors competitors offer AND their integration SHAPES so the abstraction fits all of them (meet the standard, don't gold-plate). Accepted-methods config (card/ACH), and a "pass processing fee to client" option (with local-regulation disclaimer).
- EVERY FINANCE TABLE = RLS+FORCE, BULLETPROOF, ZERO GAPS. Highest-stakes application of the tenant-isolation laws; a finance leak is catastrophic. Enabled by the multi-tenant hardening being done now.
- QB coexistence: build QB-Light native AND offer optional QuickBooks integration (sync) for those who use QB — never force ours-only.

## 4. REPORTS (comprehensive regardless of tier; depends on Finance depth)

- 6–10 standard business reports (P&L, revenue by source, outstanding invoices aging, sales tax collected, 1099 totals, conversion by stage, avg project value, booking lead time, etc.) + a CUSTOM report builder (pick data, filters, views). Any report viewable as different chart/graph types easily. Reporting is comprehensive at every tier (don't cripple by tier).

## 5. ASSET LIBRARY (creative media only — separate from Files/Docs)

- Its own place; blob-backed (Vercel Blob); creative media only: photos, brand images, logo/favicon. Folders + sort + manual search.
- AI CONTENT-SEARCH over the tenant's OWN images (vision-tagged on upload — incremental/one-time per image for cost control; per-tenant isolated per Law 4; premium/tiered feature). Search by content: "brides", "people holding drinks", "dogs", "sunset ceremonies", etc.
- Logo/favicon are STORED here but APPLIED via branding settings (§6).

## 6. BRANDING / WHITE-LABELING (Settings → Company → org setup)

- Per-org white-labeling of client-facing surfaces. Match HoneyBook scope: main logo + secondary logo, brand color(s), a default smart-doc/theme, brand images. Applied from Settings; assets pulled from the Asset Library.
- CUSTOM DOMAIN: ship the easiest first — (1) our-subdomain with custom prefix (instant, zero DNS) as default; (2) bring-your-own custom subdomain (full white-label, requires DNS) as the upgrade. (This is HoneyBook's pattern.)

## 7. CLIENT PORTAL (V2/V3 — mapped now, built later)

- A dedicated, BRANDED, client-facing space per project: Overview / Activity / Tasks / Files / Payments / Notes. Secure link access; optional auto-include portal link in project emails; customizable with a preview. Persona-separation law: client-facing = minimal/branded, nothing internal wired in. Cross-client data isolation is a hard requirement (a client never sees another client's data). Pairs with the dedicated client-presentation views (F6) and client-facing lifecycle views.

## 8. INTEGRATIONS

- Import/migration: from spreadsheet, other CRM, Google Contacts, Gmail (AI-assisted — see F5).
- Minimum integration partner set (meet the standard): Google Calendar, Zoom, QuickBooks, Canva, Pic-Time, Flodesk, Zapier, Slack, Monday, Asana, Acuity, Calendly, Prismm. More later.
- ZAPIER + API KEY = must be built (the "connect to anything" escape hatch).
- QuickBooks integration coexists with native QB-Light (never force ours-only).

## 9. TEAM / RBAC (Settings → Company → Team)

- Roles/tiers (Owner / Admin / Basic + custom), assign what each member can see/do. Directly addresses hiding financials from associates.
- BOOKKEEPER ACCESS: a restricted role — a link giving limited access to financial data + reports only (for accountants). Pairs with QB-Light/Reports.
- Team-level notification toggles (e.g. notify owner when a client pays/signs a team member's doc); team calendars visibility; company data (employees, established).

## 10. SETTINGS STRUCTURE (My Account + Company; build each module's settings WITH that module; Settings aggregates)

- MY ACCOUNT (personal): Account info (name/email/phone/photo); Security (change password, verification phone, 2FA); Out of Office (auto-reply with date range + missed-activity summary on return); Email signature.
- COMPANY: Company brand (§6); Preferences = the CUSTOMIZATION ENGINE (project types, custom fields, lead sources, contact fields, tags — this is where "customizable per vertical" is delivered) + file/project defaults (default name format, default project name, "set calendar busy once booked"); AI settings (§11); Client portal & domain (§6/§7); Integrations (§8); Team (§9); Membership = Pathway's OWN SaaS billing (plan/billing/invoice history/change/cancel — graceful downgrade, don't hold data hostage); Bank details (Stripe Connect payout setup, OWNER-ONLY visibility); Client payment methods (§3).

## 11. AI SETTINGS (per-capability control — implements F5.6)

- Global AI settings page: per-capability toggles for every AI feature (suggestions on/off, workflow building on/off, summaries on/off, etc.) + the per-project AI pause (F5.6). Data-privacy statement front-and-center (Law 4). AI features to include over time: email drafts (in user's voice), meeting prep notes, project recaps, follow-up suggestions, lead enrichment, priority-lead notifications, BUSINESS TRENDS (lead/revenue trends from the tenant's OWN data only — NO cross-tenant), MEETING NOTETAKER (video-meeting summary/transcript/action items — version TBD), and AI DISCOVERABILITY (make the business findable by AI assistants like ChatGPT/Claude for lead-gen — forward-looking). All obey Law 3 (surface, human acts) and Law 4 (own-tenant data only).

## 12. OPEN QUESTIONS (decide later, do NOT resolve now)

- Notifications home: keep the dropdown + settings, OR also add a full notifications PAGE under Settings, OR make notifications its own section? (Undecided.)
- Meeting notetaker: which version/tier? (Undecided.)
- Tip reminder: low priority / optional (Mike finds it tacky; some users may want it).
- Vendor recommendations: uncertain value; maybe useful (HoneyBook's is unclear/messy).
- Sidebar reorg: near-LAST, after modules are built and final order is known. Do NOT hard-code sidebar as final.
- Dashboard: its own discussion later; takes shape once modules exist.

## 13. STRATEGIC MOAT (context)

Competitive weapons, by defensibility: (1) real CRM+PM done well (nobody does), (2) native QB-Light books (attacks HoneyBook's weak bookkeeping; kills a QB subscription), (3) processor-agnostic payments (attacks HoneyBook's most-hated lock-in), (4) AI as the bonus layer (world is heading AI-heavy; build for it now). AI is upside, not the thesis — CRM+PM done well beats the field even if AI plateaus.
