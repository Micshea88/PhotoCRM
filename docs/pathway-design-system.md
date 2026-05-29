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

**Explicitly NOT in the header:** theme toggle (relocated to
`/settings/system-settings` in a later push), sparkle icon, far-left
"K&K" text, middle org-switcher dropdown.

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

HubSpot box pattern per section. Each section header row contains
(in order, left to right):

- Drag handle (visual placeholder for reorder — not yet
  interactive)
- Chevron (open / closed)
- Title
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

1. **For: [Contact pill]** — clickable pill linking to the contact.
2. **Body** — modal-specific fields.
3. **Formatting toolbar** (Note only) — Bold / Italic / Underline /
   Strike / Attach / Sparkle. Display-only in V1 (rich-text pipeline
   ships in a later polish push). Per the "Everything intentional"
   rule (§2) the toolbar renders visually complete.
4. **`AssociationsSection`** — "Associated with N record(s)"
   expandable. V1 ships read-only single-contact display because
   `contact_notes` + `call_log` schemas don't have multi-association
   tables. Inline note explains multi-record associations land in
   Push 3.5+.
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
