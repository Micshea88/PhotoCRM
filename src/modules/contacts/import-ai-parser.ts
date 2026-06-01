/**
 * CSV Import V2 — AI column-scan PURE LOGIC.
 *
 * No "use server", no DB, no AI SDK. Importable from unit tests and
 * from the orgAction file equally. Holds:
 *   - the hardened response parser
 *   - the allow-list builder
 *   - the system / user prompt builders
 *
 * The companion file `import-ai.ts` wraps these into the
 * `scanColumnsWithAi` orgAction. Splitting was forced by `import-ai.ts`'s
 * "use server" directive transitively pulling `@/lib/db` into the unit
 * test environment.
 */
import { IMPORTABLE_FIELDS, buildCustomFieldMapping, FIELD_LABELS } from "./import-spec"

export type ScanConfidence = "high" | "medium" | "low"

export interface ColumnScanSuggestion {
  /** The exact CSV header the model returned the suggestion for. */
  column: string
  /**
   * One of: an `IMPORTABLE_FIELDS` id, `cf:<custom_field_id>`, "skip",
   * or "create_new". Guaranteed by the parser to be in the org's
   * allow-list — never an arbitrary string.
   */
  target: string
  /** "high" | "medium" | "low". Display-only — never auto-confirms. */
  confidence: ScanConfidence
}

export interface CustomFieldDefForScan {
  id: string
  name: string
  fieldType: string
  archivedAt: Date | null
}

// ─── Hardened response parser ──────────────────────────────────────

/**
 * Pure function — no I/O, no exceptions escape.
 *
 * Strips code fences / wrapping prose / leading garbage that Haiku
 * occasionally emits, JSON.parses, walks the suggestions array, and
 * validates every (column, target, confidence) triple against the
 * exact allow-list passed in by the caller. Anything that doesn't
 * exactly fit collapses to a "skip" suggestion for that column.
 *
 * Always returns one suggestion per input header. Missing headers in
 * the AI response get "skip" with "low" confidence.
 */
export function parseColumnScanResponse(
  raw: string,
  headers: string[],
  allowedTargets: ReadonlySet<string>,
): { suggestions: ColumnScanSuggestion[]; ok: boolean } {
  const cleaned = stripJsonNoise(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return { suggestions: allSkipFallback(headers), ok: false }
  }
  if (!parsed || typeof parsed !== "object") {
    return { suggestions: allSkipFallback(headers), ok: false }
  }
  const root = parsed as Record<string, unknown>
  const arr = root.suggestions
  if (!Array.isArray(arr)) {
    return { suggestions: allSkipFallback(headers), ok: false }
  }

  // Build the response lookup keyed by a normalized form of the
  // column so cosmetic differences (trailing space, smart quotes,
  // case) don't silently drop a suggestion to skip. The OUTPUT
  // still uses the user's exact input header text — only the match
  // is normalization-aware.
  const byNormalized = new Map<string, { target: string; confidence: ScanConfidence }>()
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue
    const obj = entry as Record<string, unknown>
    const col = typeof obj.column === "string" ? obj.column : null
    const tgt = typeof obj.target === "string" ? obj.target : null
    const conf = typeof obj.confidence === "string" ? obj.confidence : null
    if (col === null || tgt === null) continue
    const safeTarget = allowedTargets.has(tgt) ? tgt : "skip"
    const safeConfidence: ScanConfidence =
      conf === "high" || conf === "medium" || conf === "low" ? conf : "low"
    byNormalized.set(normalizeHeaderForMatch(col), {
      target: safeTarget,
      confidence: safeConfidence,
    })
  }

  let validCount = 0
  const suggestions: ColumnScanSuggestion[] = headers.map((h) => {
    const s = byNormalized.get(normalizeHeaderForMatch(h))
    if (s) {
      if (s.target !== "skip") validCount++
      return { column: h, target: s.target, confidence: s.confidence }
    }
    return { column: h, target: "skip", confidence: "low" }
  })
  return { suggestions, ok: validCount > 0 }
}

/**
 * Normalize a header string for AI-response alignment. Handles the
 * common cosmetic drift Haiku introduces when echoing user-supplied
 * headers: trim, collapse internal whitespace, fold curly quotes to
 * ASCII, lowercase. Intentionally NOT a fully-Unicode-normalizing
 * function — we only need to absorb the small set of mutations real
 * models actually emit. A genuine mismatch (different header text)
 * still falls through to "skip" per the conservative default.
 */
function normalizeHeaderForMatch(s: string): string {
  return s
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function stripJsonNoise(raw: string): string {
  let s = raw.trim()
  // Haiku sometimes wraps the JSON in ```json … ``` fences.
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
  // Strip leading prose before the first { (e.g. "Sure, here's the JSON: {…}")
  const firstBrace = s.indexOf("{")
  if (firstBrace > 0) s = s.slice(firstBrace)
  return s.trim()
}

function allSkipFallback(headers: string[]): ColumnScanSuggestion[] {
  return headers.map((h) => ({ column: h, target: "skip", confidence: "low" }))
}

// ─── Allow-list builder ────────────────────────────────────────────

/**
 * Build the exact allow-list of mapping targets for THIS org. Includes
 * intrinsic IMPORTABLE_FIELDS, `cf:<id>` for every ACTIVE custom field
 * (archived defs are excluded so the AI doesn't suggest a hidden
 * field), and the two specials "skip" / "create_new".
 */
export function buildAllowedTargets(customFields: CustomFieldDefForScan[]): Set<string> {
  const allowed = new Set<string>(IMPORTABLE_FIELDS)
  for (const def of customFields) {
    if (def.archivedAt) continue
    allowed.add(buildCustomFieldMapping(def.id))
  }
  allowed.add("skip")
  allowed.add("create_new")
  return allowed
}

// ─── Prompt builders ───────────────────────────────────────────────

export function buildSystemPrompt(activeCustomFields: CustomFieldDefForScan[]): string {
  const intrinsicLines = IMPORTABLE_FIELDS.map((id) => `  ${id} — ${FIELD_LABELS[id]}`).join("\n")
  const cfLines = activeCustomFields
    .filter((d) => !d.archivedAt)
    .map((d) => `  cf:${d.id} — "${d.name}" [${d.fieldType}]`)
    .join("\n")
  const customSection = cfLines
    ? `\nCUSTOM FIELDS (this org's active contact custom fields — use "cf:<id>" verbatim):\n${cfLines}`
    : `\nCUSTOM FIELDS: (this org has no active contact custom fields yet)`

  return `You are a CSV column mapper for a CRM. The user uploaded a CSV of contacts to import. For each CSV column you see, suggest the best target field.

Allowed targets:

STANDARD CONTACT FIELDS (use the id on the left verbatim):
${intrinsicLines}
${customSection}

SPECIAL:
  skip          — column has no useful target (id columns, derived/internal fields, blank columns, audit metadata, etc.)
  create_new    — none of the above fits but the column looks worth creating a new custom field for

Rules:
- Reply with ONE JSON object. No prose, no code fences, no markdown.
- Emit exactly one suggestion per column the user provided.
- "target" MUST be one of the ids above verbatim. Do not invent target ids. If nothing fits, use "skip" or "create_new".
- "confidence" MUST be one of "high", "medium", "low".

Output schema (exact):
{
  "suggestions": [
    { "column": "<exact column header>", "target": "<id>", "confidence": "high" }
  ]
}`
}

export function buildUserPrompt(headers: string[], sampleRows: string[][]): string {
  const headerLine = JSON.stringify(headers)
  const rowLines = sampleRows
    .slice(0, 10)
    .map((row, i) => {
      const cells = headers.map((h, c) => `${h}=${JSON.stringify(row[c] ?? "")}`).join(", ")
      return `  Row ${String(i + 1)}: ${cells}`
    })
    .join("\n")
  return `Headers (in order): ${headerLine}

Sample rows (first ${String(Math.min(sampleRows.length, 10))} data rows):
${rowLines || "  (no sample rows provided)"}

Map each header above to a target id from the allowed list. Reply with the JSON object only.`
}
