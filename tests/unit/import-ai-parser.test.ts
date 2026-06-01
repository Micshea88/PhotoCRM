/**
 * CSV Import V2 — AI column-scan parser hardening tests.
 *
 * The parser is the trust boundary between Haiku's output and the
 * wizard's mapping state. These tests pin the invariants Mike
 * specified:
 *   1. Every returned target validated against the allow-list; any
 *      unknown / hallucinated value collapses to "skip" (never
 *      silently maps to a wrong field).
 *   2. Malformed JSON / non-JSON / wrong-shape responses → all-skip
 *      fallback so the wizard falls through to manual mapping.
 *   3. confidence is parsed but never auto-promotes; bad values
 *      default to "low".
 *   4. No path throws — always returns one suggestion per header.
 */
import { describe, it, expect } from "vitest"
import {
  buildAllowedTargets,
  buildSystemPrompt,
  buildUserPrompt,
  parseColumnScanResponse,
} from "@/modules/contacts/import-ai-parser"

const HEADERS = ["First Name", "Email", "Some Garbage", "Notes"]

function allowed(): Set<string> {
  return buildAllowedTargets([
    { id: "cf-allergies", name: "Allergies", fieldType: "text", archivedAt: null },
    { id: "cf-archived", name: "Old", fieldType: "text", archivedAt: new Date() },
  ])
}

describe("parseColumnScanResponse — happy path", () => {
  it("returns one suggestion per header, validates each target against the allow-list", () => {
    const raw = JSON.stringify({
      suggestions: [
        { column: "First Name", target: "firstName", confidence: "high" },
        { column: "Email", target: "primaryEmail", confidence: "high" },
        { column: "Some Garbage", target: "skip", confidence: "low" },
        { column: "Notes", target: "cf:cf-allergies", confidence: "medium" },
      ],
    })
    const r = parseColumnScanResponse(raw, HEADERS, allowed())
    expect(r.ok).toBe(true)
    expect(r.suggestions).toHaveLength(4)
    expect(r.suggestions[0]).toEqual({
      column: "First Name",
      target: "firstName",
      confidence: "high",
    })
    expect(r.suggestions[3]?.target).toBe("cf:cf-allergies")
  })

  it("accepts code-fenced JSON (Haiku sometimes wraps in ```json …```)", () => {
    const raw =
      "```json\n" +
      JSON.stringify({
        suggestions: [{ column: "First Name", target: "firstName", confidence: "high" }],
      }) +
      "\n```"
    const r = parseColumnScanResponse(raw, ["First Name"], allowed())
    expect(r.ok).toBe(true)
    expect(r.suggestions[0]?.target).toBe("firstName")
  })

  it("accepts a leading prose preamble before the first {", () => {
    const raw =
      "Here are the suggestions:\n" +
      JSON.stringify({
        suggestions: [{ column: "Email", target: "primaryEmail", confidence: "high" }],
      })
    const r = parseColumnScanResponse(raw, ["Email"], allowed())
    expect(r.ok).toBe(true)
    expect(r.suggestions[0]?.target).toBe("primaryEmail")
  })
})

describe("parseColumnScanResponse — hardening (the load-bearing tests)", () => {
  it("hallucinated target → silently coerced to 'skip', NEVER a wrong-field map", () => {
    const raw = JSON.stringify({
      suggestions: [
        { column: "First Name", target: "first_name_made_up", confidence: "high" },
        { column: "Email", target: "primaryEmail", confidence: "high" },
        // cf:cf-archived is on the org but ARCHIVED → not in the
        // allow-list → must collapse to "skip"
        { column: "Some Garbage", target: "cf:cf-archived", confidence: "high" },
        // cf:cf-nonexistent — invented custom field id
        { column: "Notes", target: "cf:cf-nonexistent", confidence: "high" },
      ],
    })
    const r = parseColumnScanResponse(raw, HEADERS, allowed())
    expect(r.suggestions[0]?.target).toBe("skip")
    expect(r.suggestions[1]?.target).toBe("primaryEmail") // valid stays valid
    expect(r.suggestions[2]?.target).toBe("skip")
    expect(r.suggestions[3]?.target).toBe("skip")
    // ok is true because one valid (non-skip) suggestion came through.
    expect(r.ok).toBe(true)
  })

  it("non-JSON garbage response → all-skip fallback, ok=false", () => {
    const r = parseColumnScanResponse(
      "I don't think I can map these columns sorry",
      HEADERS,
      allowed(),
    )
    expect(r.ok).toBe(false)
    expect(r.suggestions).toHaveLength(4)
    for (const s of r.suggestions) expect(s.target).toBe("skip")
  })

  it("empty string response → all-skip fallback, ok=false", () => {
    const r = parseColumnScanResponse("", HEADERS, allowed())
    expect(r.ok).toBe(false)
    for (const s of r.suggestions) expect(s.target).toBe("skip")
  })

  it("JSON with the wrong shape (no 'suggestions' key) → all-skip fallback", () => {
    const r = parseColumnScanResponse(
      JSON.stringify({ otherKey: [{ column: "Email", target: "primaryEmail" }] }),
      HEADERS,
      allowed(),
    )
    expect(r.ok).toBe(false)
    for (const s of r.suggestions) expect(s.target).toBe("skip")
  })

  it("JSON where 'suggestions' is not an array → all-skip fallback", () => {
    const r = parseColumnScanResponse(
      JSON.stringify({ suggestions: "this should be an array" }),
      HEADERS,
      allowed(),
    )
    expect(r.ok).toBe(false)
    for (const s of r.suggestions) expect(s.target).toBe("skip")
  })

  it("missing or null required keys on individual entries → that entry skipped (becomes 'skip')", () => {
    const raw = JSON.stringify({
      suggestions: [
        { column: "First Name", target: "firstName", confidence: "high" },
        { column: null, target: "primaryEmail", confidence: "high" }, // bad column
        { target: "primaryEmail", confidence: "high" }, // missing column
        { column: "Notes" }, // missing target
      ],
    })
    const r = parseColumnScanResponse(raw, HEADERS, allowed())
    // Header[0] First Name → firstName (valid entry survives)
    expect(r.suggestions[0]?.target).toBe("firstName")
    // Other headers had no usable entry → "skip"
    expect(r.suggestions[1]?.target).toBe("skip")
    expect(r.suggestions[2]?.target).toBe("skip")
    expect(r.suggestions[3]?.target).toBe("skip")
  })

  it("bogus confidence value → coerced to 'low' (display-only, never auto-confirms)", () => {
    const raw = JSON.stringify({
      suggestions: [
        { column: "First Name", target: "firstName", confidence: "VERY_SURE" },
        { column: "Email", target: "primaryEmail", confidence: 0.99 },
      ],
    })
    const r = parseColumnScanResponse(raw, ["First Name", "Email"], allowed())
    expect(r.suggestions[0]?.confidence).toBe("low")
    expect(r.suggestions[1]?.confidence).toBe("low")
    // Targets still valid — only confidence was bogus.
    expect(r.suggestions[0]?.target).toBe("firstName")
    expect(r.suggestions[1]?.target).toBe("primaryEmail")
  })

  it("missing header in the AI response → fills in 'skip' for that header", () => {
    const raw = JSON.stringify({
      suggestions: [{ column: "First Name", target: "firstName", confidence: "high" }],
      // No entry for Email / Some Garbage / Notes
    })
    const r = parseColumnScanResponse(raw, HEADERS, allowed())
    expect(r.suggestions).toHaveLength(4)
    expect(r.suggestions[0]?.target).toBe("firstName")
    expect(r.suggestions[1]?.target).toBe("skip")
    expect(r.suggestions[2]?.target).toBe("skip")
    expect(r.suggestions[3]?.target).toBe("skip")
  })

  it("header-match tolerates trailing whitespace (Haiku echoing a header with extra spaces)", () => {
    const raw = JSON.stringify({
      suggestions: [
        { column: "First Name  ", target: "firstName", confidence: "high" },
        { column: " Email", target: "primaryEmail", confidence: "high" },
      ],
    })
    const r = parseColumnScanResponse(raw, ["First Name", "Email"], allowed())
    expect(r.ok).toBe(true)
    expect(r.suggestions[0]?.target).toBe("firstName")
    expect(r.suggestions[1]?.target).toBe("primaryEmail")
    // OUTPUT column uses the INPUT header verbatim — the user sees
    // their own CSV header text, not the AI's whitespace-mutated one.
    expect(r.suggestions[0]?.column).toBe("First Name")
    expect(r.suggestions[1]?.column).toBe("Email")
  })

  it("header-match tolerates smart quotes (curly apostrophe in echoed header)", () => {
    // Input header has a straight apostrophe (U+0027); AI response
    // has the curly right single quote (U+2019). Without normalization
    // the lookup would miss and the column would drop to skip.
    const raw = JSON.stringify({
      suggestions: [{ column: "O’Connell ID", target: "skip", confidence: "low" }],
    })
    const r = parseColumnScanResponse(raw, ["O'Connell ID"], allowed())
    expect(r.suggestions[0]?.column).toBe("O'Connell ID")
    expect(r.suggestions[0]?.target).toBe("skip")
  })

  it("header-match is case-insensitive (model lowercased the echo)", () => {
    const raw = JSON.stringify({
      suggestions: [{ column: "first name", target: "firstName", confidence: "high" }],
    })
    const r = parseColumnScanResponse(raw, ["First Name"], allowed())
    expect(r.suggestions[0]?.target).toBe("firstName")
    expect(r.suggestions[0]?.column).toBe("First Name")
  })

  it("a genuinely different header (not the same column at all) still drops to 'skip'", () => {
    // Conservative default: normalization absorbs cosmetic drift, not
    // semantic drift. If the AI returns a header that just isn't in
    // the input set, we don't try to fuzzy-match it.
    const raw = JSON.stringify({
      suggestions: [{ column: "Telephone", target: "primaryPhone", confidence: "high" }],
    })
    const r = parseColumnScanResponse(raw, ["Mobile"], allowed())
    expect(r.suggestions[0]?.target).toBe("skip")
  })

  it("'skip' and 'create_new' are explicitly in the allow-list and pass through", () => {
    const raw = JSON.stringify({
      suggestions: [
        { column: "First Name", target: "skip", confidence: "low" },
        { column: "Email", target: "create_new", confidence: "medium" },
      ],
    })
    const r = parseColumnScanResponse(raw, ["First Name", "Email"], allowed())
    expect(r.suggestions[0]?.target).toBe("skip")
    expect(r.suggestions[1]?.target).toBe("create_new")
  })
})

describe("buildAllowedTargets", () => {
  it("includes intrinsic IMPORTABLE_FIELDS + active cf:<id> + 'skip' + 'create_new'", () => {
    const set = buildAllowedTargets([
      { id: "abc", name: "Active", fieldType: "text", archivedAt: null },
      { id: "xyz", name: "Archived", fieldType: "text", archivedAt: new Date() },
    ])
    expect(set.has("firstName")).toBe(true)
    expect(set.has("primaryEmail")).toBe(true)
    expect(set.has("cf:abc")).toBe(true)
    // Archived defs are intentionally excluded from suggestions.
    expect(set.has("cf:xyz")).toBe(false)
    expect(set.has("skip")).toBe(true)
    expect(set.has("create_new")).toBe(true)
  })
})

describe("prompt builders — smoke", () => {
  it("system prompt lists intrinsic ids and any active custom fields", () => {
    const sys = buildSystemPrompt([
      { id: "abc", name: "Allergies", fieldType: "text", archivedAt: null },
      { id: "xyz", name: "Old", fieldType: "text", archivedAt: new Date() },
    ])
    expect(sys).toContain("firstName")
    expect(sys).toContain("primaryEmail")
    expect(sys).toContain('cf:abc — "Allergies"')
    expect(sys).not.toContain("cf:xyz") // archived excluded
    expect(sys).toContain("skip")
    expect(sys).toContain("create_new")
  })

  it("system prompt notes when org has no active custom fields", () => {
    const sys = buildSystemPrompt([])
    expect(sys).toContain("no active contact custom fields")
  })

  it("user prompt embeds headers + sample rows in a deterministic shape", () => {
    const usr = buildUserPrompt(
      ["First Name", "Email"],
      [
        ["Ada", "ada@example.com"],
        ["Bob", "bob@example.com"],
      ],
    )
    expect(usr).toContain('"First Name"')
    expect(usr).toContain('"Email"')
    expect(usr).toContain('Row 1: First Name="Ada", Email="ada@example.com"')
    expect(usr).toContain('Row 2: First Name="Bob", Email="bob@example.com"')
  })
})
