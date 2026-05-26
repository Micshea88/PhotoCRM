/**
 * Push 2c / 2c.1 — inline CSV parser + import-spec helpers.
 *
 * The contacts import flow ships its own minimal RFC-4180-style parser
 * (papaparse was scoped but never landed as a dep). These tests pin
 * the parser's behavior against the rough corners that ALWAYS break
 * naive CSV implementations, plus the 2c.1 expansion: smart-match
 * aliases, full-name auto-split, validation hints, CSV-internal
 * duplicate detection, lifecycle-status case-insensitive matching,
 * multi-tag parsing, and field-type sniffing.
 */

import { describe, it, expect } from "vitest"
import {
  autoMapHeaders,
  buildCleanRow,
  buildErrorsCsv,
  CSV_MAX_ROWS,
  detectFieldType,
  detectionAgreesWithMapping,
  findCsvInternalDuplicates,
  firstNonEmptySample,
  normalizePhone,
  parseCsv,
  parseTagsCell,
  splitFullName,
} from "@/modules/contacts/import-spec"

describe("parseCsv", () => {
  it("parses a simple header + 2 rows with LF endings", () => {
    const text = "first,last,email\nAda,Lovelace,ada@example.com\nGrace,Hopper,grace@example.com"
    const r = parseCsv(text)
    expect(r.headers).toEqual(["first", "last", "email"])
    expect(r.rows).toEqual([
      ["Ada", "Lovelace", "ada@example.com"],
      ["Grace", "Hopper", "grace@example.com"],
    ])
  })

  it("handles CRLF endings (Excel default)", () => {
    const text = "a,b\r\n1,2\r\n3,4\r\n"
    const r = parseCsv(text)
    expect(r.headers).toEqual(["a", "b"])
    expect(r.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ])
  })

  it("handles UTF-8 BOM at start of file", () => {
    const text = "﻿first,last\nAda,Lovelace"
    const r = parseCsv(text)
    expect(r.headers).toEqual(["first", "last"])
    expect(r.rows).toEqual([["Ada", "Lovelace"]])
  })

  it("handles quoted fields with embedded commas", () => {
    const text = 'name,address\n"Lovelace, Ada","London, UK"'
    const r = parseCsv(text)
    expect(r.rows[0]).toEqual(["Lovelace, Ada", "London, UK"])
  })

  it("handles escaped quotes inside quoted fields", () => {
    const text = 'name,note\n"Ada","She said ""hi"""'
    const r = parseCsv(text)
    expect(r.rows[0]).toEqual(["Ada", 'She said "hi"'])
  })

  it("handles embedded newlines inside quoted fields", () => {
    const text = 'name,note\n"Ada","line1\nline2"'
    const r = parseCsv(text)
    expect(r.rows[0]).toEqual(["Ada", "line1\nline2"])
  })

  it("tolerates missing trailing newline", () => {
    const text = "a,b\n1,2"
    const r = parseCsv(text)
    expect(r.rows).toEqual([["1", "2"]])
  })

  it("filters out completely blank lines", () => {
    const text = "a,b\n1,2\n\n3,4\n"
    const r = parseCsv(text)
    expect(r.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ])
  })

  it("CSV_MAX_ROWS pinned at 10,000", () => {
    expect(CSV_MAX_ROWS).toBe(10000)
  })
})

describe("autoMapHeaders — smart match (Push 2c.1)", () => {
  it("matches HubSpot / Mailchimp common headers across vendors", () => {
    expect(
      autoMapHeaders(["E-mail", "First_Name", "Last Name", "Mobile Phone #", "Company Name"]),
    ).toEqual(["primaryEmail", "firstName", "lastName", "primaryPhone", "companyName"])
  })

  it("matches Organisation (UK spelling) and Organization (US)", () => {
    expect(autoMapHeaders(["Organisation"])).toEqual(["companyName"])
    expect(autoMapHeaders(["Organization"])).toEqual(["companyName"])
  })

  it("matches Full Name as the fullName pseudo-field", () => {
    expect(autoMapHeaders(["Full Name", "Contact Name", "Name"])).toEqual([
      "fullName",
      "fullName",
      "fullName",
    ])
  })

  it("matches Lifecycle Stage (HubSpot) and Lifecycle Status (Pathway)", () => {
    expect(autoMapHeaders(["Lifecycle Stage", "Lifecycle Status"])).toEqual([
      "lifecycleStatus",
      "lifecycleStatus",
    ])
  })

  it("returns null for unrecognized headers", () => {
    expect(autoMapHeaders(["mystery_field", "favorite_color"])).toEqual([null, null])
  })

  it("matches case-insensitively + ignores punctuation/whitespace", () => {
    expect(autoMapHeaders(["E-MAIL ADDRESS", "lifecycle/stage", "  WEBSITE  "])).toEqual([
      "primaryEmail",
      "lifecycleStatus",
      "website",
    ])
  })

  it("matches owner-email aliases (Push 2c.1)", () => {
    expect(autoMapHeaders(["Owner", "Contact Owner", "Assigned To", "Sales Rep"])).toEqual([
      "ownerUserId",
      "ownerUserId",
      "ownerUserId",
      "ownerUserId",
    ])
  })
})

describe("splitFullName (Push 2c.1)", () => {
  it("splits on the first space", () => {
    expect(splitFullName("Ada Lovelace")).toEqual({ firstName: "Ada", lastName: "Lovelace" })
  })

  it("groups three+ words after the first into lastName", () => {
    expect(splitFullName("Jane Mary Doe")).toEqual({ firstName: "Jane", lastName: "Mary Doe" })
    expect(splitFullName("María José García López")).toEqual({
      firstName: "María",
      lastName: "José García López",
    })
  })

  it("handles single-word names (lastName empty)", () => {
    expect(splitFullName("Cher")).toEqual({ firstName: "Cher", lastName: "" })
  })

  it("tolerates trailing/leading whitespace", () => {
    expect(splitFullName("  Ada Lovelace  ")).toEqual({ firstName: "Ada", lastName: "Lovelace" })
    expect(splitFullName("Ada Lovelace ")).toEqual({ firstName: "Ada", lastName: "Lovelace" })
  })

  it("empty input → empty halves", () => {
    expect(splitFullName("")).toEqual({ firstName: "", lastName: "" })
    expect(splitFullName("   ")).toEqual({ firstName: "", lastName: "" })
  })
})

describe("buildCleanRow", () => {
  it("requires at least one identifier (fullName / lastName / primaryEmail)", () => {
    const row = buildCleanRow(2, ["", ""], ["firstName", "lastName"])
    expect(row.errors).toContain(
      "Row has no first name, last name, or email — nothing to identify the contact",
    )
  })

  it("populates first/last from fullName auto-split when mapped", () => {
    const row = buildCleanRow(2, ["Ada Lovelace"], ["fullName"])
    expect(row.errors).toEqual([])
    expect(row.values.firstName).toBe("Ada")
    expect(row.values.lastName).toBe("Lovelace")
  })

  it("explicit firstName / lastName win over fullName split", () => {
    const row = buildCleanRow(
      2,
      ["Jane Doe", "Adalovelace", "Smith"],
      ["fullName", "firstName", "lastName"],
    )
    expect(row.values.firstName).toBe("Adalovelace")
    expect(row.values.lastName).toBe("Smith")
  })

  it("fullName fills missing half but doesn't overwrite present half", () => {
    const row = buildCleanRow(2, ["Ada Lovelace", "Grace"], ["fullName", "firstName"])
    expect(row.values.firstName).toBe("Grace")
    expect(row.values.lastName).toBe("Lovelace")
  })

  it("email-only rows are importable (warning, not error)", () => {
    const row = buildCleanRow(2, ["", "ada@example.com"], ["firstName", "primaryEmail"])
    expect(row.errors).toEqual([])
    // No error, but the build path will default firstName to Unknown.
  })

  it("invalid email surfaces as warning, not error (row still imports)", () => {
    const row = buildCleanRow(
      2,
      ["Ada", "Lovelace", "not-an-email"],
      ["firstName", "lastName", "primaryEmail"],
    )
    expect(row.errors).toEqual([])
    expect(row.warnings.some((w) => w.includes("primaryEmail"))).toBe(true)
    expect(row.values.primaryEmail).toBeUndefined()
  })

  it("valid email + URL pass through cleanly", () => {
    const row = buildCleanRow(
      2,
      ["Ada", "Lovelace", "ada@example.com", "https://example.com"],
      ["firstName", "lastName", "primaryEmail", "website"],
    )
    expect(row.errors).toEqual([])
    expect(row.warnings).toEqual([])
    expect(row.values).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      primaryEmail: "ada@example.com",
      website: "https://example.com",
    })
  })

  it("case-insensitive lifecycleStatus match folds to canonical case", () => {
    const row = buildCleanRow(
      2,
      ["Ada", "Lovelace", "active"],
      ["firstName", "lastName", "lifecycleStatus"],
    )
    expect(row.values.lifecycleStatus).toBe("Active")
    expect(row.warnings).toEqual([])
  })

  it("ALL-CAPS lifecycleStatus also folds", () => {
    const row = buildCleanRow(
      2,
      ["Ada", "Lovelace", "VIP"],
      ["firstName", "lastName", "lifecycleStatus"],
    )
    expect(row.values.lifecycleStatus).toBe("VIP")
  })

  it("unknown lifecycleStatus → warning + drop", () => {
    const row = buildCleanRow(
      2,
      ["Ada", "Lovelace", "Customer"],
      ["firstName", "lastName", "lifecycleStatus"],
    )
    expect(row.warnings.some((w) => w.includes("lifecycleStatus"))).toBe(true)
    expect(row.values.lifecycleStatus).toBeUndefined()
  })

  it("ignores null-mapped columns even if they hold data", () => {
    const row = buildCleanRow(
      2,
      ["Ada", "Lovelace", "should-be-ignored"],
      ["firstName", "lastName", null],
    )
    expect(row.values).toEqual({ firstName: "Ada", lastName: "Lovelace" })
  })
})

describe("normalizePhone", () => {
  it("strips non-digits", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("5551234567")
    expect(normalizePhone("+1 555.123.4567")).toBe("15551234567")
  })

  it("returns null for empty / whitespace / null", () => {
    expect(normalizePhone("")).toBeNull()
    expect(normalizePhone("   ")).toBeNull()
    expect(normalizePhone(null)).toBeNull()
    expect(normalizePhone(undefined)).toBeNull()
  })
})

describe("parseTagsCell — multi-separator (Push 2c.1)", () => {
  it("splits on commas", () => {
    expect(parseTagsCell("vip, hot lead, 2024")).toEqual(["vip", "hot lead", "2024"])
  })

  it("splits on semicolons (HubSpot export)", () => {
    expect(parseTagsCell("vip;hot lead;2024")).toEqual(["vip", "hot lead", "2024"])
  })

  it("mixes commas and semicolons", () => {
    expect(parseTagsCell("vip, hot; lead;2024")).toEqual(["vip", "hot", "lead", "2024"])
  })

  it("drops empty / oversize tokens", () => {
    expect(parseTagsCell(", , vip,  ,")).toEqual(["vip"])
  })
})

describe("findCsvInternalDuplicates (Push 2c.1)", () => {
  it("flags subsequent rows that share an email with an earlier row", () => {
    const rows = [
      mkRow(1, { primaryEmail: "ada@example.com" }),
      mkRow(2, { primaryEmail: "grace@example.com" }),
      mkRow(3, { primaryEmail: "ada@example.com" }),
      mkRow(4, { primaryEmail: "ada@example.com" }),
    ]
    const dupes = findCsvInternalDuplicates(rows)
    expect(dupes.get(1)).toBeUndefined() // first occurrence wins
    expect(dupes.get(2)).toBeUndefined()
    expect(dupes.get(3)).toBe(1)
    expect(dupes.get(4)).toBe(1)
  })

  it("ignores rows without email", () => {
    const rows = [mkRow(1, { firstName: "Ada" }), mkRow(2, { firstName: "Grace" })]
    expect(findCsvInternalDuplicates(rows).size).toBe(0)
  })

  it("case-insensitive email match", () => {
    const rows = [
      mkRow(1, { primaryEmail: "Ada@Example.com" }),
      mkRow(2, { primaryEmail: "ada@example.com" }),
    ]
    expect(findCsvInternalDuplicates(rows).get(2)).toBe(1)
  })
})

describe("detectFieldType (Push 2c.1)", () => {
  it("detects emails when ≥60% of samples match", () => {
    expect(detectFieldType(["a@b.com", "c@d.com", "e@f.com"])).toBe("email")
  })

  it("detects phones from digit-heavy samples", () => {
    expect(detectFieldType(["(555) 123-4567", "555-123-4567", "5551234567"])).toBe("phone")
  })

  it("detects dates (ISO + MM/DD/YYYY)", () => {
    expect(detectFieldType(["2024-01-15", "2024-02-15", "2024-03-15"])).toBe("date")
    expect(detectFieldType(["1/15/2024", "2/15/2024", "3/15/2024"])).toBe("date")
  })

  it("detects URLs", () => {
    expect(detectFieldType(["https://example.com", "https://acme.org"])).toBe("url")
  })

  it("returns null on mixed / unrecognized samples", () => {
    expect(detectFieldType(["Ada", "Grace", "Cher"])).toBe(null)
    expect(detectFieldType([])).toBe(null)
  })
})

describe("detectionAgreesWithMapping (Push 2c.1)", () => {
  it("null detection / null mapping → always agrees (no warning)", () => {
    expect(detectionAgreesWithMapping(null, "firstName")).toBe(true)
    expect(detectionAgreesWithMapping("email", null)).toBe(true)
  })

  it("email-detected disagrees with firstName mapping", () => {
    expect(detectionAgreesWithMapping("email", "firstName")).toBe(false)
  })

  it("email-detected agrees with primaryEmail / secondaryEmail / ownerUserId", () => {
    expect(detectionAgreesWithMapping("email", "primaryEmail")).toBe(true)
    expect(detectionAgreesWithMapping("email", "secondaryEmail")).toBe(true)
    expect(detectionAgreesWithMapping("email", "ownerUserId")).toBe(true)
  })

  it("phone-detected agrees with primaryPhone / secondaryPhone", () => {
    expect(detectionAgreesWithMapping("phone", "primaryPhone")).toBe(true)
    expect(detectionAgreesWithMapping("phone", "secondaryPhone")).toBe(true)
    expect(detectionAgreesWithMapping("phone", "firstName")).toBe(false)
  })

  it("date-detected always disagrees (no date-shaped contact field in V1)", () => {
    expect(detectionAgreesWithMapping("date", "notes")).toBe(false)
    expect(detectionAgreesWithMapping("date", "firstName")).toBe(false)
  })

  it("fullName mapping is permissive — never warns", () => {
    expect(detectionAgreesWithMapping("email", "fullName")).toBe(true)
    expect(detectionAgreesWithMapping("phone", "fullName")).toBe(true)
  })
})

describe("firstNonEmptySample (Push 2c.1)", () => {
  it("returns the first non-empty value, trimmed", () => {
    const rows = [
      ["", "", ""],
      ["", "x", "y"],
      ["", "z", ""],
    ]
    expect(firstNonEmptySample(rows, 1)).toBe("x")
  })

  it("truncates with ellipsis past the max length", () => {
    const long = "a".repeat(60)
    expect(firstNonEmptySample([[long]], 0, 40)).toMatch(/^a+…$/)
    expect(firstNonEmptySample([[long]], 0, 40).length).toBe(40)
  })

  it("returns empty string when the column is entirely empty", () => {
    expect(firstNonEmptySample([["", ""]], 0)).toBe("")
  })
})

describe("buildErrorsCsv", () => {
  it("escapes fields containing commas, quotes, and newlines", () => {
    const csv = buildErrorsCsv(
      ["name", "note"],
      [{ rowIndex: 3, error: 'parse failed: "bad"', raw: ["Ada, Lovelace", "line1\nline2"] }],
    )
    const lines = csv.split("\n")
    expect(lines[0]).toBe("row,error,name,note")
    expect(lines[1]).toContain('"parse failed: ""bad"""')
    expect(lines[1]).toContain('"Ada, Lovelace"')
    expect(lines[1]).toContain('"line1')
  })
})

// ─── Test helpers ──────────────────────────────────────────────────────

function mkRow(
  rowIndex: number,
  values: Partial<Record<string, string>>,
): {
  rowIndex: number
  values: Record<string, string>
  customValues: Record<string, string>
  errors: string[]
  warnings: string[]
} {
  const v: Record<string, string> = {}
  for (const [k, val] of Object.entries(values)) if (val !== undefined) v[k] = val
  return { rowIndex, values: v, customValues: {}, errors: [], warnings: [] }
}
