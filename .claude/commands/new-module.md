---
description: Scaffold a new feature module from the items template
allowed-tools: Bash, Read, Edit, Write
argument-hint: <module-name>
---

Scaffold a new feature module under `src/modules/$ARGUMENTS/`. Follow these steps exactly:

1. Copy the items template:
   ```bash
   cp -r src/modules/items src/modules/$ARGUMENTS
   ```
2. Rename `items` → `$ARGUMENTS` and `Item` → the PascalCase form of `$ARGUMENTS` inside every file under the new directory. Take care: the table name in `schema.ts`, the type names, the file paths in routes, and the `actionName` metadata strings all need updating.
3. Update `src/db/schema.ts` to add `export * from "@/modules/$ARGUMENTS/schema"`.
4. Run `pnpm db:generate` and open the new SQL file in `src/db/migrations/` to review it. Confirm it only adds new tables — never renames or drops anything.
5. Run `pnpm db:migrate` to apply locally.
6. Create starter routes under `app/(app)/$ARGUMENTS/` mirroring the items routes (`page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `[id]/edit/page.tsx`). Update import paths.
7. Update `src/modules/org/ui/app-sidebar.tsx` to add a nav entry for the new module if it should appear in the sidebar.
8. Create `tests/integration/$ARGUMENTS.test.ts` covering org scoping, soft-delete filter, and audit log. Use `tests/integration/items.test.ts` as the template.
9. Run `pnpm verify --tier=2`. Fix anything red.
10. Commit with a message like `feat: add $ARGUMENTS module from items template`.

Do not invent new conventions. Match the items module exactly.
