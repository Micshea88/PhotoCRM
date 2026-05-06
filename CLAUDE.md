@AGENTS.md

## Claude Code specifics

- Project skills live in `.claude/skills/`. Slash commands in `.claude/commands/`. Hooks in `.claude/settings.json`.
- Use `/new-module <name>` to scaffold a new feature module from the items template.
- Use `/new-migration <description>` after editing schema to generate, review, and apply.
- Use `/seed` to load development data.
- The Stop hook reminds you to run `pnpm verify --tier=2` before declaring work complete.
- The PostToolUse hook reminds you to regenerate migrations after schema edits.
