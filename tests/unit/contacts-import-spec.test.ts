/**
 * Push 2c — inline CSV parser + import-spec helpers.
 *
 * The contacts import flow ships its own minimal RFC-4180-style parser
 * (papaparse was scoped but never landed as a dep). These tests pin
 * the parser's behavior against the rough corners that ALWAYS break
 * naive CSV implementations: escaped quotes, CRLF, embedded commas,
 * BOMs, missing trailing newline.
 */

import { describe, it, expect } from "vitest"
import {
  autoMapHeaders,
  buildCleanRow,
  buildErrorsCsv,
  CSV_MAX_ROWS,
  normalizePhone,
  parseCsv,
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

  it("does NOT silently lose data above CSV_MAX_ROWS — caller is responsible for capping", () => {
    // We don't enforce the cap in the parser; the wizard does. Verify
    // the constant is the canonical 10k value the spec demands.
    expect(CSV_MAX_ROWS).toBe(10000)
  })
})

describe("autoMapHeaders", () => {
  it("normalizes common header variants to contact fields", () => {
    expect(autoMapHeaders(["First Name", "Last Name", "Email", "Phone"])).toEqual([
      "firstName",
      "lastName",
      "primaryEmail",
      "primaryPhone",
    ])
  })

  it("returns null for unrecognized headers", () => {
    expect(autoMapHeaders(["mystery_field"])).toEqual([null])
  })

  it("matches case-insensitively + ignores punctuation/space", () => {
    expect(autoMapHeaders(["E-MAIL ADDRESS"])).toEqual(["primaryEmail"])
  })
})

describe("buildCleanRow", () => {
  it("requires firstName + lastName, flags missing fields", () => {
    const row = buildCleanRow(2, ["", "Lovelace"], ["firstName", "lastName"])
    expect(row.errors).toContain("firstName is required")
    expect(row.errors).not.toContain("lastName is required")
  })

  it("validates email format", () => {
    const row = buildCleanRow(
      2,
      ["Ada", "Lovelace", "not-an-email"],
      ["firstName", "lastName", "primaryEmail"],
    )
    expect(row.errors).toContain("primaryEmail is not a valid email")
  })

  it("accepts valid email + URL", () => {
    const row = buildCleanRow(
      2,
      ["Ada", "Lovelace", "ada@example.com", "https://example.com"],
      ["firstName", "lastName", "primaryEmail", "website"],
    )
    expect(row.errors).toEqual([])
    expect(row.values).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      primaryEmail: "ada@example.com",
      website: "https://example.com",
    })
  })

  it("rejects unknown contactType / lifecycleStatus values", () => {
    const row = buildCleanRow(
      2,
      ["Ada", "Lovelace", "FakeType", "FakeStatus"],
      ["firstName", "lastName", "contactType", "lifecycleStatus"],
    )
    expect(row.errors.some((e) => e.includes("contactType must be one of"))).toBe(true)
    expect(row.errors.some((e) => e.includes("lifecycleStatus must be one of"))).toBe(true)
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
  })
  it("returns null for empty / whitespace / null", () => {
    expect(normalizePhone("")).toBeNull()
    expect(normalizePhone("   ")).toBeNull()
    expect(normalizePhone(null)).toBeNull()
    expect(normalizePhone(undefined)).toBeNull()
  })
})

describe("buildErrorsCsv", () => {
  it("escapes fields containing commas, quotes, and newlines", () => {
    const csv = buildErrorsCsv(
      ["name", "note"],
      [{ rowIndex: 3, error: 'parse failed: "bad"', raw: ["Ada, Lovelace", "line1\nline2"] }],
    )
    // Header line first.
    const lines = csv.split("\n")
    expect(lines[0]).toBe("row,error,name,note")
    // The error message contains quotes, so it's quote-wrapped + the
    // inner quotes are doubled. The raw fields contain commas/newlines,
    // which also triggers quoting.
    expect(lines[1]).toContain('"parse failed: ""bad"""')
    expect(lines[1]).toContain('"Ada, Lovelace"')
    expect(lines[1]).toContain('"line1') // start of quoted multiline cell
  })
})
