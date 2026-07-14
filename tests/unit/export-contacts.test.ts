/**
 * Contacts export — CSV/XLSX formula-injection guard.
 *
 * Excel / Google Sheets / LibreOffice execute any cell whose first char is
 * a formula trigger (`=`, `+`, `@`, TAB, CR). Because exported contact fields
 * come from user / imported / external input, the export is the exact CSV
 * injection vector. These tests pin BOTH directions of the guard:
 *   - injection payloads are neutralized (apostrophe-prefixed)
 *   - legitimate data (negative numbers, ordinary strings) is left untouched
 * See AGENTS.md LAW 7: assert the OBSERVABLE RESULT (the emitted value).
 */

import { describe, it, expect } from "vitest"
import { neutralizeFormula, csvField } from "@/modules/contacts/ui/export-contacts"

describe("neutralizeFormula", () => {
  it("neutralizes leading formula triggers", () => {
    expect(neutralizeFormula("=1+1")).toBe("'=1+1")
    expect(neutralizeFormula("+cmd")).toBe("'+cmd")
    expect(neutralizeFormula("@foo")).toBe("'@foo")
    expect(neutralizeFormula('=HYPERLINK("http://evil","click")')).toBe(
      '\'=HYPERLINK("http://evil","click")',
    )
    expect(neutralizeFormula("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1")
  })

  it("neutralizes leading tab and carriage-return payloads", () => {
    expect(neutralizeFormula("\t=1+1")).toBe("'\t=1+1")
    expect(neutralizeFormula("\r=1+1")).toBe("'\r=1+1")
  })

  it("neutralizes a malicious leading dash (not a plain number)", () => {
    expect(neutralizeFormula("-=1+1")).toBe("'-=1+1")
    expect(neutralizeFormula("-cmd|'/c calc'!A1")).toBe("'-cmd|'/c calc'!A1")
  })

  it("leaves legitimate negative numbers untouched", () => {
    expect(neutralizeFormula("-5")).toBe("-5")
    expect(neutralizeFormula("-12.50")).toBe("-12.50")
    expect(neutralizeFormula("-0.01")).toBe("-0.01")
  })

  it("leaves ordinary values untouched", () => {
    expect(neutralizeFormula("Acme Co")).toBe("Acme Co")
    expect(neutralizeFormula("")).toBe("")
    // A trigger char that is NOT first is harmless — no prefix.
    expect(neutralizeFormula("john=doe@x.com")).toBe("john=doe@x.com")
    expect(neutralizeFormula("5-10 people")).toBe("5-10 people")
  })
})

describe("csvField (neutralize + RFC-4180 quoting)", () => {
  it("neutralizes then leaves simple payloads unquoted", () => {
    // No comma/quote/newline/edge-space → apostrophe prefix, no wrapping quotes.
    expect(csvField("=1+1")).toBe("'=1+1")
    expect(csvField("+cmd")).toBe("'+cmd")
  })

  it("neutralizes AND quotes when the payload contains a comma", () => {
    // `=SUM(A1,A2)` → neutralize to `'=SUM(A1,A2)`, then quote (has a comma).
    expect(csvField("=SUM(A1,A2)")).toBe('"\'=SUM(A1,A2)"')
  })

  it("passes ordinary and numeric data through unchanged", () => {
    expect(csvField("Acme Co")).toBe("Acme Co")
    expect(csvField("-5")).toBe("-5")
  })

  it("still quotes and escapes internal double-quotes", () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
  })
})
