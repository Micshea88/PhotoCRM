---
name: add-module
description: Use when the user asks to create a new feature module — scaffolds the items template into a new module, rewires schema and migrations, adds routes and integration tests.
---

# Adding a feature module

This skill is the canonical checklist for `/new-module`. The slash command delegates here so the steps live in exactly one place.

## Inputs

- Module name in kebab-case (e.g. `tasks`, `projects`, `team-members`).

## Steps

1. **Pick names carefully.** Convention from `items` is plural-as-table-name and plural-as-folder-name. Stay consistent unless the domain demands otherwise (e.g. `team-member` if the conceptual unit is singular).

2. **Copy the template:**

   ```bash
   cp -r src/modules/items src/modules/<name>
   ```

3. **Rename inside files.** Targets to find-and-replace:
   - `items` → `<name>` (table name, route segments, file paths)
   - `Item` → `<Name>` (PascalCase: type names, component names, function names)
   - `actionName: "items.<verb>"` → `actionName: "<name>.<verb>"`
   - Audit-log strings — `items` template uses `actionName: "items.create"` paired with `audit(..., "items.created")`. Keep the singular-vs-plural form consistent (the table name is plural, both strings should be too — e.g. `"<name>.create"` and `"<name>.created"`).
   - Be careful with substring matches like `itemId` → `<name-singular>Id`.

   Use Edit's `replace_all` for safer renames.

4. **Update `src/db/schema.ts`:**

   ```ts
   export * from "@/modules/<name>/schema"
   ```

5. **Update the per-module lists** that grow with every new module:
   - `tests/e2e/helpers/reset-db.ts` — append the new table to `TABLES_TO_TRUNCATE` so e2e tests truncate it between specs.
   - `app/api/jobs/cron/purge-deleted/route.ts` — if the new module has soft-delete columns (it will, since you copied items), add a delete loop modeled on the existing `items` / `files` blocks. Without this, soft-deleted rows accumulate forever.

6. **Generate + review migration:**

   ```bash
   pnpm db:generate
   ```

   Read the new SQL file. Confirm only `CREATE TABLE` / `CREATE INDEX`. Then apply:

   ```bash
   pnpm db:migrate
   ```

7. **Create routes:**
   - `app/(app)/<name>/page.tsx` (list)
   - `app/(app)/<name>/new/page.tsx` (create)
   - `app/(app)/<name>/[id]/page.tsx` (detail)
   - `app/(app)/<name>/[id]/edit/page.tsx` (edit)

   Mirror the items routes; update imports.

8. **Sidebar entry** in `src/modules/org/ui/app-sidebar.tsx` (if that file exists in this repo) — add a `NAV` entry if this module should appear in primary nav.

9. **Integration test** at `tests/integration/<name>.test.ts`:
   - Org scoping (rows in different orgs are isolated)
   - Soft-delete filter (`isNull(deletedAt)`)
   - Audit log row written by `audit()`

   Use `tests/integration/items.test.ts` as the template.

10. **Verify:**

    ```bash
    pnpm verify --tier=2
    ```

11. **Commit:**

    ```bash
    git add -A
    git commit -m "feat: add <name> module from items template"
    ```

## Hard rules (don't skip)

- **Don't change the audit log conventions.** Every action calls `audit(ctx, "<name>.<verb>", ...)`.
- **Don't add a layer.** No `service` files, no DI containers. Queries and actions are the only abstraction.
- **Don't skip the integration test.** Org scoping is the bug class that bites hardest in B2B SaaS.
- **Every action chain MUST include `.inputSchema(zodSchema)`.** The `scripts/check-actions.mjs` static check (run by `pnpm verify --tier=1`) fails the build if you forget.
