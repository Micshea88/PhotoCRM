#!/usr/bin/env node
/**
 * Static check (design-system governance): product UI must use the token SCALES,
 * not off-scale literals. Sibling to check-no-raw-palette (which owns color). Bans
 * in src/ · app/ · components/:
 *
 *   - arbitrary spacing:  p-[18px] / m-[13px] / gap-[7px] …  (use the 8px scale;
 *     dimensional w-[..]/h-[..]/min-w-[..] brackets ARE allowed — sizing, not rhythm)
 *   - arbitrary radius:   rounded-[6px] / rounded-md-[..]  (use rounded-sm/md/lg/xl
 *     or rounded-[var(--radius-*)]; a var() reference is allowed, a px/rem literal is not)
 *   - non-canonical focus ring: focus:ring-2 / focus-visible:ring-3 …  (the one ring is
 *     focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]; ring-0 to suppress a
 *     nested ring is allowed)
 *   - off-scale disabled opacity: disabled:opacity-40/60/70 …  (the one disabled
 *     treatment is disabled:opacity-50 + not-allowed + pointer-events-none)
 *
 * See docs/pathway-design-system.md → Design system standard. Exits 1 with a
 * file:line list on any violation.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOTS = ["src", "app", "components"]
const EXCLUDE = ["src/emails/", "app/api/share-link/"]

const CHECKS = [
  {
    name: "arbitrary spacing",
    re: /\b(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-\[\d[\d.]*(px|rem|em)\]/,
    hint: "use the 8px spacing scale — no arbitrary p-[..]/m-[..]/gap-[..] (dimensional w-[..]/h-[..] are fine)",
  },
  {
    name: "arbitrary radius",
    re: /\brounded(-[a-z]+)?-\[\d[\d.]*(px|rem|em)\]/,
    hint: "use the radius scale (rounded-sm/md/lg/xl) or a token (rounded-[var(--radius-pill)]) — no rounded-[Npx] literal",
  },
  {
    name: "non-canonical focus ring",
    re: /\bfocus(-visible)?:ring-[2-9]\b/,
    hint: "the one focus ring is focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] (ring-0 to suppress a nested ring is OK)",
  },
  {
    name: "off-scale disabled opacity",
    re: /\bdisabled:opacity-(?!50\b)\d+/,
    hint: "the one disabled treatment is disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
  },
]

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) yield* walk(full)
    else if (/\.(tsx?)$/.test(full)) yield full
  }
}

const violations = []
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (EXCLUDE.some((p) => file.startsWith(p))) continue
    const lines = readFileSync(file, "utf8").split("\n")
    lines.forEach((line, i) => {
      for (const check of CHECKS) {
        if (check.re.test(line)) {
          violations.push(`${file}:${i + 1}  [${check.name}]  ${line.trim().slice(0, 100)}`)
        }
      }
    })
  }
}

if (violations.length > 0) {
  console.error(`[check-design-tokens] ${violations.length} off-scale violation(s):\n`)
  console.error(violations.join("\n"))
  console.error("\nRules:")
  for (const c of CHECKS) console.error(`  - ${c.name}: ${c.hint}`)
  console.error("\nSee docs/pathway-design-system.md → Design system standard.")
  process.exit(1)
}

console.log("[check-design-tokens] product UI is on-scale ✓")
