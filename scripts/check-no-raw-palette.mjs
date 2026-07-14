#!/usr/bin/env node
/**
 * Static check (reskin governance): product UI must use the @theme token layer,
 * NOT raw Tailwind palette classes or bracket font sizes.
 *
 * Bans, in src/ · app/ · components/:
 *   - raw palette classes:  (text|bg|border|ring|…)-(red|amber|green|blue|gray|…)-NNN
 *   - bracket micro-fonts:  text-[NNpx]
 *
 * Use the semantic tokens instead: var(--color-destructive) / --color-warning /
 * --color-success / --color-info / --color-cat-* / muted / border; and the type
 * steps text-2xs / text-3xs / text-4xs (see docs/pathway-design-system.md →
 * "Token catalog").
 *
 * EXCLUDED (structural — they render OUTSIDE app/globals.css, so @theme tokens
 * don't exist there): src/emails/** and app/api/share-link/**.
 *
 * Exits 1 with a file:line list on any violation.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOTS = ["src", "app", "components"]
const EXCLUDE = ["src/emails/", "app/api/share-link/"]

// FULL Tailwind color palette (all 22 hues). violet/purple/fuchsia/pink were the
// gap that let bg-violet-500 slip past into the AI badge earlier — now covered so
// no off-palette color can slip in again.
const PALETTE =
  /\b(text|bg|border|ring|from|to|via|divide|fill|stroke|outline|decoration|placeholder|caret|accent)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/
const BRACKET_FONT = /text-\[\d+px\]/

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      yield* walk(full)
    } else if (/\.(tsx?|css)$/.test(full)) {
      yield full
    }
  }
}

const violations = []
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (EXCLUDE.some((p) => file.startsWith(p))) continue
    const lines = readFileSync(file, "utf8").split("\n")
    lines.forEach((line, i) => {
      // globals.css legitimately holds hex in comments / oklch — only flag the
      // two class patterns, which never appear in @theme definitions.
      if (PALETTE.test(line) || BRACKET_FONT.test(line)) {
        violations.push(`${file}:${i + 1}  ${line.trim().slice(0, 100)}`)
      }
    })
  }
}

if (violations.length > 0) {
  console.error(
    `[check-no-raw-palette] ${violations.length} raw palette class / bracket-font violation(s):\n`,
  )
  console.error(violations.join("\n"))
  console.error(
    "\nUse @theme tokens (var(--color-*), text-2xs/3xs/4xs). See docs/pathway-design-system.md → Token catalog.",
  )
  process.exit(1)
}

console.log("[check-no-raw-palette] product UI is token-only ✓")
