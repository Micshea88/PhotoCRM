#!/usr/bin/env node
/**
 * Stop hook. Reminds the agent to verify before declaring work done — but
 * ONLY when there are uncommitted changes under src/, app/, tests/, scripts/,
 * or build config. Read-only conversations don't trigger this so it stays
 * meaningful instead of becoming wallpaper.
 */

import { spawnSync } from "node:child_process"

const r = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" })
const dirty = (r.stdout ?? "").trim()

if (!dirty) process.exit(0)

const lines = dirty.split("\n").filter((l) => l.trim())
const meaningful = lines.some((l) => {
  const path = l.slice(3) // strip the "XY " status prefix
  return /^(src|app|tests|scripts)\/|drizzle\.config|package\.json/.test(path)
})

if (!meaningful) process.exit(0)

console.error(
  "[stop] Uncommitted changes under src/, app/, tests/, or scripts/. Before declaring this done, run:\n" +
    "    pnpm verify --tier=2\n" +
    "  (See AGENTS.md → Validation commands.)",
)
process.exit(0)
