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

**More dropdown items:**

- **Log past Note** → opens `AddNoteModal` (existing wiring)
- **Log past Call** → opens `LogCallModal` (existing wiring)
- **Log past Email** → placeholder modal "ships P5+"
- **Log past Meeting** → placeholder modal "ships P6"
- **Log past SMS** → placeholder modal "ships P5+"

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
