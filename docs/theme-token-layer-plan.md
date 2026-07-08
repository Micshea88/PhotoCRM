# Theme Token-Layer Plan (Phase 1 — approved architecture; VALUES TBD)

**Status:** Approved architecture + migration plan. **NOT applied.** The reskin is frozen until the notification build is done + reviewed. The actual **cream/olive `oklch` VALUES are TBD** — to be designed collaboratively in the reskin session. This doc defines the _slots_ and the _plan_, not the colors.

**Hard rules (locked):**

- NO hardcoded color/spacing/radius/type values in components — everything references central tokens.
- **NO dark mode.** Single light theme only. Dark-mode code is removed as part of this effort.
- Changing the look later = editing the token file, not hunting values across components.

---

## 1. Current state (audit, 2026-07-07)

- **Stack:** Tailwind **v4, CSS-first** (`tailwindcss ^4.2.4`, `@tailwindcss/postcss`). **No `tailwind.config.*`** — theme config lives in CSS. shadcn/ui ("new-york", `cssVariables: true`). Idiom: `className` + Tailwind utilities via `cn()` (clsx + tailwind-merge); `cva()` only in `components/ui/` (button/alert/label).
- **Token layer EXISTS but is incomplete:** one `@theme` block in `app/globals.css` — ~19 color tokens (neutral monochrome + one `--color-destructive` red), `--radius`, 2 font tokens, all `oklch`. `components/ui/` primitives (button/card/input/alert) are already fully tokenized. 81% of module files reference `var(--color-*)`.
- **Gaps:** no `--color-warning/success/info` tokens → status colors hardcoded as Tailwind palette classes (~60 instances, ~45 files). `--color-info` referenced but undefined (latent bug). Micro font sizes `text-[11px]/[10px]/[9px]` (~80 instances) un-tokenized. Dark mode fully wired + active (next-themes + header ThemeToggle + `.dark` block + ~30 `dark:` files). `docs/pathway-design-system.md` has NO token catalog.

## 2. Target token architecture (single `@theme` block, `app/globals.css`)

Four token families — the single source of truth:

### 2.1 Color (semantic — no palette in components)

- **Surfaces** (exist, keep): `background, card, popover, muted, border, input, ring`.
- **Brand:** `primary`/`-foreground`, `accent`/`-foreground` (accent = where olive lives), `secondary`/`-foreground`.
- **States (ADD):** `warning`/`-foreground`, `success`/`-foreground`, `info`/`-foreground` (fixes the undefined `--color-info` bug), plus existing `destructive`.
- **Category palette (ADD):** named tokens for notification dots + AI status badges + call dispositions — e.g. `--color-cat-lead / -client / -referral / -vendor / -payment / -scheduling` (+ foregrounds). Kills the `bg-blue-500` / `bg-emerald-500` hardcoding.

### 2.2 Type scale (ADD — FULL scale tokenized, incl. small sizes)

- Complete step set as tokens **including the sub-`xs` sizes** currently hardcoded: proposed `--text-3xs, --text-2xs, --text-xs, --text-sm, --text-base, --text-lg, --text-xl, --text-2xl…` with line-heights. Every component references a step; no bracket pixel sizes survive. (Single source of truth from the start — decided, not a second pass.)

### 2.3 Radius

- Ratify `--radius` as the one knob; wire the scale to reference it so global roundness is a single edit.

### 2.4 Spacing

- Adopt the existing Tailwind scale as standard (already clean). The ~33 arbitrary layout widths stay as deliberate documented geometry (not tokens).

### 2.5 Single light theme

- Remove the `.dark` override block, `next-themes`/`ThemeProvider`, the header `ThemeToggle`, and all `dark:` variants.

### 2.6 Governance

- Add a **token-catalog section to `pathway-design-system.md`** (rule: all color/type/radius from tokens; no palette classes, no bracket sizes). Optional ESLint guard banning raw palette classes / arbitrary color+size values so future modules inherit by construction.

## 3. Migration plan (phased, low-risk)

1. **Establish the token layer** — add state + category color tokens and the full type scale to `@theme`. Additive; breaks nothing. (Palette values are placeholders until the reskin session.)
2. **Remove dark mode** — delete `ThemeProvider`/`ThemeToggle`/`.dark` block; strip `dark:` variants (~30+ files). Verify build + visual pass.
3. **Migrate hardcoded color → tokens** — per module, commit per module: `red→destructive`, `amber→warning`, `emerald→success`, `blue→info`, dot/badge colors→category tokens.
4. **Migrate type sizes → scale tokens** — replace `text-[11px]/[10px]/[9px]` (+ any others) with the new steps.
5. **Ratify + guard** — write the catalog section; optionally land the lint rule.

## 4. Effort

- Token layer + full type scale: ~1 day.
- Remove dark mode: ~½ day (~30 `dark:` files + provider/toggle/`.dark`).
- Convert colors + type sizes: ~1.5–2 days (~60 palette instances/~45 files + ~80 micro-font instances, per-module commits).
- Catalog + optional lint guard: ~½ day.
- **Total ~3–4 focused days**, low-risk — architecture + house style already exist.

## 5. Running hardcoded-hotspot inventory (fold into migration)

The list to sweep. Grows as later tasks add debt.

- **Latent bug:** `--color-info` referenced but undefined — `src/modules/contacts/ui/contact-merge-side-by-side.tsx:909` (`bg-[var(--color-info)]/10`). Define the token.
- **Status-color palette clusters (~60 instances / ~45 files):** `text-red-600` (49×), `text-red-700` (20×), `bg-red-50` (12×), `text-amber-700` (11×), `border-red-200` (11×), `bg-emerald-*`, `bg-blue-*`, `bg-amber-*`. Representative: `due-state-class.ts`, `high-priority-flag.tsx`, `ai-status-badge.tsx`, `contact-activity-feed.tsx`, `selection-banner.tsx`, `provider-card.tsx`, `dialer-controls.tsx`, `sign-in-form.tsx`.
- **Notification-dot colors** — `src/modules/notifications/ui/notification-row.tsx` (`bg-blue-500`/`bg-green-500`/`bg-purple-500`/`bg-teal-500`) + unread badge `notification-bell.tsx` (`bg-red-500`). → category tokens.
- **Task 18 additions (delivery-status chip)** — `src/modules/contacts/ui/contact-activity-feed.tsx`, `DELIVERY_CHIP_CLASSES`:
  - `delivered` = `bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300` (no `--color-success` token yet — inline FLAG comment present). → `success` token.
  - `bounced`/`failed`/`complained` = `bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300`. → `destructive` token.
  - 4 new `dark:` variants added here — fold into the dark-mode removal sweep.
  - `sent` already token-only (`--color-muted`/`--color-muted-foreground`) — no change.
- **Micro font sizes (~80 instances):** `text-[11px]` (48×), `text-[10px]` (30×), `text-[9px]` (2×). → type-scale tokens.
- **Dark mode surface area:** `next-themes`, `src/modules/org/ui/theme-provider.tsx`, `theme-toggle.tsx` (in `AppTopbar`), the `.dark` block in `app/globals.css`, and ~30 `dark:`-variant files (`due-state-class.ts`, `ai-status-badge.tsx`, `contact-activity-feed.tsx`, `selection-banner.tsx`, `contacts-import-wizard.tsx`, etc.).
- **Non-product hex (ignore / low priority):** `app/(app)/admin/scan-diagnostics/page.tsx`, `app/api/share-link/[token]/route.ts` (server-rendered HTML) — not product UI.

## 6. Open collaborative step (before ANY code)

Design the actual **cream/olive `oklch` values** into the token slots together — surfaces (cream), primary/accent (olive), state hues (warning/success/info), category hues — then execute the migration. This doc defines the slots; that session fills the values.
