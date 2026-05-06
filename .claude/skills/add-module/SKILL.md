---
name: add-module
description: Use when the user asks to create a new feature module — scaffolds the items template into a new module, rewires schema and migrations, adds routes and integration tests.
---

# Adding a feature module

This skill encodes the `/new-module` slash command's checklist with extra guidance on naming and edge cases.

## Inputs

- The module name in kebab-case (e.g., `tasks`, `projects`, `team-members`).

## Steps

1. **Pick names carefully.** Use the singular if the conceptual unit is singular (`team-member` not `team-members`); use the plural if it's a collection (`items` because we manage many). The convention from `items` is plural-as-table-name, plural-as-folder-name. Stay consistent with that unless the domain demands otherwise.

2. **Copy the template:**

   ```bash
   cp -r src/modules/items src/modules/<name>
   ```

3. **Rename inside files.** Targets to find-and-replace:
   - `items` → `<name>` (table name, route segments, file paths)
   - `Item` → `<Name>` (PascalCase: type names, component names, function names)
   - `item` → `<name-singular>` (variable names) — be careful with substring matches like `itemId`
   - `actionName: "items.*"` → `actionName: "<name>.*"`

   Use Edit's `replace_all` for safer renames.

4. **Update `src/db/schema.ts`:**

   ```ts
   export * from "@/modules/<name>/schema"
   ```

5. **Generate + review migration:**

   ```bash
   pnpm db:generate
   ```

   Read the new SQL file. Confirm only `CREATE TABLE` / `CREATE INDEX`. Apply:

   ```bash
   pnpm db:migrate
   ```

6. **Create routes:**
   - `app/(app)/<name>/page.tsx` (list)
   - `app/(app)/<name>/new/page.tsx` (create)
   - `app/(app)/<name>/[id]/page.tsx` (detail)
   - `app/(app)/<name>/[id]/edit/page.tsx` (edit)

   Mirror the items routes; update imports.

7. **Sidebar entry** in `src/modules/org/ui/app-sidebar.tsx` — add a `NAV` entry if this module should appear in primary nav.

8. **Integration test** at `tests/integration/<name>.test.ts`:
   - Org scoping (rows in different orgs are isolated)
   - Soft-delete filter (`isNull(deletedAt)`)
   - Audit log row written by `audit()`

9. **Verify:**

   ```bash
   pnpm verify --tier=2
   ```

10. **Commit:**
    ```bash
    git add -A
    git commit -m "feat: add <name> module from items template"
    ```

## Pitfalls

- **Don't change the audit log conventions.** Every action calls `audit(ctx, "<name>.<verb>", ...)`.
- **Don't add a layer.** No `service` files, no DI containers. Queries and actions are the only abstraction.
- **Don't skip the integration test.** Org scoping is the bug class that bites hardest in B2B SaaS.
