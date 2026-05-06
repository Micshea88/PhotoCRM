---
description: Generate, review, and apply a new Drizzle migration
allowed-tools: Bash, Read
argument-hint: <description>
---

Run a clean migration cycle:

1. Run `pnpm db:generate`.
2. Read the newest file in `src/db/migrations/` (the highest-numbered `.sql`). Review the SQL for:
   - Column drops (FORBIDDEN without an expand-migrate-contract plan).
   - Table drops (FORBIDDEN without a deprecation cycle).
   - Renames (use ALTER ... RENAME only if no active code reads the old name; otherwise add new + backfill + remove later).
   - Default values that change for existing rows (consider explicit backfill).
   - Indexes added: confirm they're necessary; large tables benefit from `CREATE INDEX CONCURRENTLY` (drizzle-kit doesn't emit this — flag if needed).
3. If the migration is safe, run `pnpm db:migrate`.
4. If unsafe, stop and ask the user how to proceed. Do not edit the generated SQL — generate a new migration that fixes the issue instead.
5. Run `pnpm verify --tier=2` to make sure nothing else broke.
6. Commit the schema change + the migration file together.

Migration description (`$ARGUMENTS`) goes in the commit message.
