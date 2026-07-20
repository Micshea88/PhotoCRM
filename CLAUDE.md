@AGENTS.md

## Claude Code specifics

- Project skills live in `.claude/skills/`. Slash commands in `.claude/commands/`. Hooks in `.claude/settings.json`.
- Use `/new-module <name>` to scaffold a new feature module from the items template (delegates to the `add-module` skill).
- Use `/new-migration <description>` after editing schema to generate, review, and apply.
- Use `/seed` to load development data.
- The Stop hook reminds you to run `pnpm verify --tier=2` — but only when there are uncommitted changes under `src/`, `app/`, `tests/`, or `scripts/`. Read-only conversations don't get the nag.
- The PostToolUse hook (matchers: `Edit`, `Write`, `MultiEdit`) reminds you to regenerate migrations after schema edits, warns hard when committed migrations are touched, and reminds about the per-module list updates (`tests/e2e/helpers/reset-db.ts`, `app/api/jobs/cron/purge-deleted/route.ts`) when a new module schema is created.

## Outstanding work

The repo ships with `TODO.md` at the root — the audit punch list. The Critical block (security + RPC exposure + CI gaps) is fixed; several High items (multi-region rate-limit storage, partial indexes, password breach check, hashed verification tokens) are still open. (Audit-on-mutate static enforcement is now done — `scripts/check-actions.mjs` enforces `audit()` on every action.)
