/**
 * Static-grep guard for the AI Assistant module.
 *
 * AI LAYER PRINCIPLE (rule AI1, docs/PIVOTS_LEDGER.md Section 1):
 * the AI is a tool the human drives, never an autonomous actor.
 * Reads flow through queries.ts; writes flow through the writers.ts
 * orgAction allowlist + explicit human confirmation.
 *
 * This test enforces two posture invariants by static analysis:
 *
 *   1. `retrievers.ts` reaches READS via queries.ts only — it MUST
 *      NOT import drizzle, @/db, @/lib/db, or any module schema.
 *   2. `writers.ts` is the ONLY file in this module permitted to
 *      import @/modules/<x>/actions. Every other file (including
 *      `actions.ts` and `validate.ts`) is blocked from importing the
 *      orgAction surface of other modules.
 *
 * ESLint's no-restricted-imports rule blocks the imports at build
 * time; this test is the belt-and-suspenders verification — even if
 * a future contributor disables the lint rule, this test catches the
 * bypass. The companion suite at
 * `tests/integration/ai-assistant-privileged-write-bypass.test.ts`
 * enforces from the OTHER direction (writers.ts imports ONLY actions
 * + types + zod + server-only).
 */
import { describe, it, expect } from "vitest"
import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"

const AI_ASSISTANT_DIR = join(process.cwd(), "src/modules/ai-assistant")

/**
 * THE FORBIDDEN-IMPORT MATRIX
 *
 * Some Drizzle imports are unavoidable in this module (the schema file
 * for the messages table; the rate-limit file for counting messages on
 * the AI's OWN table; the action file for inserting transcript rows).
 * These are NOT a privileged write path against client data — they
 * operate on `ai_assistant_messages` alone, which exists to record the
 * AI's transcript.
 *
 * What MUST be enforced is:
 *   - `retrievers.ts` MUST NOT import drizzle / @/db / @/lib/db /
 *     @/modules/*\/schema. Reads MUST go through @/modules/*\/queries.
 *   - `writers.ts` is the ONLY file in this module permitted to
 *     import @/modules/*\/actions. Every other file (including
 *     `actions.ts` and `validate.ts`) is blocked from reaching another
 *     module's orgAction surface; writes must route through the
 *     writers.ts allowlist + an explicit human `confirmWriteProposal`.
 */

interface ForbiddenRule {
  fileMatch: (relPath: string) => boolean
  pattern: RegExp
  description: string
}

const FORBIDDEN_RULES: ForbiddenRule[] = [
  // (1) retrievers.ts must not bypass queries.ts
  {
    fileMatch: (p) => p.endsWith("/retrievers.ts"),
    pattern: /from\s+["']drizzle-orm["']/,
    description: "retrievers.ts may not import drizzle-orm directly",
  },
  {
    fileMatch: (p) => p.endsWith("/retrievers.ts"),
    pattern: /from\s+["']drizzle-orm\//,
    description: "retrievers.ts may not import drizzle-orm subpaths directly",
  },
  {
    fileMatch: (p) => p.endsWith("/retrievers.ts"),
    pattern: /from\s+["']@\/db["']/,
    description: "retrievers.ts may not import @/db directly",
  },
  {
    fileMatch: (p) => p.endsWith("/retrievers.ts"),
    pattern: /from\s+["']@\/db\//,
    description: "retrievers.ts may not import @/db/* directly",
  },
  {
    fileMatch: (p) => p.endsWith("/retrievers.ts"),
    pattern: /from\s+["']@\/lib\/db["']/,
    description: "retrievers.ts may not import @/lib/db directly",
  },
  {
    fileMatch: (p) => p.endsWith("/retrievers.ts"),
    pattern: /from\s+["']@\/modules\/[^"']+\/schema["']/,
    description: "retrievers.ts may not import module schemas",
  },
  // (2) In 17b: writers.ts is the ONLY file in this module that may
  //     import @/modules/*\/actions. The dedicated Zone-1 test
  //     `ai-assistant-privileged-write-bypass.test.ts` enforces both
  //     directions (no other file imports actions; writers.ts ONLY
  //     imports actions + types).
  {
    fileMatch: (p) => !p.endsWith("/writers.ts"),
    pattern: /from\s+["']@\/modules\/[^"']+\/actions["']/,
    description:
      "Only writers.ts may import @/modules/*/actions. Every other file must go through queries.ts (reads) or the writers.ts allowlist (writes).",
  },
]

async function* walkTsFiles(dir: string): AsyncGenerator<string> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const full = join(dir, name)
    const s = await stat(full)
    if (s.isDirectory()) {
      yield* walkTsFiles(full)
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      yield full
    }
  }
}

describe("AI Assistant — no database-layer imports (Module 17a, hard gate)", () => {
  it("retrievers.ts contains no direct DB-layer imports; no file imports @/modules/*/actions", async () => {
    const offenders: { file: string; line: number; text: string; rule: string }[] = []
    for await (const file of walkTsFiles(AI_ASSISTANT_DIR)) {
      const relPath = file.slice(process.cwd().length)
      const content = await readFile(file, "utf8")
      const lines = content.split("\n")
      for (const [idx, line] of lines.entries()) {
        for (const rule of FORBIDDEN_RULES) {
          if (!rule.fileMatch(relPath)) continue
          if (rule.pattern.test(line)) {
            offenders.push({
              file: relPath,
              line: idx + 1,
              text: line.trim(),
              rule: rule.description,
            })
          }
        }
      }
    }
    if (offenders.length > 0) {
      const summary = offenders
        .map((o) => `  ${o.file}:${String(o.line)}: ${o.text}\n    → ${o.rule}`)
        .join("\n")
      throw new Error(`AI Assistant module forbidden imports:\n${summary}`)
    }
    expect(offenders.length).toBe(0)
  })

  it("writers.ts exists in src/modules/ai-assistant/ (17b — the orgAction allowlist)", async () => {
    // 17a's negative assertion (writers.ts does NOT exist) flips to a
    // positive assertion in 17b: writers.ts IS the file. The
    // dedicated Zone-1 suite proves it imports ONLY @/modules/*/actions
    // and @/modules/*/types.
    const entries = await readdir(AI_ASSISTANT_DIR).catch(() => [] as string[])
    expect(entries.includes("writers.ts")).toBe(true)
  })
})
