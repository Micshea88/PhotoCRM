# Pathway Build Roadmap

Source-of-truth for all locked Pathway build decisions. **Read this at the
start of every Pathway prompt.** Claude Code reads it, Mike reads it, the
in-chat AI assistant reads it via `conversation_search`.

If a prompt or in-flight decision contradicts anything here, **STOP and
surface the conflict** — don't quietly walk back a locked decision.

---

## Push Sequence (V1)

- **Push 4** — Custom fields engine + manage duplicates: **SHIPPED ✅**
- **Push 3** — HubSpot+HoneyBook contact detail rebuild + 6 bundled
  improvements (collapsible nav, searchable dropdowns, pre-write dedup,
  CSV import duplicate UX, contact detail rebuild, merge UI rebuild):
  **CURRENT** — C1 (audit doc, this file's birth) → C7
- **Push 5** — Pipeline UI
- **Push 6** — Events CORE (list / detail / form / sub-events /
  photographers + placeholder tabs for later modules)
- **Push 7** — Tasks UI
- **Push 8** — Calendar + AI meeting assistant for Zoom calls
- **Push 9** — Companies UI
- **Push 10** — Questionnaires
- **Push 11** — Finance: Invoices + Payments + Stripe
- **Push 12+** — Templates / Proposal feature / AI Suite full agentic
  insights / AI Help Module platform-wide navigation / Reports /
  Automations

**Beta-ready target: end of Push 11.**

---

## Locked Architectural Decisions

### Entity terminology

- "**Events**" in UI = `projects` table in DB (confirmed bookings)
- "**Pipeline**" in UI = `opportunities` table in DB (pre-booking
  sales process)
- "**Studios**" in UI = `organization` table (multi-tenant)
- **Events architecture**: unified concept covering inquiries +
  bookings; `pipeline_status` field on Event; Pipeline page = kanban
  grouping events by status. **No standalone Pipeline section on
  contact detail right sidebar** — pipeline status is just a badge
  inside the Events section.

### Contact detail page (Push 3 C6)

**Desktop pattern (3-column):**

- LEFT sidebar: contact name + job title + email at top, action
  buttons row (Note / Email / Call / Meeting / More), "About this
  contact" section with inline-editable intrinsic + custom fields,
  "View all properties" link at the bottom that opens a searchable
  full-properties modal.
- ACTION BUTTONS: top row = create new outbound (Note creates a
  note, Email composes, Call initiates a call when RingCentral wired,
  Meeting schedules). MORE dropdown = log past activities (Log a
  call, Log an email, Log a note, Log a meeting summary, Log an SMS).
- CENTER 3 TABS:
  - **Overview**: AI lead status badge at top (rule engine +
    Anthropic classifier → 1 of 19 statuses across 5 categories);
    AI-generated client summary paragraph below the badge; Layer 3
    agentic insight cards (2-3 starter types in C6).
  - **Activity**: filter chip row for Emails / Notes / Calls /
    Meetings (completed) / Tasks (completed) / SMS; activity feed
    most-recent first; sources = audit_log + contact_notes + call_log
    - meetings + sms_messages (SMS table is a Push 3 placeholder
      until RingCentral integration lands); Add Note + Log Call
      buttons; search activities box.
  - **To-Do's**: upcoming meetings + tasks only (replaces HubSpot's
    "Intelligence" tab); icons to create new meeting / task; once
    completed, items move to Activity tab.
- RIGHT sidebar: 4 collapsible sections (each title is clickable →
  routes to a full subpage):
  - **Companies**: name + basic data per row; click name → Company
    detail (Push 9); "+ Add" inline modal with Create new / Add
    existing tabs.
  - **Events**: name + simplified pipeline status badge (INQUIRED /
    BOOKED / IN PRODUCTION / CULLING / IN EDITING / DELIVERED /
    COMPLETED); click → Event detail (Push 6); UNIONS opportunities
    - projects (Push 6 may collapse into single table; for now query
      both); "+ Add" inline modal.
  - **Financials**: payments made / pending / partial per event;
    click → Payments page (Push 11) for this contact; "+ Add"
    inline modal.
  - **Files**: completed files (invoices, proposals, contracts,
    questionnaires) sorted by event; "+ Add" supports blank or
    template-based file creation, all editable.

**Mobile pattern (single-column tabbed):**

- Tabs: Activity / Associations / About.
- Header: back arrow + name + 3-dot menu.
- Action row: Call / Email / Text / More circles.
- Activity tab: filter dropdown + AI summarize button + quick
  actions (Add Note / Create Task / Log Activity) + activity feed.
- Associations tab: card with expandable rows (Add Companies / Add
  Contacts / Add Events) — each opens inline picker/modal.
- About tab: "About this contact" header (collapsible) with inline-
  editable intrinsic + custom fields + "View all properties" link.
- Bottom nav (5 items): Home / Contacts / Tasks / Dashboards /
  Search.

### Tickets

**DROPPED for V1.** Mike's call. May revisit in V2.

### Proposal feature (P12+)

Contract + Invoice + Payment Portal ship as a single combined file
called "Proposal" — HoneyBook Smart Files pattern. **Required** for
Pathway to replace HoneyBook for K&K's workflow. Non-negotiable.

### AI integration

- **Anthropic only** for V1. No Gemini / OpenAI for Push 3.
  Abstraction layer (already largely in place via `src/lib/ai-model.ts`
  - `src/modules/ai-assistant/`) supports future provider additions.
- **Haiku** for cheap tasks (status classifier, summary, simple
  insights) — 99% of calls.
- **Sonnet** for complex agentic insights (rare).
- Same Anthropic integration powers the future AI Help Module
  (platform-wide navigation + client lookup assistant). Architecture
  must support arbitrary chat completions AND tool use, not just
  the lead status / summary use case.
- Full agentic AI Suite deferred to dedicated push **P12+**.
- **AI meeting assistant** (Zoom) lands in **Push 8** alongside
  Calendar.

### RBAC model

- 4 roles: **User / Manager / Admin / Owner**.
- **User**: own contacts edit + others view-only.
- **Manager**: edit any contact regardless of owner.
- **Admin**: same as Manager + can configure RBAC restrictions at
  settings level.
- **Owner**: same as Admin + organization-level controls.
- Codebase currently ships 6 EXTENDED_ROLES (extras: `accountant`,
  `client`). C6 treats `accountant` per Mike's confirmation in the
  C6 prompt (see Push 3 audit §13); `client` is V2 portal — no V1
  contact-edit perms.

### Pre-write dedup (Push 3 C4)

- **HARD BLOCK** on duplicate primary/secondary email OR phone
  (normalized to digits-only) across active contacts in the same
  org.
- Modal options: **"Go to existing contact" + "Cancel" only — NO
  override.**
- Companies CAN duplicate `main_phone` (different people use the
  same office line).

### Merge UI (Push 3 C7)

- Side-by-side **FULL record view** (not conflict-only).
- Floating "Set as primary" button per column.
- Per-field click-to-pick using inline editing primitives (shared
  with C6).
- Manual "Merge with..." trigger from contact detail Actions menu
  (HubSpot pattern: Actions dropdown → "Merge with..." opens contact
  search picker → after pick, merge modal opens side-by-side).
- Auto-detection scan still available on /contacts/duplicates from
  Push 4.
- **Engine unchanged** — `executeContactMerge` /
  `executeCompanyMerge` from Push 4 B2 are the load-bearing layer.

### Global app nav (Push 3 C2)

- Collapsible side nav on EVERY desktop page (240px expanded, ~64px
  collapsed, transition).
- Bottom nav (5 items) on mobile: Home / Contacts / Tasks /
  Dashboards / Search.
- Collapse state persists per-user via **localStorage** (no new DB
  table required — simpler, no migration).

### Mobile patterns

- Detail pages: single-column tabbed (Activity / Associations /
  About for contacts; Files / Activity / About for events).
- List views: stacked cards, not tables.

### Searchable dropdowns (Push 3 C3)

- Every long-list dropdown is searchable + predictive.
- Pattern reuses UserRefPicker / ContactRefPicker / CompanyPicker
  shape (from Push 4 A3).
- New primitive `SearchableSelect` lives in
  `components/ui/searchable-select.tsx`.
- Tags input upgrades to a true multi-select combobox with chip
  rendering + autocomplete from `listDistinctContactTags`.
- `lead-source-combobox.tsx` is **already a combobox** — no upgrade
  needed for Lead source field.

### CSV import duplicate UX (Push 3 C5)

- Matched rows default to "Update existing" — **already implemented**
  in the import wizard's `previewContactsImport.proposedAction`.
- Red TEXT (not banner) warning per matched row — replaces the
  current amber summary banner approach OR augments it.
- Per-row skip/exclude controls already exist; preserved.

### Lead status badge enum (19 statuses across 5 categories)

**CLIENT category (6):**

- **Booked Client** — contract signed + retainer paid, production
  hasn't started yet
- **Active Client** — currently in production (culling / editing /
  delivery phase)
- **Past Client** — all events completed, no current inquiry
- **VIP Client** — 3+ past bookings OR AI-detected high-value
  (proposal in top 10% of historical bookings OR premium package
  signals)
- **At-Risk Client** — booked client with overdue payment OR no
  response in 14+ days during active engagement OR missed milestone
- **Repeat Client** — 2nd+ booking with K&K (overlaps with Booked /
  Active — applies as a flag, not exclusive status)

**LEAD category (6):**

- **Hot Lead** — inquired in last 48 hours, no contact from us yet
- **Warm Lead** — we've responded, awaiting reply, 1-3 days since
  last contact (or AI determines context preserves warmth despite
  longer silence)
- **Lead in Progress** — active conversation OR proposal sent/viewed,
  recent activity
- **Cold Lead** — no response 4-7 days since last outreach (AI may
  override if context indicates otherwise)
- **Unresponsive Lead** — multiple outreach attempts, never replied
- **Dead Lead** — event date passed without booking

**REFERRAL PARTNER category (4) — VOLUME-BASED:**

- **Top Referral Source** — 5+ referrals in last 12 months
  (REGARDLESS of conversion rate — Layer 3 surfaces conversion gap
  as separate agentic insight)
- **Active Referral Source** — 3-4 referrals in last 12 months
- **Occasional Referral Source** — 1-2 referrals in last 12 months
- **Past Referral Source** — has referred before, none in 12+ months

**VENDOR category (3):**

- **Active Vendor** — worked together on event in last 12 months
- **Past Vendor** — past collaboration, none recent
- **Prospective Vendor** — in conversation, no event together yet

**OTHER (1):**

- **Uncategorized** — default for brand new contacts with no signals
  (Layer 1 has zero meaningful facts)

Note: Referral Source category is volume-based. Conversion gap is a
**separate Layer 3 agentic insight**, not a status downgrade. Top
Referral Source = 5+ referrals **regardless of conversion**.

---

## Deferred Items (out of scope for current push, locked for later push)

### V1.5 polish items (before V1.5 launch)

- `RestoreDeletedButton` uses `window.confirm` → replace with
  app-style modal.
- Merge engine RBAC test scoped to wrapper-only — add unit-level
  RBAC enforcement test OR a code comment documenting the boundary.

### Push 6 Events scope

- Each Event/project supports multiple sub-events (Wedding →
  engagement shoot, rehearsal dinner, ceremony, reception).
- Each sub-event has own type, date/time, photographer assignment,
  individual price.
- Total package/deal price = sum of sub-event prices + base,
  auto-calculated live.
- Dedicated `/events/[id]` detail page.

### Push 8 Calendar

- AI meeting assistant joins Zoom calls.
- Takes notes, generates summary.
- Auto-adds meeting notes/summary to client record for that event.

### Push 11 Finance

- Invoices + Payments + Stripe integration.

### Push 12+ AI Suite

- Full Layer 3 agentic insights expansion beyond Push 3's 2-3
  starter types.
- **AI Help Module**: platform-wide navigation assistant ("take me
  to X", "look up client Y") — shares Anthropic integration with
  Push 3 lead status / summary system.
- **Proposal feature**: Contract + Invoice + Payment Portal as
  combined Smart File.

### Background dedup scan cron

- V1 scope but deferred from Push 4.
- Vercel Cron Job + results cache table + notification UI.
- Matching engine already exists from Push 4.

---

## Discipline Rules (for Claude Code on every Pathway prompt)

1. **Read this roadmap doc** at the start of every Pathway prompt.
2. **Read the relevant audit doc** (`docs/push-N-audit.md`) if it
   exists for the current push.
3. **Never propose walking back previously-locked decisions.**
   Surface the conflict to Mike, don't quietly drop them.
4. **Always propose the proper root-cause fix first** when cost is
   only marginally higher than a workaround.
5. **No paternalism about Mike's pace or rest.** Mike picks the
   pace.
6. **When in doubt, surface ambiguity to Mike before assuming.**
   STOP AND ASK, don't guess.
