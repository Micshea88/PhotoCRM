---
name: add-migration
description: Use when the user asks to change the database schema — generates, reviews, and applies migrations safely; enforces the expand-migrate-contract pattern for destructive changes.
---

# Adding a migration

## When to use

When you've edited `src/db/schema.ts` (or a module's `schema.ts` re-exported from there) and need a new SQL migration to capture the change.

## Steps

1. **Verify the diff.** Run `git diff src/modules/*/schema.ts src/db/schema.ts` to be sure of what changed.

2. **Generate:**

   ```bash
   pnpm db:generate
   ```

   This creates a new file in `src/db/migrations/`.

3. **Read the generated SQL.** Open the newest file in `src/db/migrations/` and check:
   - Only `CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX` for new things.
   - No `DROP COLUMN`, `DROP TABLE`, type narrowing, or `RENAME COLUMN` unless you intend it AND have a deploy plan.

4. **For destructive changes**, do not run the migration. Instead:
   - Revert the destructive piece of the schema edit.
   - Re-generate (delete the bad migration first).
   - Apply the **expand** migration (add new column / new table) only.
   - Deploy code that writes to both old and new.
   - In a _later release_, do the migrate (backfill) step.
   - In a _third release_, do the contract step (drop old).

5. **Apply locally:**

   ```bash
   pnpm db:migrate
   ```

6. **Verify schema drift is gone:**

   ```bash
   pnpm db:check
   ```

   Should report "Everything's fine".

7. **Run tier-2 verify:**

   ```bash
   pnpm verify --tier=2
   ```

8. **Commit** the schema files and the migration together:
   ```bash
   git add src/modules/*/schema.ts src/db/schema.ts src/db/migrations/
   git commit -m "feat: <describe schema change>"
   ```

## Hard rules

- **Migrations on `main` are immutable.** Never edit a committed migration. Always create a new one.
- **The `db:push` script does NOT exist.** It was deliberately removed (see `TODO.md` C10) — using it would skip the migration trail entirely and silently diverge a developer's local DB from the migration files. Use `pnpm db:generate` + `pnpm db:migrate`.
- **Vercel runs `drizzle-kit migrate` only on production deploys** (gated by `scripts/vercel-build.mjs`). Preview deploys do NOT run migrations against the prod DB. Migrations must be idempotent and reversible at the connection level (transactional where Postgres allows).
