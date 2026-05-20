/**
 * Zone 1 — Privileged-write bypass (Module 17b).
 *
 * The structural posture of 17b is that EXACTLY ONE file in the AI
 * assistant module —`writers.ts` — may import `@/modules/<x>/actions`.
 * Every other file (queries-based reads, retrievers, route catalog,
 * validate, render, actions glue) is mathematically incapable of
 * invoking an orgAction.
 *
 * This Zone-1 suite enforces that posture from BOTH directions:
 *
 *   (a) NO file other than writers.ts imports @/modules/<x>/actions.
 *       (`ai-assistant-no-db-imports.test.ts` also covers this; we
 *        duplicate here so the danger-zone signal is co-located.)
 *
 *   (b) `writers.ts` imports ONLY from @/modules/<x>/actions,
 *       @/modules/<x>/types, "zod", and "server-only". Importing
 *       anything else (e.g. @/db, drizzle, @/lib/db, a module's
 *       schema or queries) would be a covert write back-channel.
 *
 *   (c) The runtime validator rejects writers that are NOT in the V1
 *       allowlist — rawSqlExec, deleteContact, deleteProject. The
 *       allowlist is intentionally narrow; destructive deletes are
 *       deferred to a future commit with type-name-to-confirm
 *       friction.
 */
import { describe, it, expect } from "vitest"
import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { validateAssistantOutput } from "@/modules/ai-assistant/validate"

const AI_ASSISTANT_DIR = join(process.cwd(), "src/modules/ai-assistant")

async function* walkTs(dir: string): AsyncGenerator<string> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const full = join(dir, name)
    const s = await stat(full)
    if (s.isDirectory()) yield* walkTs(full)
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) yield full
  }
}

describe("Zone 1 — privileged-write bypass: directional static-grep", () => {
  it("NO file other than writers.ts imports @/modules/<x>/actions", async () => {
    const offenders: string[] = []
    const pattern = /from\s+["']@\/modules\/[^"']+\/actions["']/
    for await (const file of walkTs(AI_ASSISTANT_DIR)) {
      const rel = file.slice(process.cwd().length)
      if (rel.endsWith("/writers.ts")) continue
      const content = await readFile(file, "utf8")
      const lines = content.split("\n")
      for (const [idx, line] of lines.entries()) {
        if (pattern.test(line)) {
          offenders.push(`${rel}:${String(idx + 1)}: ${line.trim()}`)
        }
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `Only writers.ts may import @/modules/<x>/actions; found offenders:\n${offenders.join("\n")}`,
      )
    }
    expect(offenders.length).toBe(0)
  })

  it("writers.ts imports ONLY @/modules/<x>/actions, @/modules/<x>/types, zod, server-only", async () => {
    const writersPath = join(AI_ASSISTANT_DIR, "writers.ts")
    const content = await readFile(writersPath, "utf8")
    const importLine = /^\s*import\s+.+?from\s+["']([^"']+)["']/
    const bareImport = /^\s*import\s+["']([^"']+)["']/
    const allowed = new Set<string>(["zod", "server-only"])
    const allowedPattern = /^@\/modules\/[^/]+\/(actions|types)$/
    const lines = content.split("\n")
    const offenders: { line: number; source: string }[] = []
    for (const [idx, line] of lines.entries()) {
      const m = importLine.exec(line) ?? bareImport.exec(line)
      if (!m) continue
      const source = m[1]
      if (source === undefined) continue
      if (allowed.has(source)) continue
      if (allowedPattern.test(source)) continue
      offenders.push({ line: idx + 1, source })
    }
    if (offenders.length > 0) {
      const summary = offenders.map((o) => `  L${String(o.line)}: ${o.source}`).join("\n")
      throw new Error(
        `writers.ts must import only @/modules/<x>/actions, @/modules/<x>/types, zod, server-only.\nUnexpected imports:\n${summary}`,
      )
    }
    expect(offenders.length).toBe(0)
  })
})

describe("Zone 1 — privileged-write bypass: runtime validator rejects non-allowlisted writers", () => {
  it("rejects write_proposal with action='rawSqlExec' (not in V1 allowlist)", () => {
    const result = validateAssistantOutput({
      kind: "write_proposal",
      action: "rawSqlExec",
      input: { sql: "DROP TABLE contacts" },
      summaryForUser: "Try to drop a table.",
    })
    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.errors.some((e) => e.type === "writer_name")).toBe(true)
    }
  })

  it("rejects write_proposal with action='deleteContact' (excluded from V1)", () => {
    const result = validateAssistantOutput({
      kind: "write_proposal",
      action: "deleteContact",
      input: { id: "c1" },
      summaryForUser: "Delete the contact.",
    })
    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.errors.some((e) => e.type === "writer_name")).toBe(true)
    }
  })

  it("rejects write_proposal with action='deleteProject' (excluded from V1)", () => {
    const result = validateAssistantOutput({
      kind: "write_proposal",
      action: "deleteProject",
      input: { id: "p1" },
      summaryForUser: "Delete the project.",
    })
    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.errors.some((e) => e.type === "writer_name")).toBe(true)
    }
  })
})
