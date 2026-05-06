#!/usr/bin/env node
/**
 * Post-edit hook. Reads the Claude Code tool-use payload from stdin and prints
 * targeted reminders when files needing follow-up work are touched.
 *
 * IMPORTANT: this hook prints non-blocking reminders (exit 0). It is not a
 * gate — `pnpm verify --tier=2` and CI are the gates. Hooks like this exist
 * to catch mistakes fast, not to enforce.
 */

import { readFileSync } from "node:fs"

let input = {}
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}")
} catch {
  // No payload — nothing to do.
}

const file = input?.tool_input?.file_path ?? ""

const messages = []

// Schema changed → reminder to regenerate migration
if (
  /(^|\/)src\/db\/schema\.ts$/.test(file) ||
  /(^|\/)src\/modules\/[^/]+\/schema\.ts$/.test(file)
) {
  messages.push(
    "[post-edit] Schema changed. Run `pnpm db:generate` and review the new migration before committing.",
  )
}

// Migration file edited → strong warning (AGENTS.md hard rule #8)
if (/src\/db\/migrations\/.*\.sql$/.test(file)) {
  messages.push(
    "[post-edit] ⚠ A migration file was edited. Per AGENTS.md hard rule #8, migrations on `main` are immutable. If you need to fix something, generate a NEW migration with `pnpm db:generate`.",
  )
}

// New module schema → reminder to update the lists that grow per-module
if (/src\/modules\/[^/]+\/schema\.ts$/.test(file)) {
  messages.push(
    "[post-edit] If this is a NEW module, also:\n" +
      "  1. Add the table(s) to `tests/e2e/helpers/reset-db.ts` `TABLES_TO_TRUNCATE`.\n" +
      "  2. Add a delete loop to `app/api/jobs/cron/purge-deleted/route.ts` if it has soft-delete columns.\n" +
      "  3. Export the schema from `src/db/schema.ts`.",
  )
}

// Documentation changes → consistency reminder
if (/^(AGENTS|CLAUDE|README)\.md$/.test(file)) {
  messages.push(
    "[post-edit] Documentation changed. If you altered a hard rule or claim, verify that lint/CI/hooks actually enforce it.",
  )
}

if (messages.length > 0) {
  for (const m of messages) console.error(m)
}
process.exit(0)
