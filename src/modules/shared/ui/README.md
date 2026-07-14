# shared/ui

Cross-cutting UI primitives used by many feature modules (not product logic).

## page-container.tsx

The page layout system (reskin Phase 3). `PageContainer` is the SINGLE owner of
horizontal gutters + max width (LAW 6); `main` in `client-layout-shell` owns
vertical rhythm only — one owner per axis, no doubled gutters.

- `PageContainer` — `variant`: `full` (fluid, no cap — default posture) ·
  `default` (fluid up to `PAGE_MAX_DEFAULT` ≈ 1100px) · `narrow` (fluid up to
  `PAGE_MAX_NARROW` ≈ 720px). Every variant is fluid and reflows — never a
  centered island. Ceilings are exported constants (one-line adjustable).
- `PageHeader` — `title` (font-serif; wrap a word in `<em>` for the italic
  emphasis treatment), optional `description` + `actions` (font-sans).
- `PageSection` — grouped block with consistent vertical spacing + optional
  font-serif section title.

Named exports only (AGENTS.md hard rule 8). Variants use `cn()`, not `cva()`
(`cva` is reserved for `components/ui/`).
