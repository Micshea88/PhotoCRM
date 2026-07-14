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

## Design system standard (LOCKED — HOW editorial-ink is tokenized, componentized, enforced)

This section is the **enforced law** for how the look below is built. The **Visual language**
section governs _what_ editorial-ink looks like (colors, register, feel); **this** section governs
_how_ it is expressed: the token scales, the shared primitives every surface composes, the
designed micro-states no screen skips, and the guards that keep it from drifting. The bar is not
"clean" (absence of mess) — it is **considered**: every element has a decision behind it, and the
same decision repeats everywhere.

Healthy foundation this standard builds on (do not regress): color is fully tokenized + guarded,
spacing is 8px-clean, and the shadcn primitive layer is 100% tuned to editorial-ink. This is a
naming + adoption + missing-families + micro-states + enforcement standard, **not** a rebuild.

### Token scales — the single source for every dimension

- **Spacing — 8px grid, 4px sub-grid.** Use Tailwind's default spacing scale (`0.25rem` step) as
  the grid: `1`/`1.5`/`2`/`3`/`4`/`6`/`8`… No `@theme` spacing tokens are needed for the grid
  itself. **Named exceptions** (defined as tokens): the named spacing tokens below (commit + masthead).
  **No arbitrary padding/gap/margin** (`p-[18px]`, `gap-[13px]`) — enforced. Internal spacing ≤ the
  external spacing of the container that holds it (nesting reads inward-tighter).
- **Type — semantic names over raw sizes.** The px/rem values are unchanged; these are aliases so
  code reads by role, not by number:

  | Name         | Size    | Token / utility                      | Use                                                         |
  | ------------ | ------- | ------------------------------------ | ----------------------------------------------------------- |
  | `micro`      | 9–11px  | `text-4xs` / `text-3xs` / `text-2xs` | field/column/section micro-labels (uppercase tracking-wide) |
  | `caption`    | 12px    | `text-xs`                            | secondary/meta text, chip labels                            |
  | `body`       | 14px    | `text-sm`                            | default UI/body text                                        |
  | `body-lg`    | 16px    | `text-base`                          | emphasized body                                             |
  | `heading-sm` | 18–20px | `text-lg` / `text-xl`                | sub-headings, card titles                                   |
  | `heading`    | 24px    | `text-2xl`                           | page/section headings (serif)                               |
  | `display`    | 30px+   | `text-3xl`+                          | display / large KPI figures (serif)                         |

  Line-heights stay on the 4/8px grid; **font sizes are NOT force-rounded to the grid.**

- **Radius — SQUARED chrome (editorial re-tune 1/3, LOCKED — REVERSES the earlier 6/8/10/12 scale).**
  Chrome is **~2px across the board**: `--radius-sm`/`--radius-md`/`--radius-lg`/`--radius-xl` all =
  `0.125rem` (2px) — inputs, buttons, containers, menus/popovers/dropdowns, **and cards/large panels**.
  The Tailwind radius utilities are wired to these tokens, so `rounded-sm/md/lg/xl` all render squared.
  **Pills are the one exception:** `--radius-pill` = `0.1875rem` (**~3px** gentle soft rectangle — not
  full-round, not hard-2px). Dots + name-avatars stay `rounded-full`. _(This intentionally supersedes
  the STEP-3 6/8/10/12 approval — the editorial look is squared, not soft.)_
- **Color corrections** (see Visual language for the full palette):
  - Ground moved from warm cream to a **cool near-white** `--color-background` `#fafaf9`
    (`oklch(0.9848 0.0013 106.4)`); cards are pure white `#ffffff`. `--color-muted` / `--color-accent`
    / `--color-secondary` are the cool neutral `#f0f0ef` — a quiet **neutral** muted surface. Note the
    cream-hover model is superseded by the two-green rule (see Visual language → Interaction / two-green).
  - `--color-input` **split from `--color-border`** — `#dededc` cool field edge vs the `#e6e6e4`
    divider hairline — so a field edge reads as a container.
- **Motion tokens.** `--motion-duration` (functional standard **150ms**, up to 200ms for larger
  surfaces) · `--motion-ease` (`ease-out`). Every transition uses `motion-safe:` and honors
  `prefers-reduced-motion`. Replaces bare `transition` / browser-default timing.
- **Named spacing tokens.** Where the grid needs a named step, it is a token — never a magic number.
  `--space-commit-gap` (last content block → commit-button container) + `--space-commit-bottom` (button
  container → page bottom), owned by `<CommitBar>`; `--space-masthead-inset` (masthead date → right edge)
  - `--space-masthead-gap` (masthead header zone → KPI cards). **Section-level gaps get a distinct LARGER
    step** (e.g. header block → cards) so zones read as separate — if the scale lacks the step, add a named
    token, never an arbitrary px.

### Shared primitives — build once, compose everywhere

A hand-rolled instance of any of these, where the primitive exists, is a lint error (or a
documented reviewed exception).

- **`<PageContainer>` / `<PageHeader>` / `<PageSection>`** — the layout spine (see the PageContainer
  contract below). Single owner of width + gutters (LAW 6).
- **`<Card>`** — THE container: `rounded-xl` (which now resolves to the **squared ~2px** token) +
  hairline `border/60` + `bg-card`, **no shadow**, `p-6`. Elevation from border + whitespace. All
  card-shaped surfaces compose this (no hand-rolled `border + rounded-md/lg + p-*`).
- **`<Badge>`** — THE pill: one padding, one font (`micro`/`caption`), **`rounded-[var(--radius-pill)]`
  (~3px soft rectangle)**, **MUTED-TINT** — a pale desaturated tint of the category hue as the
  background + the full category hue as the **text** (NOT solid fill, NOT white text). Variants
  `category` (muted-tint) / `state` (state token @15% + saturated state fg — e.g. DNC rust) /
  `neutral` (muted). All type/status badges, filter chips, and sort chips compose this, so every pill
  updates in one place. Full-strength category color lives on the name avatar, not the pill.
- **`<Skeleton>`** — content-shaped placeholder, subtle shimmer, editorial-ink. Used wherever a view
  loads async (not spinners; spinners are for in-button busy states only).
- **`<EmptyState>`** — quiet icon + considered title + supporting line + a **real CTA button** where
  an action makes sense (never a bare "No data" line or a text-only hint).
- **`<CommitBar>`** — the one bottom-commit container, using the commit-spacing tokens. Reused by
  merge + the sticky save bar.
- **Control primitives** — headless, token-styled `select` / `checkbox` / `radio` / `switch` /
  `textarea`. Native controls leak OS defaults (e.g. the OS-blue date-range highlight); selection +
  focus must use **green/ink tokens, never OS blue**, via the split control tokens.

### Density (named)

- **comfortable** — default for client-facing-minimal surfaces and forms (`p-6`, roomy rhythm).
- **compact** — internal-dense surfaces (lists, tables, board cards): tighter row height + `p-3`/
  `p-4`, still on the grid. Density is a named choice per surface (LAW 1 persona), not ad hoc.

### Designed micro-states — REQUIRED on every interactive surface

Generic SaaS skips these; Pathway does not. Every new surface is checked against this list the same
way it's checked against the RLS rules:

1. **Focus** — ONE canonical ring: green `--color-ring` (`#6e8f73`), single width, `focus-visible` (not `focus`),
   never bare `outline-none` with no replacement. Applied to every interactive element.
2. **Hover** — consolidated onto the **light-green wash** (the two-green rule below; the ONE hover
   color app-wide, shared token with the unread-notification tint) for surfaces / menu rows / triggers
   · `hover:text-foreground` (muted controls) · `hover:underline` (links only). No `hover:opacity-*` /
   `hover:brightness-*` one-offs, and no grey/cream hovers. **Exception: the nav** (inverted-pill
   white hover — see Nav below).
3. **Loading** — content-shaped `<Skeleton>` (matching the view's layout) wherever a view would
   otherwise render nothing; `loading.tsx` for server-rendered routes. Spinners only inside busy
   buttons.
4. **Empty** — `<EmptyState>` with icon + CTA button; considered copy, never a bare one-liner.
5. **Motion** — the motion tokens (150–200ms `ease-out`, `motion-safe:`), never browser-default
   timing.

### Interaction states (LOCKED — the TWO-GREEN rule, one token per state, identical on every control)

Interaction states are a defined, ordered set; **each state = ONE token = applied IDENTICALLY across
every control** (native + headless). This is the Carbon/IBM + Material 3 model. It exists because the
same state used to render differently per control (date-picker highlight blue, "Assigned to" dropdown
hover tan, "selected" was five different things).

**THE TWO-GREEN RULE (app-wide, every control EXCEPT the nav).** Exactly two greens do two jobs
everywhere except the nav:

- **HOVER** (any control / menu row / trigger) = **LIGHT green wash `~#eef2ee`** — the ONE hover color
  app-wide. It is the **same token value as the unread-notification tint** (`--color-wash-green`, so the
  hover wash and the unread status tint **cannot drift**). This **retires ALL grey/cream hovers.**
- **SELECTED** (any control / menu row) = **DARK green `#354d3c`** (`--color-brand-accent`) + a check
  where the control shows one.
- **SELECTED and HOVERED at once** = the dark-green selected row **stays dark-green-dominant and fully
  readable**, picking up only a subtle hover cue. NEVER grey, never white-on-grey, never unreadable.

Applies to every headless control / menu row: `SingleSelectMenu`, `SearchableSelect`, Radix menu items,
the date-range menu, the assigned-to list, and filter/sort option rows. The **nav is the one exception**
(inverted-pill WHITE hover/active — see Nav). _(Migration note: `--state-hover` currently still resolves
to the cool neutral `--color-accent`; retrofitting every grey/cream hover onto `--color-wash-green` is
the in-progress interaction-state pass. Ghost triggers + unread rows already use the green wash.)_

**Two axes that combine.** "Selected/checked" and "interactive state" (hover/active/focus) are
SEPARATE axes — an option can be selected AND hovered and shows BOTH. Hover ≠ selected (they differ on
purpose), but hover is identical across all controls, selected is identical across all controls, etc.

| State                  | Token / convention                                                                                                                            | Treatment                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hover**              | **light-green wash `~#eef2ee`** (`--color-wash-green`, the SAME token as the unread tint) — the ONE hover app-wide                            | quiet light-green fill — the quietest emphasis. Retire ALL grey/cream hovers + `/40`, `/50`, `brightness-95` on fill controls. Solid buttons (colored bg) hover via `brightness-95` since a wash can't apply over them. Muted text controls / links use `hover:text-foreground` / `hover:underline`. **Nav is the exception (white).**                                                                                           |
| **Selected / checked** | `--state-selected` (= `--color-brand-accent`, **dark green `#354d3c`**) + `--state-selected-foreground` + a Check where the control shows one | stronger **dark-green** fill + light text/check. This is what native controls already get via `accent-color` — **headless controls MUST match it** (no more cream-fill / ink-border / check-only selected). A control whose selected shape is a border (tabs) keeps the border but colors it `--state-selected`. **Selected + hovered → stays dark-green-dominant + readable** (only a subtle hover cue), never grey/unreadable. |
| **Active (pressed)**   | `--state-active` (fill controls) / `active:brightness-95` (solid buttons)                                                                     | momentary, one notch stronger than hover.                                                                                                                                                                                                                                                                                                                                                                                        |
| **Focus**              | `--color-ring`, **one width (`ring-1`)**, via `focus-visible` (never `focus:`, never bare `outline-none`)                                     | a ring/border, **never a fill**. On every interactive control — including the ones that had none (tabs, listbox options, pill remove buttons).                                                                                                                                                                                                                                                                                   |
| **Disabled**           | `disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none` (Radix: `data-[disabled]:`)                                    | one opacity (retire the 40/60/70 grab-bag), not-allowed cursor, no hover/focus.                                                                                                                                                                                                                                                                                                                                                  |

Native controls (checkbox/radio/range/date/`<select>`) get **selected** consistency for free via
`accent-color: var(--color-brand-accent)` — the SAME token as `--state-selected`, so native and
headless selected are identical by construction. Their open-list hover + focus stay OS-drawn (not
CSS-reachable); per the standing decision, no native control is replaced to chase that.

### Delight-readiness (reserved API — content comes later)

The structure ships delight-ready so the later Voice & Delight pass is pure fill-in, no rework:

- **`<EmptyState>` `icon` slot accepts ANY `ReactNode`** — a lucide icon today, or an illustration /
  animated component later. No hardcoded copy: `title`/`description`/`action` are always props.
- **Signature motion has its own reserved slot**, DISTINCT from functional motion:
  `--motion-delight-duration` / `--motion-delight-ease` (gentle overshoot) + the `delight-*` class
  prefix convention. Functional UI motion stays on `--motion-duration`/`--motion-ease`. Unused until
  the delight pass, but reserved so signature animation never gets tangled with functional transitions.

### Enforcement (extends the palette guard)

`pnpm verify` tier-1 (pre-commit + pre-push) runs two static guards:

**`check-no-raw-palette.mjs`** (LIVE) — bans raw Tailwind palette classes across the **FULL** palette
(all 22 hues incl. `violet`/`purple`/`fuchsia`/`pink` — the gap that let `bg-violet-500` slip) + bracket
micro-fonts (`text-[Npx]`). Use `var(--color-*)` + `text-2xs/3xs/4xs`.

**`check-design-tokens.mjs`** (LIVE) — bans off-scale token bypasses, each proven to fail on a planted
violation:

- **Arbitrary spacing** (`p-[18px]`/`m-[..]`/`gap-[..]` px/rem literals) — use the 8px scale.
  Dimensional `w-[..]`/`h-[..]`/`min-w-[..]` brackets ARE allowed (sizing, not rhythm).
- **Arbitrary radius** (`rounded-[6px]` literal) — use `rounded-sm/md/lg/xl` or a token
  (`rounded-[var(--radius-pill)]`); a `var()` reference is allowed, a px/rem literal is not.
- **Non-canonical focus ring** (`focus:ring-2` / `focus-visible:ring-[2-9]`) — the one ring is
  `focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]` (`ring-0` to suppress a nested ring is OK).
- **Off-scale disabled opacity** (`disabled:opacity-40/60/70`) — the one treatment is
  `disabled:opacity-50` + `not-allowed` + `pointer-events-none`.

**Not yet automated (review-checklist rules):** the _hover = light-green wash_ + _selected = dark green_ +
_primitive-adoption_ (hand-rolled card/badge where a primitive exists) rules are enforced in review, not
by a guard — a reliable regex for "hand-rolled card" has too many false positives. The ~22 remaining
inline pills adopt `<Badge>` in the ongoing pill-migration.

An un-enforced standard drifts back; the scale + palette + focus + disabled bans are now locked.

---

## Visual language (LOCKED — editorial-ink)

Pathway's look is **cool editorial × premium restraint**: the calm, high-contrast feel of a
fashion/wedding magazine (Vogue / The Row / Chanel editorial register) applied to a dense CRM
work surface. Two disciplines held together — a cool near-white / near-black serif identity with
one Pathway-green accent, and Mercury/Stripe restraint (hairlines and whitespace do the work that
boxes and shadows do in generic UI). Every new surface conforms to this; when in doubt, subtract.

### Chrome / foundation (LOCKED — editorial re-tune identity)

The entire brand system is a cool near-neutral ground + near-black ink + ONE green accent. Luxury reads
from how FEW colors are used, not how many.

- **Ground** — cool near-white `--color-background` `#fafaf9` (cooler than the old cream); cards are pure
  white `#ffffff`.
- **Ink** — near-black `#141414` (`--color-foreground` / `--color-primary`; the earlier espresso is cooled
  to near-black). Primary buttons + body text are this ink.
- **Corners** — SQUARED ~2px on all chrome (reverses the earlier 6/8/10/12 scale). **Pills are the
  exception** (~3px `--radius-pill`); dots + avatars stay `rounded-full`.
- **Type** — Bodoni Moda serif for display headings (high-contrast, tight tracking); uppercase tracked
  micro-labels for field/column/section labels.
- **Sidebar/nav** — deepest-ink `--color-sidebar` `#14110c`, stays.
- Neutral supporting tones: `--color-muted-foreground` `#6f6f6d` (cool grey text) · `--color-border`
  `#e6e6e4` (cool hairline).

### Accent green — value + reach (restraint is the point)

- **The accent is Pathway green `#354d3c`** (`--color-brand-accent`, FINAL — holds white text at AA; the
  pill tints and the green wash derive from it). It is the ONE signature accent.
- **Color = signal only.** Green appears ONLY on: the contact **COUNT** ("N CONTACTS"), the **Client**-
  category pills, and the **Client name-avatar**.
- Green does **NOT** appear on: the sidebar active-marker (neutral translucent-white — see Nav), column
  headers, or table lines. **The count is the single green chrome moment** — greening more erodes the
  rarity. _(The light-green hover wash + unread tint are a separate, quietest use of the accent — a wash,
  not a chrome accent — governed by the two-green rule.)_

### Category tier — the derived-jewel pill family (LOCKED)

A CRM must encode category at a glance, so a second tier exists ONLY for taxonomy/status. Five hues
derived from the accent at matched depth/muted-saturation so they read as ONE curated family. Rules:

- Appears ONLY on badges (pill TEXT), dots, status text, and name avatars (avatar FILL). NEVER on a
  surface, card, button, or chrome.
- **Full-strength hue = the pill TEXT color + the name-avatar FILL.** The pill BACKGROUND is a pale
  desaturated **tint** of the same hue (muted-tint pill — see `<Badge>`). The avatar color = the
  contact's **TYPE**, so a row's avatar and its Type pill **share a hue**.
- **Hues** (text / avatar; tint bg is a pale version of each): Client `#354d3c` · Vendor `#7a4a2e` ·
  Lead `#3a5266` · VIP `#7a3a55` · Past-client `#5a5550`.
- **DNC** = rust from the `--color-destructive` `#a8543a` family — a distinct ALERT (state variant),
  and **must read distinct from BOTH graphite (Past) AND terracotta (Vendor)**.
- State reuses the band: destructive rust `#a8543a` · warning clay-gold · success sage · info dusty-blue.

### Color = signal only (the governing rule)

Color fires only for meaning. Surfaces stay neutral (cool near-white / ink) and are NEVER tinted with a
brand or category hue. The accent's reach is deliberately tiny (see Accent green — count + Client pills +
Client avatar only). The one place green touches a background is the **light-green hover wash** and the
**unread tint** (the two-green rule) — a quiet wash, not a chrome accent. Decorative color is not allowed
— if a color isn't encoding an action, a category/state, or an interaction state, it's neutral.

### Column headers + row dividers (distinction by CONTRAST, not color)

Lists/tables separate header from body by **contrast**, never by color:

- **Column headers** = near-black ink `#141414` + heavier weight + a heavier header rule. (Distinct from
  muted field/section micro-labels — the header row is DARK and prominent.)
- **Row dividers** = barely-there warm-grey `~#efedea`, recede.
- Principle: header labels + line **dark/distinct**, body rows **muted/light**. No green on headers or lines.

### Nav — the ONE white exception to the two-green rule (LOCKED)

The deepest-ink sidebar is the single place hover/active is WHITE instead of the two greens:

- All tab labels **white**; inactive dimmed to `~66–68%` so the active tab stays legible.
- **HOVER = inverted-pill**: label fills near-white `#fafaf9`, text flips to ink `#141414` (~160ms ease).
- **ACTIVE = persistent solid white fill + ink text** (boldest wayfinding). The active marker is
  neutral translucent-white — **never green**.
- Applies to **top-level tabs AND the collapsible Settings group + its children** (Account settings,
  Custom fields, Integrations, Preferences) — the whole nav is one system; no item on the old grey.
  (The one sub-case left on light-menu styling is the collapsed-rail fly-out panel, which renders on a
  white popover surface where a near-white pill would be invisible.)

### Ghost dropdown triggers (standard for ALL secondary triggers)

- Secondary dropdown / filter / sort / option triggers: **label + caret (▾), transparent bg, NO resting
  box/border.**
- **HOVER = the light-green wash.** \*\*OPEN/ACTIVE = light-green wash + label goes dark green `#354d3c`
  - caret flips.\*\*
- Borderless can read as inactive — so the hover + open states must be clearly visible, never plain dead
  text.
- **PRIMARY actions (Create new, Save, destructive confirms) KEEP a real button.** Ghost = secondary only.

### Unread notification tint (semantic status, shares the hover-green token)

- **UNREAD row** = light-green wash `~#eef2ee` (**the same `--color-wash-green` token as hover**) + the
  unread dot in dark green `#354d3c` + a green icon.
- **READ row** = white bg, dimmed ink, greyed icon — recedes.
- The tint **is** the unread signal; the panel reads new-vs-seen at a glance. (Distinct semantic ROLE
  from the hover wash even though it shares the token value — status vs. mouseover — so they can't drift.)

### Masthead date (dashboard header, top-right)

Stacked editorial block, top-right of the dashboard greeting:

- **DAY** ("Monday") large in Bodoni Moda, mirroring the greeting's serif.
- **Full DATE** ("July 13, 2026") beneath as a **dark-green `#354d3c` uppercase tracked micro-label**.
- **LIVE** date (computed client-side), not hardcoded. **Inset from the right edge** with breathing room
  (`--space-masthead-inset`), matching the greeting's left inset.

### Type

- Display/headings + large KPI figures: Bodoni Moda (serif) — high-contrast, editorial; it should
  print like a magazine page against the cool near-white ground.
- Body / UI / labels: Open Sans (sans).
- All data figures (currency, dates, counts, phones, timestamps): tabular-nums so columns align —
  this is the premium tell in a data tool.
- Micro-labels (field labels, column headers, section headers): text-2xs, uppercase, tracking-wide,
  muted

---

## Token catalog + usage rules (LOCKED — developer reference)

Every color, type step, and radius comes from a token in `app/globals.css` `@theme`.
Components reference the **semantic name only** (`var(--color-*)`, `text-2xs`, `rounded-*`) —
**never a raw Tailwind palette class** (`bg-red-500`, `text-neutral-700`) and **never a bracket
size** (`text-[11px]`). The token layer is the single source of truth; the reskin migrated the
whole product UI onto it (Phases 5–6).

### The four token families

- **Surfaces** (neutral cool near-white / ink — the ONLY colors on chrome/surfaces): `--color-background`
  (`#fafaf9` cool near-white paper) · `--color-foreground` (`#141414` near-black ink) · `--color-card` /
  `--color-popover` (`#ffffff` white) · `--color-muted` / `--color-muted-foreground` (cool grey) ·
  `--color-border` / `--color-input` (cool hairline / field edge) · `--color-sidebar` (deepest ink) /
  `--color-sidebar-foreground`.
- **Brand**: `--color-primary` (ink — buttons/primary actions) / `--color-primary-foreground` ·
  `--color-brand-accent` (**Pathway green `#354d3c`** — accent/emphasis; also the SELECTED state + the
  source the pill tints and green wash derive from) · `--color-ring` (green focus `#6e8f73`) ·
  `--color-accent` / `--color-secondary` (NEUTRAL cool surface). Interaction wash: `--color-wash-green`
  (`~#eef2ee`) → `--state-ghost-hover` (ghost-trigger interaction) + `--color-unread-tint` (unread status).
- **State** (status only): `--color-destructive` · `--color-warning` · `--color-success` ·
  `--color-info` (+ `-foreground`, + `--color-destructive-tint`). Light state surface = the base
  token at `/10`–`/15`; light state border = `/40`.
- **Category** (taxonomy — badges/dots/name-avatars ONLY, NEVER chrome/surfaces): `--color-cat-client`
  · `-lead` · `-vendor` · `-vip` · `-past` (the full hue — pill TEXT + avatar fill), each with a pale
  `-tint` (the pill BACKGROUND).
- **Type**: `--font-sans` (Open Sans) · `--font-serif` (Bodoni Moda) · `--font-mono`; sub-xs steps
  `--text-2xs` (11px) / `--text-3xs` (10px) / `--text-4xs` (9px). **Shape**: squared chrome
  `--radius-sm/md/lg/xl` (all 2px) + `--radius-pill` (3px); dots/avatars `rounded-full`.

### The rules

- **Color = signal only, two tiers.** BRAND tier (cool near-white / near-black ink / Pathway green) is
  the only palette on chrome, surfaces, buttons, nav, primary actions, focus — green's chrome reach is
  tiny (count + Client pills + Client avatar). CATEGORY + state tokens are for badges/dots/avatars/status
  ONLY, never a surface/card/nav/button. The only green on a background is the light-green **hover wash +
  unread tint** (two-green rule). Decorative color is not allowed.
- **Restraint + motion:** cards are **squared ~2px** + hairline border, NO shadow (elevation from border
  - whitespace); lists/tables use `divide-y` hairlines, not per-row boxes; all data figures use
    `tabular-nums`; field/section micro-labels are `text-2xs uppercase tracking-wide` muted (column headers
    are the darker, heavier exception — see Column headers). Motion is functional and restrained — 150ms
    ease-out, `motion-safe:` (respects prefers-reduced-motion), green `focus-visible` ring; it lives in the
    shared Button/Input primitives.
- **EXCEPTIONS (structural, not shortcuts):** `src/emails/**` (React-Email templates) and
  `app/api/share-link/[token]/route.ts` render OUTSIDE `app/globals.css`, so `@theme` tokens don't
  exist there — those keep raw values. Everything else is token-only.

### PageContainer variant contract (LAW 6 — fluid-first, no islands)

Every `app/(app)` page composes `PageContainer` (`src/modules/shared/ui/`), the single owner of
horizontal gutter + max-width; `main` owns vertical rhythm only (one owner per axis, no doubled
gutters). Variants — all fluid, none a pinned/centered island:

- `full` — no max width (default posture; lists, dashboards, contact detail).
- `default` — fluid up to `PAGE_MAX_DEFAULT` (~1100px), centered only past it (settings).
- `narrow` — fluid up to `PAGE_MAX_NARROW` (~720px), single-column forms/text.

Enforcement: `pnpm verify` runs `scripts/check-no-raw-palette.mjs`, which fails the build on any
raw palette class or bracket font size in product UI (emails + share-link excluded).

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

- **Ghost dropdown triggers** — the standard treatment above. **STATUS: STANDARD, applies to new work
  now; retrofit existing secondary triggers over time.**
- **Tag-cell overflow** — in any tags cell, spell out up to **2 tag names as pills**, then **"+N"** for
  overflow; hovering the "+N" reveals the rest. (Better than a bare "+1" that names nothing.) **STATUS:
  decided, build later — apply to every tag cell when built/touched.**
- **Row-level AI actions** — a sparkle icon per list row → an inline pop-out of AI actions runnable in
  place (draft summary/email, suggest services/action items, analyze sentiment, ask about the record).
  A FEATURE tied to Pathway's AI-as-tool **propose→confirm** model (LAW 3) + agent strategy — actions
  follow that model. Borrowed ONLY the AI-icon-per-row + inline-menu idea (and the tag-overflow idea)
  from HoneyBook's projects page; do NOT emulate that page's layout. **STATUS: decided, build later —
  needs its own scoped UI + AI-pipeline wiring.**
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
