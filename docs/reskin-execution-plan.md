# Pathway Reskin — Execution Plan

> Save this file to `docs/reskin-execution-plan.md` and execute phase by phase.
> Implements `docs/theme-token-layer-plan.md` under `AGENTS.md` LAW 6 (responsive
> width) and LAW 7 (test the result). This is a reskin of HOW spacing and color are
> expressed — NOT a change to what any page does. All behavior/features/layouts preserved
> (one intentional exception: the contact-detail column-reflow bug fixed in Phase 4b).
> Run top to bottom. One commit per phase (color/type phases: one commit per module).
> Build passes before each commit. Phase 0 lands the tests first; keep them green throughout.

## HARD CONSTRAINTS — violate none

Protected surfaces (behavior + layout preserved exactly; recolor/reshape only): Contacts
list, Contact card/detail, CSV import wizard, notification bell dropdown + rows +
`/notifications` page.

Contact detail (`app/(app)/contacts/[id]/page.tsx`) ships FULL-WIDTH today (old
`mx-auto max-w-7xl` already removed — comment ~line 247). Becomes `PageContainer
variant="full"`. Never reintroduce a width cap. (Its internal 3-column grid is fixed in
Phase 4b — the one documented exception to "preserve byte-for-byte.")

NOTIFICATION SPACING IS LOCKED — recolor + reshape buttons only, never touch geometry.
In `src/modules/notifications/ui/`:

- Dropdown width `w-[448px]` (`notification-dropdown.tsx:138`) — unchanged.
- Row floor `min-h-[88px]` (`notification-row.tsx:363`) — unchanged; reserves ~8px
  clearance between bottom-right action zone and top-right dot. Don't alter row
  `px-3 py-3`, `gap-3`, `items-stretch`.
- Persistent unread dot `absolute top-3 right-3 size-2 rounded-full`
  (`notification-row.tsx:397`) — position/size/shape unchanged; does NOT hide on hover.
  Only color migrates: `bg-blue-500` → `var(--color-cat-lead)`.
- Left category-icon container `size-8 … self-start rounded-full` (`:405`) + 6-category
  `CATEGORY_ICONS` registry (`:46-52`) — unchanged.
- Bottom-right hover action zone `mt-auto hidden … group-hover:flex` (`:473`) with
  action-icon row + read/unread text link below — structure unchanged.
- Portaled Radix Tooltip (`@/components/ui/tooltip`, `RadixPopover.Portal`) — unchanged.
- read/unread flip + optimistic dot-in-lockstep — unchanged.
- Bell unread badge `bg-red-500` (`notification-bell.tsx:62`): geometry
  (`min-w-[16px] -top-0.5 -right-0.5 text-[9px]`) unchanged; color →
  `var(--color-destructive)`; `text-[9px]` → type token (Phase 6).

Do NOT strip the two `<p>` line-measures `max-w-2xl` at
`settings/integrations/page.tsx:71` and `settings/integrations/[categoryId]/page.tsx:77`
— correct paragraph line-length control, not page-width islands.

Stack: Tailwind v4 CSS-first (no `tailwind.config.*`; theme in `app/globals.css`
`@theme`). shadcn "new-york", `cssVariables: true`. Utilities via `cn()`; `cva()` only in
`components/ui/`. Next.js App Router. Never add a `tailwind.config` or hardcode a
color/radius/type value in a component.

## PHASE 0 — Regression guardrails first

Add Playwright specs asserting the observable result (LAW 7):

1. `tests/e2e/notifications-geometry.spec.ts`
   - Open bell dropdown; assert `[data-testid="notification-dropdown"]` computed
     `width === 448px`.
   - Assert each row computed `min-height >= 88px`.
   - Hover a row; assert unread dot still visible AND hover action zone visible
     simultaneously (proves ~8px clearance survives).
   - Hover an action icon; assert its tooltip renders in a portal outside the dropdown's
     scroll container (not clipped).
2. `tests/e2e/contact-detail-width.spec.ts` — at 1440px viewport, assert detail content
   spans effectively full width (content box within ~48px of the main region; no island).
3. `tests/e2e/contact-detail-reflow.spec.ts` — authored WITH Phase 4b as a red→green gate
   (red on today's buggy grid, green once 4b lands). Drives the detail page across
   container widths (nav expanded AND collapsed): asserts the middle column never renders
   below its min-width floor (no sub-floor crush), that at the medium band the right
   sidebar wraps to a full-width row under left+middle (not a third crushed track), and
   that no column overlaps another (right panel never covers the middle's header). NOT a
   pre-Phase-1 gate.

Specs #1 (notification geometry) and #2 (contact-detail-width) must pass before Phase 1
and stay green through Phase 7. Spec #3 lands red here and turns green in Phase 4b.

## PHASE 1 — Token layer (additive; breaks nothing)

### 1a. Fonts — `app/layout.tsx`

    import { Open_Sans, Bodoni_Moda } from "next/font/google"

    const fontSans = Open_Sans({
      subsets: ["latin"], display: "swap", variable: "--font-sans-loaded",
    })
    const fontSerif = Bodoni_Moda({
      subsets: ["latin"], style: ["normal", "italic"], display: "swap",
      variable: "--font-serif-loaded",
    })

Add `${fontSans.variable} ${fontSerif.variable}` to the `<html>` className.
(`ThemeProvider` is removed in Phase 2.)

### 1b. Replace the `@theme` block in `app/globals.css`

Stored as `oklch` (hex in comments). Semantic names are the contract; components
reference these only.

    @theme {
      /* ========== SURFACES — cream family ========== */
      --color-background:            oklch(0.9585 0.0098 87.5); /* #f4f1ea page cream (4c FIX A) */
      --color-foreground:            oklch(0.275 0.014 81.7);  /* #2b2720 warm ink */
      --color-card:                  oklch(0.9934 0.0067 97.3); /* #fefdf8 card white (4c FIX A) */
      --color-card-foreground:       oklch(0.275 0.014 81.7);
      --color-popover:               oklch(0.9934 0.0067 97.3); /* #fefdf8 (4c FIX A) */
      --color-popover-foreground:    oklch(0.275 0.014 81.7);
      --color-muted:                 oklch(0.928 0.017 91.6);  /* #ebe7db deeper cream */
      --color-muted-foreground:      oklch(0.623 0.017 94.3);  /* #8a877c warm grey */
      --color-border:                oklch(0.882 0.017 91.6);  /* #dcd8cc hairline */
      --color-input:                 oklch(0.882 0.017 91.6);
      --color-sidebar:               oklch(0.275 0.014 81.7);  /* #2b2720 dark rail/hero */
      --color-sidebar-foreground:    oklch(0.9585 0.0098 87.5); /* #f4f1ea (4c FIX A) */

      /* ========== BRAND ========== */
      --color-primary:               oklch(0.415 0.032 151.5); /* #3f5143 forest-olive */
      --color-primary-foreground:    oklch(0.993 0 0);
      /* accent = SUBTLE SURFACE (shadcn hover/selected bg) → pale sage.
         Mid-sage identity lives in --color-ring + --color-brand-accent. */
      --color-accent:                oklch(0.925 0.011 136.6); /* #e3e8e1 pale sage */
      --color-accent-foreground:     oklch(0.275 0.014 81.7);
      --color-brand-accent:          oklch(0.518 0.046 149.1); /* #56705a mid-sage: logo, emphasis */
      --color-secondary:             oklch(0.928 0.017 91.6);  /* #ebe7db */
      --color-secondary-foreground:  oklch(0.275 0.014 81.7);
      --color-ring:                  oklch(0.518 0.046 149.1); /* #56705a sage focus */

      /* ========== STATES ========== */
      --color-destructive:           oklch(0.564 0.124 43.4);  /* #b05a34 rust */
      --color-destructive-foreground:oklch(0.993 0 0);
      --color-warning:               oklch(0.692 0.126 81.6);  /* #c3932f gold */
      --color-warning-foreground:    oklch(0.275 0.014 81.7);
      --color-success:               oklch(0.416 0.036 153.6); /* #3d5243 green */
      --color-success-foreground:    oklch(0.993 0 0);
      --color-info:                  oklch(0.456 0.060 247.7); /* #3b5a77 blue — FIXES undefined bug */
      --color-info-foreground:       oklch(0.993 0 0);

      /* ========== CATEGORY (dots · AI badges · dispositions · calendar) ========== */
      --color-cat-lead:              oklch(0.456 0.060 247.7); /* #3b5a77 blue */
      --color-cat-client:            oklch(0.415 0.032 151.5); /* #3f5143 green */
      --color-cat-referral:          oklch(0.518 0.046 149.1); /* #56705a sage */
      --color-cat-vendor:            oklch(0.711 0.029 226.9); /* #90a6b0 steel */
      --color-cat-payment:           oklch(0.692 0.126 81.6);  /* #c3932f gold */
      --color-cat-scheduling:        oklch(0.594 0.114 46.3);  /* #b56740 clay */
      /* pale tints (badge/pill bg). client + vendor DERIVED at tint lightness (~0.925 L)
         from their hue — no wireframe swatch existed; adjust later if needed. */
      --color-cat-lead-tint:         oklch(0.924 0.019 237.8); /* #dbe8f1 */
      --color-cat-client-tint:       oklch(0.925 0.020 151.5); /* derived */
      --color-cat-referral-tint:     oklch(0.925 0.011 136.6); /* #e3e8e1 */
      --color-cat-vendor-tint:       oklch(0.925 0.015 226.9); /* derived */
      --color-cat-payment-tint:      oklch(0.932 0.040 89.7);  /* #f3e8cb */
      --color-cat-scheduling-tint:   oklch(0.907 0.037 72.6);  /* #f0ddc6 */
      --color-destructive-tint:      oklch(0.898 0.022 42.6);  /* #ebd9d2 */

      /* ========== TYPE ========== */
      --font-sans:  var(--font-sans-loaded), system-ui, sans-serif;
      --font-serif: var(--font-serif-loaded), Georgia, serif;   /* display/headings; italics live here */
      --font-mono:  ui-monospace, SFMono-Regular, Menlo, monospace;

      /* sub-xs micro steps (Tailwind default xs/sm/base/… stay). Replace all bracket px. */
      --text-2xs:   0.6875rem;  --text-2xs--line-height: 1rem;      /* 11px → text-2xs */
      --text-3xs:   0.625rem;   --text-3xs--line-height: 0.875rem;  /* 10px → text-3xs */
      --text-4xs:   0.5625rem;  --text-4xs--line-height: 0.75rem;   /* 9px  → text-4xs */

      /* ========== SHAPE ========== */
      --radius: 0.5rem;  /* 8px — wireframe buttons. Badges/dots/avatars stay rounded-full. */
    }

No `.dark` block. Build + Phase-0 specs #1/#2 pass.
Commit: `feat(theme): cream/olive semantic token layer + fonts + type scale`.

## PHASE 2 — Remove dark mode (single light theme)

- Delete the `.dark { … }` block in `app/globals.css`.
- `app/layout.tsx`: remove `ThemeProvider` import; unwrap children. Delete
  `src/modules/org/ui/theme-provider.tsx`.
- `src/modules/org/ui/app-topbar.tsx`: remove `ThemeToggle` import (~line 6) + its
  render (~line 59). Delete `src/modules/org/ui/theme-toggle.tsx`.
- Remove `next-themes` from `package.json`.
- Strip every `dark:` variant across the ~22 files using them — includes protected
  `contacts-import-wizard.tsx` (18×) and `contact-merge-side-by-side.tsx` (2×), plus
  `contact-activity-feed.tsx`, `ai-status-badge.tsx`, `selection-banner.tsx`,
  `due-state-class.ts`, etc. Keep each pair's light class.
- Doc: `docs/pathway-design-system.md §3` says the theme toggle is "relocated to
  /settings/system-settings in a later push." Change it to record dark mode + toggle are
  REMOVED (single light theme).

Build + Phase-0 specs #1/#2 pass. Commit: `refactor(theme): remove dark mode`.

## PHASE 3 — Layout system (fluid-first; no fixed-width islands)

Create in the repo's shared-UI location (e.g. `src/modules/shared/ui/`):

- `PageContainer` — SINGLE owner of horizontal gutters + max width. Every variant is
  fluid and reflows — none is a pinned/centered island. Horizontal padding `px-6`.
  - `variant="full"` — fluid, NO max width (contact-card model; default posture): `w-full px-6`.
  - `variant="default"` — fluid up to a generous ceiling, centered only past it:
    `w-full px-6 mx-auto max-w-[1100px]`.
  - `variant="narrow"` — fluid up to a tight ~66ch ceiling for single-column forms/text:
    `w-full px-6 mx-auto max-w-[720px]`.
    Keep both ceilings as named constants (one-line adjustable).
- `PageHeader` — title / optional description / optional actions slot. Title uses
  `font-serif`; supports an italic emphasis span for a headline word (the wireframe
  "_Photographer's_" treatment) via `<em>`/`italic` inside the title. Description +
  actions use `font-sans`.
- `PageSection` — grouped block with consistent vertical spacing; optional `font-serif`
  section title.

Gutter ownership (LAW 6, no doubled gutters): in
`src/modules/org/ui/client-layout-shell.tsx:85` change `main` from
`flex-1 overflow-y-auto p-6 pb-20 lg:pb-6` → `flex-1 overflow-y-auto pt-6 pb-20 lg:pb-6`
— main keeps vertical rhythm + bottom-nav clearance but NO horizontal padding.
`PageContainer` owns the horizontal gutter. One owner per axis.

Commit: `feat(layout): PageContainer/PageHeader/PageSection (fluid-first)`.

## PHASE 4 — Migrate pages to variants (preserve protected pages)

Wrap each `app/(app)` page in `PageContainer` with the variant below; remove its
hand-rolled `mx-auto max-w-* / p-6 / space-y-6` outer wrapper (move `space-y-*` onto
`PageSection`s). Verify each at NARROW / MEDIUM / WIDE.

`full` — `contacts`, `contacts/[id]` (protected, stays full), `contacts/[id]/merge`
(protected), `contacts/import` (protected), `notifications` (protected — also delete its
own `px-6`/`p-6`; keep header/body/scroll structure + full-bleed header border), `items`,
`dashboard`, `contacts/archived`, `contacts/deleted`, `contacts/duplicates`,
`companies/duplicates`.

`default` (~1100px) — `settings/custom-fields`, `settings/integrations` (+ `[categoryId]`,
`[categoryId]/[providerId]`), `settings/organization/members`, `settings/lead-sources`,
`admin/scan-diagnostics`, `items/[id]` (dev template; variant irrelevant).

`narrow` (~720px) — `contacts/new`, `contacts/[id]/edit`, `items/new`, `items/[id]/edit`,
`settings/account`, `settings/preferences`, `settings/notifications`,
`settings/organization`, `settings/organization/danger`, `onboarding/create-organization`
(shell-less; PageContainer owns its own gutters; keep vertically centered).

Protected-page rule: for the five protected surfaces the ONLY change is swapping the
outer width wrapper for `PageContainer`; inner structure/spacing/behavior stay otherwise
byte-for-byte — WITH ONE documented exception: contact detail also gets the reflow fix in
Phase 4b (its 3-column grid is the known bug). Everything else about contact detail stays
byte-for-byte. Phase-0 specs #1/#2 stay green. Commit per logical group.

## PHASE 4b — Contact detail column reflow (fixes the known crush bug)

The 3-column grid at `app/(app)/contacts/[id]/page.tsx:420` currently reads
`hidden gap-6 lg:grid lg:min-h-[calc(100vh-14rem)]
lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(280px,360px)]`.
Bug: the middle track floors at `0` while the side tracks floor at 260/280px, and the
grid turns on at `lg` (1024px). With the nav expanded there isn't room for all three, so
the middle collapses to a ~140px sliver (one-word-per-line wrapping) and the right panel
overflows on top of it.

Fix using CONTAINER QUERIES so it responds to the space actually available (nav-expanded
vs collapsed changes the container width, and the grid reflows accordingly — no viewport
guessing). This matches how HubSpot/Salesforce reflow record layouts (drop to fewer
columns, right sidebar collapses first) instead of crushing a column.

- Mark the detail content wrapper as a named container: `@container/detail`.
- 3 columns when the container is wide enough for all three at usable widths
  (`@min-[1160px]/detail`):
  `grid-cols-[minmax(260px,320px)_minmax(420px,1fr)_minmax(280px,360px)]` — note the
  MIDDLE now floors at 420px, never 0.
- 2 columns in the medium band (container 760–1160px):
  `grid-cols-[minmax(260px,320px)_minmax(420px,1fr)]` — left + middle on row 1; the right
  sidebar (Associations/Events/Financials/Files) is the 3rd grid child and naturally wraps
  to row 2 — give it `@max-[1160px]/detail:col-span-2` so it spans full width under the
  middle. Nothing is lost: associations already surface in the Overview tab.
- Below `lg` viewport: the existing `contact-detail-mobile.tsx` tabbed single-column is
  unchanged.
- Add `min-w-0` to any grid/flex child wrapping truncating text so long content wraps
  instead of forcing the overflow that caused the overlap.
- Starting breakpoints (1160 / 760) and the 420px middle floor are sensible defaults —
  verify/tune against real rendered widths at nav-expanded + nav-collapsed × narrow /
  medium / wide. The overlap must be gone at every width.
- Author (or un-skip) `tests/e2e/contact-detail-reflow.spec.ts` (Phase-0 spec #3) as part
  of this phase; it must go from red → green with this fix. This is the gate that proves
  4b landed.

Commit: `fix(contacts): container-query reflow for detail 3-column layout`.

## PHASE 5 — Hardcoded colors → tokens (one commit per module)

Across the ~49 files:

- `red-*` → `destructive` / `destructive`-tint.
- `amber-*` / `yellow-*` → `warning` / `warning`-tint.
- `emerald-*` / `green-*` → `success` / `success`-tint. Includes Task-18 delivery chip
  `contact-activity-feed.tsx:206-214` `DELIVERY_CHIP_CLASSES`: `delivered` (emerald, FLAG
  at `:208`) → `success`; `bounced/failed/complained` (red) → `destructive`; remove FLAG.
- `blue-*` → `info` (and define `--color-info`, used at
  `contact-merge-side-by-side.tsx:909`).
- Dots + badges → category tokens: `notification-row.tsx:397` `bg-blue-500` →
  `bg-[var(--color-cat-lead)]`; other dot colors → their category token;
  `notification-bell.tsx:62` `bg-red-500` → `bg-[var(--color-destructive)]`. AI-status
  badges (`ai-status-badge.tsx`), call dispositions, `due-state-class.ts`, selection
  banner, provider cards, dialer controls, sign-in form → semantic/category tokens.
- `admin/scan-diagnostics/page.tsx` IS an in-app page — migrate its inline
  `style={{ color: "#hex" }}` values to `var(--color-*)` tokens too.

No raw palette class / arbitrary color remains in product UI.
EXCEPTION (structural, not a shortcut): `api/share-link/[token]/route.ts` returns a
standalone PUBLIC HTML string that does NOT load `app/globals.css`, so it cannot reference
`@theme` tokens — they don't exist on that page. Leave its inline hex. If it should look
on-brand, inject the palette hex into that HTML string at build; it will never be
token-driven because it lives outside the app's stylesheet.

## PHASE 6 — Micro-fonts → type-scale tokens

`text-[11px]` → `text-2xs` (41×), `text-[10px]` → `text-3xs` (22×), `text-[9px]` →
`text-4xs` (2×) — including `notification-bell.tsx:62` and `notification-row.tsx:658`.
No `text-[Npx]` remains. Commit: `refactor(type): micro-fonts → scale tokens`.

## PHASE 7 — Governance

- Add a token-catalog section to `docs/pathway-design-system.md`: the four token
  families, the rule "all color/type/radius from tokens — no palette classes, no bracket
  sizes," and the `PageContainer` variant contract (fluid-first; `full` is the default
  posture; `default`/`narrow` are readable ceilings, never islands).
- (Optional) ESLint rule banning raw palette classes
  (`(text|bg|border|ring)-(red|blue|green|emerald|amber|…)-\d`) and arbitrary
  color/`text-[Npx]` values in `src/`/`app/`.

## Acceptance criteria (whole pass)

- Build passes; single light theme; no `.dark`, no `next-themes`, no `dark:` variants.
- Zero raw palette classes and zero `text-[Npx]` in product UI; `--color-info` defined;
  scan-diagnostics tokenized; only the share-link public HTML page keeps inline hex.
- Every `app/(app)` page composes `PageContainer` (correct variant) and hand-rolls no
  width/gutter; the two `<p>` line-measures preserved.
- `main` owns vertical rhythm only; `PageContainer` owns horizontal gutter — no doubled
  gutters; notifications no longer double-pads.
- Contact detail: full-width, and its 3-column grid reflows 3→2→tabbed with the middle
  floored (never crushes); no column overlap at any width, nav expanded or collapsed.
- Phase-0 specs #1/#2 green throughout (dropdown 448px, rows ≥88px, unread dot persists
  through hover alongside the action zone, tooltips portal un-clipped, contact detail
  full-width); spec #3 red until Phase 4b, green after.
- Protected surfaces at narrow/medium/wide: identical structure/spacing, new palette only
  (contact-detail reflow is the one documented exception).

## Handoff notes (executor)

- Local e2e test DB (`pathway_test`) is provisioned by SCHEMA CLONE from `pathway_dev`
  (`pg_dump --schema-only` + a copy of the `drizzle.__drizzle_migrations` journal rows so
  the webServer's `db:migrate` is a no-op), NOT by migration replay and NOT by
  `CREATE DATABASE … TEMPLATE`. Reason: a fresh migration REPLAY currently breaks at
  `0015_assignment_scoped_rls_overlay.sql` ("relation projects does not exist") — earlier
  than the ~0035 drift previously scoped. Fixing that replay is a SEPARATE workstream; do
  not attempt it here.

---

# Remaining reskin work (appended) — order: 4c → 4b → 4d → 5 → 6 → 7

All part of THIS reskin pass. Re-push the preview after 4c and after 4d.

## PHASE 4c — Palette + type + card corrections (do FIRST; foundation Phase 5 stacks on)

- FIX A — surfaces rendered grey (oklch conversion zeroed the warmth). In
  `app/globals.css` @theme (and this plan's @theme block, done above):
  `--color-background: oklch(0.9585 0.0098 87.5)` (#f4f1ea),
  `--color-card / --color-popover: oklch(0.9934 0.0067 97.3)` (#fefdf8),
  `--color-sidebar-foreground: oklch(0.9585 0.0098 87.5)` (#f4f1ea).
- FIX B — nav sidebar was white (wrong token). In `app-sidebar-nav.tsx` recolor ONLY (keep
  labeled-nav structure, no icon-only rail): container → `bg-[var(--color-sidebar)]` +
  `border-[var(--color-sidebar-foreground)]/10`; resting text →
  `text-[var(--color-sidebar-foreground)]/70`; hover →
  `hover:bg-[var(--color-sidebar-foreground)]/10 hover:text-[var(--color-sidebar-foreground)]`;
  active → `bg-[var(--color-sidebar-foreground)]/15 text-[var(--color-sidebar-foreground)]`;
  chevron + section labels same. The collapsed-nav flyout stays a light popover
  (`bg-[var(--color-popover)]`).
- FIX C — serif display font applied nowhere. Add `font-serif` to PAGE-TITLE h1s app-wide
  (via PageHeader or directly) + large dashboard KPI numbers. Body/labels/table cells/small
  section labels stay sans. Do NOT touch the notification dropdown/rows.
- FIX D — cards flat/sharp. In `components/ui/card.tsx`: `rounded-lg → rounded-xl`,
  `shadow-sm → softer/larger shadow`, border → `/60` so the shadow carries elevation.

After 4c: build + Phase-0 specs #1/#2 green, then re-push so Mike re-looks.

## PHASE 4b — Contact detail column reflow (as specified above; container queries,

## 3→2→tabbed, floored middle, + the red→green reflow spec). Then push.

## PHASE 4d — Contacts list restructure (INTENTIONAL change to a protected page; own commit,

## own before/after review, behavior preserved). Target `contacts-shell.tsx`:

1. Delete the description `<p>` "People — the permanent record…" (contacts-shell.tsx:188).
2. Move Saved Views from the top strip (`SavedViewsTabStrip`, ~:207) into a LEFT collapsible
   panel. New structure: Row 1 title+actions (unchanged); Row 2 search + filter chips +
   More filters; Row 3 two-column `[ left: collapsible Saved Views panel ][ right:
ContactsTable ]`. Panel = its own LIGHT card (`bg-[var(--color-card)]`, subtle border,
   rounded-xl — visually distinct from the dark nav), lists views vertically with active
   highlighted (`bg-[var(--color-primary)] text-[var(--color-primary-foreground)]`),
   collapsible with persisted state (independent of the main nav), reusing
   SavedViewsTabStrip's logic rendered vertically (new SavedViewsPanel / vertical variant —
   don't reimplement). Fluid (LAW 6): below a narrow breakpoint the panel collapses / becomes
   a dropdown and the table goes full width.
3. Shorten the search input (cap ~max-w-md, left-aligned) in ContactsFilterBar; keep chips +
   More filters in place.
4. No other button placement changes; do NOT touch the contact card / detail page.
   Verify build + Phase-0 specs; re-push. Commit:
   `feat(contacts): saved-views left panel + shortened search + drop description`.

## PHASE 5 → 6 → 7 — as specified above. Phase 5 also covers palette classes introduced by

## the new Saved Views panel (4d) and the scan-diagnostics inline hex.

---

# REVISED remaining reskin (AUTHORITATIVE — supersedes the two blocks above)

Order: 4c → 4b → 4d → 4e → 5 → 6 → 7. UI/CSS only (no schema/columns/data).
`app/globals.css` @theme is the source of truth; values below mirror it.

## PHASE 4c (REVISED) — Editorial-ink palette

Primary is editorial INK (#211c15), not green; paper is brighter ivory (#f8f5ee). Green is
DEMOTED to accent/ring/category, no longer primary. @theme now:

- surfaces: background #f8f5ee, foreground #211c15, card/popover #fdfcf8, muted #efeadf,
  muted-foreground #8c8578, border/input #e6e1d4, sidebar #2b2720 (kept), sidebar-fg #f8f5ee.
- brand: primary #211c15 (ink), primary-fg #f8f5ee, brand-accent #38473a (green — ACCENT ONLY),
  ring #7c8a72 (sage), accent/secondary #efeadf (NEUTRAL cream hover surface — never sage).
- states (dusty): destructive rust #b05a34, warning gold #bd9a4c, success green #3d5243,
  info dusty-blue #3f5a76 (--color-info stays DEFINED).
- category (dustier) + blush: cat-lead #3f5a76, cat-client #38473a, cat-referral #7c8a72,
  cat-vendor #90a6b0 (kept steel), cat-payment #bd9a4c, cat-scheduling #b06a45 terracotta,
  cat-blush #c79a8d (NEW wedding accent) + derived tints.
  FIX B (dark labeled nav) + FIX C (serif page titles + KPI numbers): already applied, kept.
  FIX D (card shadow) REMOVED — card is owned by 4e (rounded-xl, border/60, NO shadow); the
  earlier soft shadow was reverted.

## PHASE 4b — unchanged (container-query reflow + red→green spec #3).

## PHASE 4d (REVISED) — Contacts list restructure. As above PLUS:

- ADD small category-colored avatars to contact rows: 26px circle, initials from displayLabel,
  bg = the contactType's category token color. Presentation-only, computed client-side — NO
  data/column change. Do NOT change the Type column (contactType: vendor/lead/client — NOT
  booking status) or any column set.
  Commit: `feat(contacts): saved-views left panel + shortened search + avatars`.

## PHASE 4e — Restraint + motion pass (warm editorial × premium restraint × functional motion)

1. card.tsx: rounded-xl, border/60, NO shadow (supersedes FIX D). Lists/tables use divide-y
   hairlines, not per-row boxes.
2. tabular-nums on ALL data figures; uppercase tracked micro-labels (text-2xs uppercase
   tracking-wide muted) on field/column/section labels.
3. COLOR = SIGNAL ONLY (governs Phase 5): color fires only for meaning — primary(ink)=primary
   actions; brand-accent/category=badges/dots; state tokens=status. Surfaces stay neutral
   cream/ink; NEVER tint a surface with brand/category hue; hover bg = neutral muted, not sage.
4. Motion (150–200ms ease-out, motion-safe + prefers-reduced-motion): row hover reveals actions
   (group-hover, like notification rows); button hover darken +1px lift; inline-edit hover/focus
   affordance via shared input primitive; global sage focus-visible ring; state cross-fade.
   GUARDRAILS: notification geometry (448/88, specs #1/#2) unchanged; contact detail only via 4b;
   protected-surface changes only through shared primitives/tokens.

## PHASE 5 (revised note) — obey 4e color=signal: former-primary green → brand-accent/category,

## NOT a tinted surface; decorative color → neutral.
