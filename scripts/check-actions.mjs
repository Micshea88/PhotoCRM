#!/usr/bin/env node
/**
 * Static check: every server action under src/modules/.../actions.ts MUST go
 * through the safe-action chain AND include `.inputSchema(...)`.
 *
 * Why: the safe-action factory does NOT enforce input validation by itself —
 * `.inputSchema(...)` is opt-in in next-safe-action. Skipping it once means
 * the action accepts any shape from the client. This check is the enforcement
 * the README/AGENTS.md promised.
 *
 * Failure mode: if an action chain is missing `.inputSchema(`, this script
 * exits 1 with a list of offending files and approximate line numbers.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOTS = ["src/modules"]
const ALLOWLIST_FILES = new Set([
  // Add files here only if there's a deliberate reason an action chain
  // shouldn't go through inputSchema (rare).
])

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) yield* walk(full)
    else if (full.endsWith("actions.ts")) yield full
  }
}

const offenders = []

for (const root of ROOTS) {
  let exists = true
  try {
    statSync(root)
  } catch {
    exists = false
  }
  if (!exists) continue

  for (const file of walk(root)) {
    if (ALLOWLIST_FILES.has(file)) continue

    const text = readFileSync(file, "utf8")

    // Find each call to `.action(` (the terminator of a safe-action chain).
    // For each, walk back from that position and require `.inputSchema(` to
    // appear before the previous statement boundary (`;` or top-of-file).
    const actionCalls = [...text.matchAll(/\.action\s*\(/g)]
    for (const m of actionCalls) {
      const idx = m.index
      // Find the start of the chain: either the previous `;` or beginning of file.
      const prevSemi = text.lastIndexOf(";", idx)
      const chainStart = prevSemi === -1 ? 0 : prevSemi + 1
      const chain = text.slice(chainStart, idx)
      if (!/\.inputSchema\s*\(/.test(chain)) {
        const lineNo = text.slice(0, idx).split("\n").length
        offenders.push({ file, line: lineNo })
      }
    }
  }
}

if (offenders.length > 0) {
  console.error("\n[check-actions] Server actions missing `.inputSchema(...)`:\n")
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}`)
  }
  console.error(
    "\nEvery server action MUST validate its input. Add `.inputSchema(zodSchema)` to the chain.",
  )
  console.error("See src/modules/items/actions.ts for the canonical pattern.\n")
  process.exit(1)
}

console.log("[check-actions] all server actions validate input ✓")
