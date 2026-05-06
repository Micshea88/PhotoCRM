---
description: Scaffold a new feature module from the items template
allowed-tools: Bash, Read, Edit, Write, Skill
argument-hint: <module-name>
---

Use the `add-module` skill to scaffold a new feature module under `src/modules/$ARGUMENTS/`.

The skill is the canonical checklist (rename targets, the per-module lists at `tests/e2e/helpers/reset-db.ts` and `app/api/jobs/cron/purge-deleted/route.ts` that need updating, integration test scaffolding, sidebar wiring, and `pnpm verify --tier=2`). Do not duplicate it here.

After running the skill, verify all of these landed:

- [ ] New module directory `src/modules/$ARGUMENTS/`
- [ ] `src/db/schema.ts` re-exports it
- [ ] New SQL migration generated and applied locally
- [ ] Routes under `app/(app)/$ARGUMENTS/`
- [ ] Integration test `tests/integration/$ARGUMENTS.test.ts`
- [ ] `tests/e2e/helpers/reset-db.ts` `TABLES_TO_TRUNCATE` includes the new table(s)
- [ ] `app/api/jobs/cron/purge-deleted/route.ts` purges the new table if it has soft-delete columns
- [ ] `pnpm verify --tier=2` passes
