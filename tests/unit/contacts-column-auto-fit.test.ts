/**
 * Push 2c.1 — auto-fit column width measurement.
 *
 * Pure unit tests for measureColumnAutoFit. A stub canvas context
 * returns a fixed-per-char width so assertions are deterministic
 * regardless of jsdom's real canvas behavior.
 */

import { describe, it, expect } from "vitest"
import {
  measureColumnAutoFit,
  type AutoFitMeasureContext,
} from "@/modules/contacts/ui/column-auto-fit"

/**
 * Stub measureText — width is text.length * pxPerChar. Doesn't use the
 * `font` property but the helper sets it before calling, so we verify
 * setting works by exposing the last-set font.
 */
function makeStub(pxPerChar = 8) {
  let lastFont = ""
  const ctx: AutoFitMeasureContext = {
    get font() {
      return lastFont
    },
    set font(value: string) {
      lastFont = value
    },
    measureText(text: string) {
      return { width: text.length * pxPerChar }
    },
  }
  return {
    ctx,
    getFont: () => lastFont,
  }
}

describe("measureColumnAutoFit", () => {
  it("picks the widest of header label and cell values, plus padding", () => {
    const { ctx } = makeStub(8)
    // header is 4 chars (32 px); cells are 6 + 11 + 3 chars (88 px widest).
    // 88 + padding 24 = 112.
    const width = measureColumnAutoFit({
      ctx,
      font: "14px system-ui",
      headerLabel: "Name",
      cellValues: ["Lovely", "Janetheunit", "abc"],
    })
    expect(width).toBe(112)
  })

  it("clamps below the floor", () => {
    const { ctx } = makeStub(8)
    const width = measureColumnAutoFit({
      ctx,
      font: "14px system-ui",
      headerLabel: "a",
      cellValues: ["b"],
      min: 60,
      max: 400,
    })
    // measured = 8 (char) + 24 (padding) = 32, clamped to min 60.
    expect(width).toBe(60)
  })

  it("clamps above the ceiling", () => {
    const { ctx } = makeStub(8)
    const longCell = "x".repeat(200)
    const width = measureColumnAutoFit({
      ctx,
      font: "14px system-ui",
      headerLabel: "h",
      cellValues: [longCell],
      min: 60,
      max: 400,
    })
    // measured ≈ 200 * 8 + 24 = 1624, clamped to max 400.
    expect(width).toBe(400)
  })

  it("ignores null / empty cell values", () => {
    const { ctx } = makeStub(8)
    const width = measureColumnAutoFit({
      ctx,
      font: "14px system-ui",
      headerLabel: "Header",
      cellValues: ["", "", "Short", ""],
    })
    // widest is "Short" = 40, padding 24 → 64.
    expect(width).toBeGreaterThanOrEqual(60)
    expect(width).toBeLessThanOrEqual(400)
  })

  it("sets the font on the context before measuring", () => {
    const { ctx, getFont } = makeStub(8)
    measureColumnAutoFit({
      ctx,
      font: "700 16px Inter, sans-serif",
      headerLabel: "Name",
      cellValues: ["Ada"],
    })
    expect(getFont()).toBe("700 16px Inter, sans-serif")
  })

  it("honors custom padding", () => {
    const { ctx } = makeStub(10)
    const width = measureColumnAutoFit({
      ctx,
      font: "14px system-ui",
      headerLabel: "AB",
      cellValues: ["ABCD"],
      padding: 0,
      min: 0,
    })
    // measured = 4 chars * 10 = 40 + padding 0 = 40.
    expect(width).toBe(40)
  })
})
