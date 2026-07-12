# Pathway Design System

Locked design decisions for V1 build. Sits alongside
`docs/pathway-build-roadmap.md` and `docs/pathway-ai-architecture.md`
as a required read at the start of every Pathway prompt (per memory
#10 discipline). Update this file when a decision is locked or
revised; don't re-debate locked items unless explicitly told to.

Canonical visual reference: **the V1 wireframe HTML**
(Photography_CRM_PM Phase 1 Wireframes — 15 screens) governs all
future module design. Two locked exceptions:

- **Contact detail** = 3-column HubSpot pattern (overrides the
  wireframe's 2-column).
- **Activity tracking is manual in V1.** Auto-tracking lands in V1.5+
  once email/SMS/payment integrations exist.

---

## 0. Product positioning — hybrid CRM + Project Management (LOCKED)

**Pathway is a hybrid CRM + Project-Management product, ~50/50 (up to
60/40).** It serves photographers who manage BOTH the client
relationship / sales side (leads, inquiries, proposals, contracts,
payments) AND project delivery (sessions, weddings, post-production,
edits, gallery delivery). **Both halves are first-class — PM is not
bolted onto a CRM.**

Design consequence: **the CRM default is not automatically correct.**
When a relationship/sales convention (HubSpot / Salesforce / Pipedrive
/ HoneyBook / Dubsado / 17hats / Studio Ninja / Táve / Iris / Sprout)
and a project-delivery convention (Asana / ClickUp / Monday / Notion /
Linear / Basecamp) differ, surface BOTH and let Mike choose — never
silently pick the CRM pattern. Every build-planning audit references
both sides and includes a "PM-friendly enhancement opportunities"
section (see `AGENTS.md` → "Build-planning audits — STANDING PROCESS").

Precedent (2026-06-19): tasks gained a 3-day yellow "due soon" state —
a PM pattern (Asana/ClickUp) absent from HubSpot/Salesforce — chosen
deliberately because photographers manage project deadlines, not just
a sales pipeline. New feature decisions that pick a PM convention over
a CRM convention (or vice versa) should note which side they took and
why, tracing back to this section.

---

## 0a. Standing design laws (LOCKED — authoritative text in `AGENTS.md`)

Seven LOCKED laws govern every UI / PM push. Full statements + rationale
live in `AGENTS.md` → "Standing design laws"; summarized here as the
wireframe/UI checklist:

- **LAW 1 — Persona separation.** No single screen serves both the
  CLIENT persona and the INTERNAL persona at once. Client-facing
  surfaces (booking, smart docs, proposals, portal) stay
  **minimal + linear**; internal surfaces (kanban, task lists,
  dependency views, workload, dashboards) carry the **density**. A
  screen is one or the other — never a blend. Every UI task states
  which persona it serves and stays in that lane; if it tries to serve
  both, split it. (The #1 UX failure that kills CRM+PM products.)

- **LAW 2 — PM frontend performance, built-in from v1.** Internal PM
  surfaces are built for real volume (**40+ active events, several
  hundred tasks, stays fast**) from their first version — optimistic UI
  on drag/status/reorder, list virtualization, pagination/lazy-load,
  proper indexing. Proven by **seeding realistic volume into
  production, validating the views stay fast at that scale, then
  removing the seed** — not a substitute for building it right.

- **LAW 3 — AI is a tool, not the owner.** AI SURFACES suggestions;
  the HUMAN acts. No AI auto-contacts a client, auto-sends, or completes
  an action on its own — everything AI surfaces needs explicit human
  approval. The human is always the gate on client-facing action.

- **LAW 4 — Tenant data is NEVER cross-referenced (CRITICAL).** A
  studio's data is its own. Never pooled, shared, or cross-referenced to
  another tenant for AI training, upsell, market insight, or any purpose.
  AI learns only from the individual tenant's own data. Enforce like RLS.

- **LAW 5 — Plain-English UI.** All UI copy — labels, prompts,
  questions, AI summaries — is simple plain English for a non-technical
  event professional. No tech-speak, code, or jargon.

- **LAW 6 — Responsive content width (no fixed-width islands).** Page
  content is FLUID — fills the available width with consistent horizontal
  padding, up to a sensible readable max-width — **never pinned to one
  fixed size, never a narrow island with big dead margins on wide screens.**
  Every page uses the SHARED page-shell / content-container (build one if
  it doesn't exist; a per-page width constraint is the bug this prevents).
  No doubled gutters (parent padding + child max-width). Check every screen
  at narrow / medium / wide before it's done. Applies to ALL screens.

- **LAW 7 — Test the RESULT, not the setup.** A display/interaction feature
  isn't done until a test asserts the **observable result**, not the state that
  should produce it: assert the list **reordered** (not that a sort param
  mapped), the row is **denser** (not that a density attribute is set), the
  quote was **removed** (not that a trim ran). COROLLARY: code parsing
  **external input** (email bodies, webhook payloads, imports) must be tested
  against **REAL captured payloads** — a test that passes on a fixture that
  doesn't resemble production input proves nothing. (Exists because D1/D2/D3
  shipped broken through clean reviews — see `cleanup-and-tech-debt.md`.)

- **Persona-law companion — client-presentation views are dedicated +
  opt-in.** For client-facing display (e.g. day-of timeline), build a
  DEDICATED client-safe view (nothing internal wired in) and let the user
  opt fields IN via toggles — never an opt-out "hide internal" toggle on
  an internal screen.

---

## 1. Inline edit + autosave UX contract

**Every editable field in Pathway uses `InlineEditField` or
`InlineEditSelect`.** When a new module ships a new editable field,
it ships with inline editing by default — never a read-only row.

Lifecycle:

1. Click the value → enter edit mode. A thin underline appears
   beneath the input (HubSpot pattern).
2. Type → in-progress value, NOT yet saved.
3. **Enter** or **blur** (click away) → autosave + exit edit mode.
4. **Esc** → revert + exit edit mode.
5. **No Save / Cancel buttons.** Deleted from the primitive.
6. On save error (dedup conflict, validation, server error) → stay
   in edit mode + show inline error message. The user retries
   without re-clicking.

Phone fields use the **displayValue / editValue / normalizeOnSave**
triple:

- `displayValue` = formatted, e.g. `(555) 739-9897`
- `editValue` = formatted (so the cursor lands on the formatted
  string, which is easier to edit than raw digits)
- User can type any variant — parens, dashes, spaces, raw digits,
  leading "+1" — all valid input
- `normalizeOnSave` calls `parsePhoneInput` → 10-digit canonical
- `validateBeforeSave` rejects non-10-digit US input inline (the
  user fixes it without losing context)

For select fields, `InlineEditSelect` autosaves on **selection** OR
**blur** (click outside). Custom pickers (Owner → UserRefPicker,
Company → CompanyPicker, Referred-by → ContactRefPicker,
Tags → SearchableMultiSelect, Address → AddressEditor) plug in via
the `renderPicker` slot (or, for non-string values, a small wrapper
component) and call the primitive's `commit(value)` callback to
trigger the save.

### Inline edit visual (no box, underline only)

Both `InlineEditField` AND `InlineEditSelect` use the **underline-
only** visual in edit mode. Never a bordered box, never a shadow.
Concretely:

- Edit-mode input has `border-0 border-b border-[var(--color-primary)]`
- For the default `SearchableSelect` path inside `InlineEditSelect`,
  the picker is mounted with `defaultOpen` so the panel appears
  immediately on entering edit mode (no second click to open) AND
  with `inlineMode` so the trigger renders as the same underlined
  value, not a closed box.

The closed-box-then-second-click flow is a smoke-blocking bug. Any
new primitive that fails this rule should be fixed before merge.

> **Every picker primitive used inside `InlineEditSelect` MUST
> support `inlineMode`.** No borders on the trigger or search input.
> No shadows. No closed-state pseudo-select elements. No "— None —"
> indicators. Use `border-b` for the input edge and render results
> as a floating popover below. Adding a picker via `renderPicker`
> without `inlineMode` support is a smoke-blocking bug — fix the
> picker, don't paper over it in the wrapper.

Polish #5 added three additional `inlineMode` invariants:

1. **Chevron suppressed.** Inline triggers MUST NOT render a
   `ChevronDown` (or any decorative dropdown indicator). Surface =
   underlined value text only.
2. **Panel portaled.** The results panel MUST render via
   `<PickerPortal>` (createPortal to `document.body`) so it can
   escape the host card's `overflow-hidden`. Any outside-click
   handler in the inline-edit family must check
   `target.closest('[data-picker-portal]')` to detect portal-
   originated clicks and avoid premature edit-mode dismissal.
3. **Filter by visible label only.** In inline mode the filter
   predicate MUST ignore the `description` field — typing "m" in a
   contact picker should not match "jwise@gmail.com" via its email.

All three are smoke-blocking bugs if violated.

Pickers shipping `inlineMode` today: `SearchableSelect`,
`SearchableMultiSelect`, `ContactRefPicker`, `UserRefPicker`,
`CompanyPicker`, `LeadSourceCombobox`. Each inline mode also
accepts an `onDismiss` callback so the host wrapper can autosave on
click-outside / Esc.

---

## 2. "Everything intentional" principle

Every empty state, placeholder, and "coming soon" element ships at
**full visual polish in the current push** — even when the underlying
module won't be wired until a later push.

Concretely:

- Empty states ship with a title + one-sentence body explaining
  what arrives when the module lands. Never barren boxes with stale
  paragraphs.
- Disabled buttons always carry a `title` tooltip explaining WHY
  they're disabled and WHEN they'll be wired. Never a grey button
  without a reason.
- UI shells (right sidebar sections, action icon row, command
  palette categories, notifications dropdown) ship visually
  complete; the wiring happens when the linked module ships.
- The reference implementation: `ContactDetailRight`'s
  `IntentionalEmpty` component. Mirror its pattern.

### Box usage rule (polish #5 Fix 4)

Bordered cards (rounded + border + background) belong on **discrete
actionable items**:

- Activity entries (notes, calls, meetings, SMS in the feed)
- Right-sidebar section container (single outer box with `divide-y`
  between sections; see §5)
- Modals
- Action icons (the circular icon backgrounds)
- Per-insight wrappers inside `AiInsightsCard`

Bordered cards DO **NOT** belong on:

- Inline-edit fields (use underline-only per §1)
- AI-generated content blocks (AI summary + AI insights outer
  wrappers) — they read as in-page text, not detachable widgets
- Pseudo-select triggers (already covered by §1 inlineMode rule)
- Content that flows with the page (page headers, breadcrumb rows)

**Test:** if a user acts on it or distinguishes it visually from
neighbours → card. If a user reads it as part of the page → no
card.

---

## 3. Header chrome (LOCKED)

The global app header is divided into three regions. Anything not
listed here does NOT belong in the header — file new modules into
the layout below or push them into Settings.

**Left:** page title / breadcrumb (no studio name, no "K&K" text,
no logo).

**Center-left:** AI search bar. V1 shell — type → Enter → inline
"AI ships soon" message. Same input wires to the real AI assistant
later. **Adjacent pop-out icon + ⌘K opens the command palette
modal.** Palette sections (V1 placeholders, populate as modules
ship):

- Contacts (search the contact list)
- Events (P6)
- Actions (Add note, Log call, Create task, etc.)
- Ask AI (V1.5+)

**Right (3 elements):**

1. **Help icon** — dropdown with two shells:
   - Help center (future push)
   - Chat with assistant (future push)
2. **🔔 Notifications bell** — V1 dropdown shows the "Notifications
   center arrives in Push 11 with Finance" intentional empty state.
3. **👤 Person icon + active org name** (single clickable target) —
   menu opens. Org switcher renders as a chevron sub-pop-out
   ("environment switching") under the menu. NOT a separate
   middle-bar dropdown.

**Explicitly NOT in the header:** theme toggle (REMOVED — Pathway is a
single light theme as of the reskin; dark mode + the toggle + `next-themes`
were dropped, see `docs/reskin-execution-plan.md` Phase 2), sparkle icon,
far-left "K&K" text, middle org-switcher dropdown.

---

## 4. Action icon row (contact detail)

6 circular icon buttons, in this order:

| #   | Icon           | Behavior                                                         |
| --- | -------------- | ---------------------------------------------------------------- |
| 1   | StickyNote     | Opens `AddNoteModal`                                             |
| 2   | Mail           | `mailto:${primaryEmail}` (real outbound, no email module needed) |
| 3   | Phone          | `tel:${primaryPhone}` (mobile + macOS handoff / FaceTime)        |
| 4   | CheckSquare    | Disabled — tooltip "Tasks ship in Push 7"                        |
| 5   | Calendar       | Disabled — tooltip "Meetings ship in Push 6"                     |
| 6   | MoreHorizontal | Dropdown — see below                                             |

**More dropdown items** (no "past" prefix — "Log" already implies a
past event being recorded). Polish #4 dropped "Log note" (redundant
with the Note icon above) and added Upload file at the bottom:

- **Log call** → opens `LogCallModal` (existing wiring via `logCall`)
- **Log email** → placeholder modal "ships P5+"
- **Log meeting** → placeholder modal "ships P6"
- **Log SMS** → placeholder modal "ships P5+"
- _(divider)_
- **Upload file** → placeholder modal "ships P11" (Files surface)

All styling complete NOW. When modules ship, the placeholder modals
get rewired without any visual rework.

---

## 4b. Actions dropdown (contact detail header)

Replaces the C6c `[Edit / Archive / Delete]` button trio with a
single `[Actions ▼]` dropdown. Items in this exact order:

1. **Edit full contact record** → routes to the existing edit form
   (`/contacts/[id]/edit`). Kept permanently — some users prefer the
   form over inline editing. **Do not remove.**
2. **View all properties** → placeholder modal (Add Fields action
   bar — see §8 upcoming scope).
3. **Merge** → contact-picker → existing merge engine. C7 redesigns
   the merge UI itself; this entry point is permanent.
4. **Clone** → placeholder modal.
5. _(divider)_
6. **Archive** → existing archive action (skipped when the contact
   is already archived).
7. **Delete** → existing delete action with confirm modal +
   destructive red styling.
8. **Export contact data** → placeholder modal.

Placeholder modals follow the "Everything intentional" principle
(§2). Each ships with a short title + ship-target body.

### Placement (LOCKED)

The Actions dropdown sits **adjacent to the back breadcrumb on the
LEFT side of the page header** (HubSpot pattern), NOT at the
top-right corner. Header layout:

```
Row 1: [< Back link]  [Actions ▼]    (left-aligned, gap-3)
Row 2: H1 page title  +  AI status badge
Row 3 (when present): "Archived" pill
```

---

## 5. Right sidebar polish standard

Polish #5 Fix 4a — the right sidebar is now **one** outer bordered
container. Sections are siblings separated by `divide-y`. Each
section header has count + "+ Add" + Actions popover + gear inline.
Content collapses via chevron without affecting the outer box.

Section header row, left to right:

- Drag handle (visual placeholder for reorder — not yet
  interactive)
- Chevron (open / closed)
- Title + `(count)` inline
- "+ Add" — primary-colored inline text button. Opens a placeholder
  modal until the linked module ships (Associations → P9, Events →
  P6, Financials / Files → P11).
- Actions dropdown (`MoreHorizontal` icon)
- Gear icon (section settings)

Content area follows the header with proper padding. Empty states
render per the "Everything intentional" principle (see §2).

Reference implementation: `ContactDetailRight`'s
`CollapsibleSection`.

---

## 5b. Mobile contact detail (single-column tabbed)

Under `lg` (< 1024px), the contact detail page switches from the
3-column desktop layout to a single-column tabbed shell. Both
shapes mount in the React tree, gated by Tailwind responsive
utilities (`lg:hidden` vs `hidden lg:grid`) so the user always sees
exactly one. The double-mount is intentional — keeping the desktop
and mobile trees structurally independent makes future shape
changes safe.

**Layout (top to bottom):**

```
Row 1: [< Back link]  [Actions ▼]
Row 2: H1 name        + AI status badge
Row 3 (when present): "Archived" pill
─────────────────────────────────────
[ActionIconRow — 6 icons, same as desktop]
─────────────────────────────────────
[Activity | Associations | About]    ← tab strip, equal-width flex
  [active tab content]
```

**Tab content:**

- **Activity** — AI summary card + AI insights card + activity feed
  (notes / calls / meetings / SMS — same `loadContactActivity`
  loader as desktop).
- **Associations** — the `ContactDetailRight` content (4 sections:
  Associations / Events / Financials / Files). Sections stack as
  cards in the single column.
- **About** — `ContactDetailLeft` with `panes=["info","about"]`. The
  card preserves desktop styling (email + phone + the full About
  block); identity (avatar + name) and the action row pane are
  skipped because the page header + the standalone action row above
  the tabs already cover them.

**What's NOT in the mobile tab strip:**

- **To-Do's** — omitted in V1 per docs/pathway-build-roadmap.md.
  When Push 7 ships contact-scoped tasks, placement gets a focused
  design pass.
- **Right-sidebar gear menus** — the per-section gear / drag-handle
  affordances render visually but are no-ops on mobile (same as
  desktop V1).

**Pane gating contract:** the `panes` prop on `ContactDetailLeft`
takes a subset of `"identity" | "actions" | "info" | "about"` (each
of the four bordered blocks inside the unified card). Default is
all four (desktop). The mobile About tab passes `["info", "about"]`.
A new mobile sub-surface can pass any other subset without
disturbing the desktop layout — the dividers stay correct because
the first rendered pane never gets a top border and subsequent
panes always do.

---

## 6. Phone format standard

**Display:** `(555) 739-9897` everywhere — desktop, mobile, list,
detail, modals, cards, AI summary text. Always via
`formatPhoneDisplay` from `@/lib/format/phone`.

**Storage:** raw 10 digits (`5551234567`). No formatting in DB.

**Edit:** any variant the user types — parens, dashes, dots, spaces,
raw digits, leading "+1". `parsePhoneInput` normalizes to canonical
on save.

**Validation:** reject non-10-digit input inline (the user stays in
edit mode to fix).

Cross-cutting audit invariant: every `primaryPhone` or
`secondaryPhone` render must route through `formatPhoneDisplay`.
Raw renders are a bug.

---

## 7. Contacts list status (LOCKED)

- Saved views render as **top tabs** (the wireframe's left-sidebar
  layout is REJECTED for contacts).
- Search-all-columns + bi-directional sort shipped in commit
  `841a709`.
- Do NOT refactor the contacts list without explicit authorization.

---

## 7. Center column tabs (polish #5 Fix 7a)

The contact-detail center column has **three** top-level tabs:

```
        Overview  Activities  Tasks
        ──────    ─────────   ─────
```

- Tabs are **center-aligned** (HubSpot pattern).
- Underline-on-active styling.
- **Tasks is a top-level tab** (override of the earlier "Tasks lives
  under the Activities sub-filter" decision — Mike, 2026-06-16). The
  Contact Tasks build fills it; it is NOT an Activities sub-filter.
  The communications types (Notes / Calls / Emails / Meetings / SMS)
  remain sub-filters under Activities.
- The legacy "To-Do's" tab is removed.

### Activities sub-filter strip (polish #5 Fix 7b)

Inside the Activities tab, a 6-tab HubSpot underline strip filters
the feed (the communications types only — Tasks is now its own
top-level tab). Counts render inline.

```
All activities (N)  Notes (N)  Calls (N)  Emails (N)  Meetings (N)  SMS (N)
```

Active tab = underline + primary color. Inactive = muted text.

Mobile (`<lg`) renders the same 6-tab strip with `overflow-x-auto`

- `whitespace-nowrap` so it scrolls horizontally on narrow viewports.

---

## 7b. AI content blocks (polish #5 Fix 4c)

`AiSummaryCard` and `AiInsightsCard` no longer render as outer
bordered cards. They flow inline in the center column — heading +
body + footer with modest padding, no border, no background. Per
the box rule (§2.5) AI-generated content is read as part of the
page.

Per-insight wrappers INSIDE `AiInsightsCard` keep their bordered
cards (each insight is a discrete actionable item).

---

## 9. Activity logging modals

Every Log X / Add Note modal renders the shared HubSpot chrome
provided by `components/ui/activity-modal-chrome.tsx`.

**Chrome controls** (left to right, header row):

- **Collapse chevron** — minimizes to a floating pill at the
  bottom-right of the viewport. Body hidden; clicking restores. Lets
  the user navigate elsewhere without losing draft state. (HubSpot
  pattern: long notes coexist with other work.)
- **Title**.
- **Drag grip** — visual affordance only in V1. Full drag-to-move
  ships in V1.5 polish.
- **Expand / Restore** — toggles a wider variant
  (`w-[min(960px,95vw)]` vs default `w-[min(560px,95vw)]`).
- **Close X** — `onClose`. The host owns the unsaved-changes confirm
  via the `onBeforeClose` prop.

**Standard body sections** (in order, omit per-modal where not
applicable):

1. **For: [Contact pill]** — non-navigable chip (polish #5 Fix 5a).
   Activity modals live on the contact's own detail page, so
   navigation would close the modal mid-edit. The pill renders as a
   styled span, not a link.
2. **Body** — modal-specific fields.
3. **Formatting toolbar** (Note only) — Bold / Italic / Underline /
   Strike / Attach / Sparkle. Display-only in V1 (rich-text pipeline
   ships in a later polish push). Per the "Everything intentional"
   rule (§2) the toolbar renders visually complete.
4. **`AssociationsSection`** — "Associated with N record(s)"
   expandable. Polish #5 Fix 5b ships the multi-record UI now: an
   "+ Add association" button opens `AssociationsPicker`, the new
   HubSpot-pattern picker (left rail Selected / Contacts / Companies
   / Events + search + checkbox list + Done button). Persistence
   stays single-contact in V1 because `contact_notes` + `call_log`
   schemas don't have `*_associations` join tables — selections
   beyond the primary contact surface a warning footer. When the
   join tables land in Push 3.5+ persistence flips on without UI
   rework.
5. **`FollowUpTaskAffordance`** — disabled checkbox + date dropdown.
   Tasks are project-scoped today; contact-only tasks ship with
   Push 7.
6. **Create button** in the footer.

**Modal shapes that ship now**:

| Modal       | Backend                                 | V1 status                               |
| ----------- | --------------------------------------- | --------------------------------------- |
| Note        | `createContactNote`                     | Functional                              |
| Log Call    | `logCall`                               | Functional (outcome prepended to notes) |
| Log Email   | (none)                                  | Chrome-only placeholder, ships P5+      |
| Log Meeting | (meetings table exists, no action)      | Chrome-only placeholder, ships P6       |
| Log SMS     | (sms_messages table exists, no action)  | Chrome-only placeholder, ships P5+      |
| Upload File | (`files` table exists, no contact join) | Chrome-only placeholder, ships P11      |

The chrome design landing now means when the underlying modules
ship, the modal bodies wire up without any visual rework.

---

## 10. Merge UI (Push 3 C7)

Dedicated full-page route at `/contacts/[id]/merge?with=[otherId]`
for manual pairwise merges. Replaces the conflict-only B2 modal as
the primary merge surface for user-initiated merges. The
auto-detection scan at `/contacts/duplicates` continues to use the
existing B2 modal for 3+ duplicate groups; pairwise auto-detected
groups can route to this surface too.

### Entry points (V1)

1. Contact detail page Actions dropdown → **"Merge with…"** opens
   `MergeWithPicker` (modal). User picks the other contact from a
   `SearchableSelect`. On Continue → router pushes to the merge
   route.
2. Contacts list selection banner → when **exactly 2** contacts are
   selected, a **Merge** button appears next to Bulk edit. Click
   navigates to `/contacts/<first>/merge?with=<second>`. 3+
   selected = no Merge button (multi-way merge is V1.5).
3. Pre-write dedup hard block modal (`DedupBlockModal`) → when
   firing from an UPDATE (currentContactId present), a **"Merge
   with existing"** button surfaces alongside "Go to existing
   contact". Routes the user to merge the contact they were
   editing with the matched contact. CREATE-mode dedup hides the
   button (there's no contact yet to merge).

### Layout

- **Header**: back link + page title "Merge contacts" + the
  primary action button ("Merge X → Y") in the top-right.
- **Body**: a single unified bordered card with `divide-y` between
  rows (per §2 box rule). 3-column grid on lg+:
  `[label 200px] [column A] [column B]`. Mobile (<lg) stacks rows
  vertically.
- **Column headers**: A's name + email subtitle, B's name + email
  subtitle. Each carries a **"Set as primary"** button (or a
  "Primary" badge when active). Switching primary clears local
  picks + overrides so defaults recompute from the new winner.
- **Field rows**: every intrinsic + custom field renders side by
  side regardless of conflict (per memory #23 "TRUE side-by-side
  full-record view, not conflict-only"). Default winner = primary,
  auto-rescue to non-empty when primary is empty.
- **Special rows**: Tags use a 3-mode radio (A / B / Merged union)
  - a `SearchableMultiSelect` inline override; Mailing address is a
    whole-blob pick V1; custom fields are per-key picks.

### Interaction model (hybrid pick + edit)

The **winning side** of each row renders the appropriate inline-edit
primitive (`InlineEditField` / `InlineEditSelect` /
`SearchableMultiSelect`). The non-winning side renders as a plain
underlined click-to-select button.

Three interactions per row:

1. Click non-winning → swap winner; the new winning side's value
   loads into the inline-edit primitive.
2. Click/focus winning → enter inline edit mode. Autosave on blur
   or Enter to local draft state (NOT a server action). Esc reverts
   to that side's original value.
3. Custom-edited values render an **"edited" pill** (amber, with a
   pencil icon) so the user sees they've overridden both A and B.

### Server contract

The UI batches all picks + overrides into one `mergeContacts`
action call (the Push 4 B2 engine, extended in C7):

```ts
mergeContacts({
  winnerId,
  loserIds: [otherId],
  fieldChoices: Record<fieldKey, recordId>, // per-field "pick A or B"
  customOverrides: Record<fieldKey, unknown>, // per-field typed value (wins over picks)
  tagsMode: { mode: "union" | "use", fromId? },
  companiesMode: { mode: "union" | "use", fromId? },
})
```

The engine atomically:

1. Locks both rows (`SELECT … FOR UPDATE`).
2. Computes merged values from `fieldChoices` + `customOverrides`.
3. Audits FIRST.
4. Soft-deletes the loser (frees up unique constraints on email /
   phone).
5. Updates the winner.
6. Repoints FKs on contact_notes, call_log, **meetings, sms_messages**
   (added in C7), opportunities, project_contacts,
   payment_installments, contact_company_associations.
7. Busts the winner's AI cache via `invalidateContactAiCache` so
   the next page render auto-regens with the merged record's facts
   (polish #5 Fix 8 hook).

### Tests

- `tests/integration/c7-merge-pairwise.test.ts` — customOverrides
  beat fieldChoices for intrinsic fields, tags whole-blob,
  mailingAddress whole-blob, meetings + sms relinked, AI cache
  busted, notes + calls regression.
- Existing `tests/integration/duplicates-merge.test.ts` (B2 engine)
  continues to pass — `customOverrides` is optional.

---

## 8. Captured upcoming scope

Recorded design decisions that aren't built yet. Each item lists
its target slot or trigger.

- **Dashboard rebuild to wireframe Screen 01** — 4 KPIs + Needs
  Attention + Today. Remove the "+ Quick Add" button (was in
  earlier wireframes; locked OUT of V1).
- **Notifications center** → P11 with Finance. Filterable +
  searchable by category (leads / payments / guide-downloads /
  mentions etc.). Predictive text. Lets users view all "new leads"
  notifications grouped — fixes HoneyBook's lumped-feed problem.
- **Help center** → future push. Wires the header help icon's
  dropdown.
- **Global AI assistant** → future push. The header search bar AND
  the dashboard's AI panel both wire to the same backend.
- **Lead form (public-facing capture form)** → after P5 (Pipeline)
  - P6 (Events) + P9 (Companies) ship. Captures name / email / phone
    / project date / venue / event type / planner / vision / referral
    source. Auto-sends text + email on submit. Feeds the AI summary
    generator's richest signals.
- **Add Fields action bar** (HubSpot pattern) → replaces the
  contact-detail Actions dropdown's "View all properties" placeholder
  modal. Modal lists every available contact field (intrinsic +
  custom from the `custom_fields` engine) grouped by category, with
  predictive search. Includes a "Hide blank properties" toggle and a
  per-field "show on card" toggle. Persists the visible-field set
  per user. The placeholder modal that ships now is the entry-point
  for this feature.
- **Multi-record associations on activities** → Push 3.5+. Schema +
  UI to associate a single note / call / email / meeting / SMS with
  multiple contacts, companies, and events. V1 ships with the
  single-contact display because `contact_notes` + `call_log` don't
  have a `*_associations` join table yet. The `AssociationsSection`
  surface that ships now is the entry-point.
- **Files attach to contact** → Push 11 (with the Files surface).
  The `files` table exists today but has no `file_contact_links`
  join. The blob upload pipeline (`/api/blob/upload`) is reused
  once the join lands. The Upload file placeholder modal in the
  action row's More dropdown is the entry-point.
- **Follow-up task creation from activity modals** → ships when
  Push 7 lands contact-scoped tasks. Today `tasks` is project-scoped
  (`project_id NOT NULL`), so the `FollowUpTaskAffordance` ships
  disabled with the ship-target tooltip. When P7 lands the check-
  box + date dropdown wire up without UI rework.
- **Rich-text formatting in Note modal** → ships in V1.5 polish.
  The toolbar buttons (Bold / Italic / Underline / Strike / Attach /
  Sparkle) render visually complete now per the "Everything
  intentional" rule; the contenteditable pipeline lands later.
- **3+ contact merge (multi-way)** → V1.5. The C7 engine accepts up
  to 10 loserIds already (B2 inheritance), but the side-by-side UI
  ships pairwise only in V1. List bulk action's Merge button hides
  when more than 2 contacts are selected. Auto-detection scan at
  `/contacts/duplicates` still routes 3+ groups through the existing
  B2 modal until multi-way ships.
- **Per-subfield address pick in merge UI** → V1.5. C7 ships
  mailingAddress as a whole-blob pick; future polish lets the user
  pick street / city / state / zip independently (matching the
  contact detail About card's 3-line stacked pattern).
- **Live merged-record preview column in merge UI** → V1.5. A 3rd
  column showing the computed final record as the user picks /
  edits. Today the user has to mentally compose the result; the
  preview makes it explicit before the Merge button fires.
