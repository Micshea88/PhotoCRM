#!/usr/bin/env node
// Reads the tool input via stdin (Claude Code post-edit hook payload). If the
// edited file looks like a Drizzle schema, prints a reminder to regenerate.

import { readFileSync } from "node:fs"

let input = {}
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}")
} catch {
  // No payload — nothing to do.
}

const file = input?.tool_input?.file_path ?? ""
if (/src\/db\/schema\.ts$|src\/modules\/[^/]+\/schema\.ts$/.test(file)) {
  console.error(
    "[post-edit] Schema changed. Run `pnpm db:generate` and review the migration before committing.",
  )
}
process.exit(0)
