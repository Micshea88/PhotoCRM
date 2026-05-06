# items module — worked example

This module is the **canonical pattern** every product feature must follow.
Sage adds a new feature by copying this directory and renaming `items` → his
feature name everywhere. Then he adds the new schema export to
`src/db/schema.ts` and the new pages under `app/(app)/<feature>/`.

## Layout

```
modules/items/
├── schema.ts        # Drizzle table; soft-delete columns standard on all app tables
├── types.ts         # Zod input schemas; inferred TS types
├── queries.ts       # Server-only read functions; soft-delete filtered by default
├── actions.ts       # Server actions, all built via orgAction (auth + org enforced)
├── ui/              # Feature-local React components
└── README.md        # This file
```

## Conventions enforced here

1. **Soft delete only.** `deleteItem` sets `deletedAt`/`deletedBy`; never `DELETE FROM`.
   `restoreItem` un-deletes. The cron purge (Phase 8) is the only place hard deletes happen.
2. **All queries filter `deletedAt IS NULL` by default.** To include deleted rows,
   pass `{ withDeleted: true }` explicitly.
3. **All mutations go through `orgAction` (or `authAction`).** Auth + org membership
   are enforced at the wrapper, not at each action.
4. **Every state-changing action calls `audit()`.** The audit context (org, user,
   IP, user-agent) is automatically populated by the safe-action middleware.
5. **All actions call `revalidatePath()`** for any route that displays the data.

## To add a new module

1. Copy this directory: `cp -r src/modules/items src/modules/<your-feature>`
2. Rename `items` → `<your-feature>` (and `Item` → `<YourFeature>`) inside the files.
3. Add `export * from "@/modules/<your-feature>/schema"` to `src/db/schema.ts`.
4. Run `pnpm db:generate`. Review the generated SQL file in `src/db/migrations/`.
5. Run `pnpm db:migrate` to apply locally.
6. Add routes under `app/(app)/<your-feature>/`.
7. Add an integration test at `tests/integration/<your-feature>.test.ts`.
8. Run `pnpm verify --tier=2`.
