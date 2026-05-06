---
description: Review the latest Drizzle migration for destructive operations
allowed-tools: Read, Bash
---

Find the most recently generated migration in `src/db/migrations/` (highest-numbered `.sql` file) and analyze it. Report:

1. **Destructive operations** (BLOCK these):
   - `DROP COLUMN`
   - `DROP TABLE`
   - `ALTER COLUMN ... TYPE` that's not widening (e.g., `text` → `varchar(50)` is narrowing)
   - `RENAME COLUMN` — only safe if no committed code reads the old name
   - `RENAME TABLE`
2. **Risky operations** (WARN these):
   - `NOT NULL` added to a column without a default (will fail if existing rows have NULL)
   - Foreign key changes
   - Indexes on large tables (consider `CREATE INDEX CONCURRENTLY`)
3. **Safe operations** (no warning):
   - Adding columns with defaults
   - Adding new tables
   - Adding indexes on small tables
   - Adding non-NULL columns with explicit defaults

If you find destructive operations, recommend the expand-migrate-contract pattern:

1. Add new column / new table; deploy code that writes to both.
2. Backfill data; deploy code that reads from new only.
3. Drop old column / rename / cleanup.
