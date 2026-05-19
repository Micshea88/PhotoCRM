/**
 * Tests for the cents primitives — written FIRST per the recompute build
 * plan. Money is a known-dangerous area (silent-corruption mode A in the
 * README): floats anywhere in the pipeline drift; non-integer inputs are
 * a corruption vector. These tests pin down the rounding rule and the
 * input-integer contract.
 *
 * THE ROUNDING RULE (canonical, applies to every split function here):
 *   When the total doesn't divide evenly across N items, the FIRST
 *   `(total mod N)` items each receive +1 cent over the floor; the
 *   remaining items — including the LAST — receive the floor amount.
 *   Equivalently: the LAST item is always the round-down (floor) value.
 *
 * Plain-English client answer: "Installment 3 carries the floor amount;
 * installments 1 and 2 each gained a cent so the sum reconciles exactly."
 */
import { describe, it, expect } from "vitest"
import {
  distributeIntegerCents,
  applyDiscount,
  applyTax,
  splitByPercentages,
  splitByFractions,
  validateManualSplit,
} from "@/lib/recompute/cents"

describe("distributeIntegerCents", () => {
  it("divides evenly when total mod n === 0", () => {
    expect(distributeIntegerCents(900, 3)).toEqual([300, 300, 300])
  })

  it("Tech Arch §4 canonical example — 6800.00 / 3 = [2266.67, 2266.67, 2266.66]", () => {
    // EXTRAS ON FIRST, last is floor. Σ === total.
    const parts = distributeIntegerCents(680000, 3)
    expect(parts).toEqual([226667, 226667, 226666])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(680000)
  })

  it("single-installment passes total through unchanged", () => {
    expect(distributeIntegerCents(12345, 1)).toEqual([12345])
  })

  it("tiny remainder — last is the floor (5 / 2 = [3, 2])", () => {
    expect(distributeIntegerCents(5, 2)).toEqual([3, 2])
  })

  it("zero total — every part is 0, sum is 0", () => {
    expect(distributeIntegerCents(0, 4)).toEqual([0, 0, 0, 0])
  })

  it("4-way split with remainder=3 distributes [+1,+1,+1, floor]", () => {
    // 10 cents / 4 = floor 2 with remainder 2. First TWO get +1, last
    // two get floor. → [3, 3, 2, 2].
    expect(distributeIntegerCents(10, 4)).toEqual([3, 3, 2, 2])
  })

  it("rejects non-integer total (silent-corruption mode A)", () => {
    expect(() => distributeIntegerCents(100.5, 2)).toThrow(/integer/i)
  })

  it("rejects non-integer n", () => {
    expect(() => distributeIntegerCents(100, 2.5)).toThrow(/integer/i)
  })

  it("rejects n <= 0", () => {
    expect(() => distributeIntegerCents(100, 0)).toThrow(/positive/i)
    expect(() => distributeIntegerCents(100, -1)).toThrow(/positive/i)
  })

  it("invariant: Σ result === total for every divisor up to 20", () => {
    for (let n = 1; n <= 20; n += 1) {
      for (const total of [0, 1, 100, 999, 10000, 100001, 999999]) {
        const parts = distributeIntegerCents(total, n)
        expect(parts.length).toBe(n)
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
        // Every part must be an integer.
        expect(parts.every((p) => Number.isInteger(p))).toBe(true)
      }
    }
  })

  it("invariant: every part is base or base+1 (no off-by-2 drift)", () => {
    const parts = distributeIntegerCents(680000, 3)
    const min = Math.min(...parts)
    const max = Math.max(...parts)
    expect(max - min).toBeLessThanOrEqual(1)
  })
})

describe("applyDiscount", () => {
  it("returns subtotal unchanged when discountType is 'none'", () => {
    expect(applyDiscount(10000, "none", null)).toBe(10000)
    expect(applyDiscount(10000, "none", 500)).toBe(10000)
  })

  it("subtracts flat-cents discount", () => {
    expect(applyDiscount(10000, "flat", 1500)).toBe(8500)
  })

  it("applies percentage-bps discount with floor rounding (15% of 10001 = 1500.15 → floor 1500)", () => {
    // discountValue is basis points: 1500 bps = 15.00%
    // floor(10001 × 1500 / 10000) = floor(1500.15) = 1500
    // 10001 - 1500 = 8501
    expect(applyDiscount(10001, "percent", 1500)).toBe(8501)
  })

  it("100% discount → 0", () => {
    expect(applyDiscount(10000, "percent", 10000)).toBe(0)
  })

  it("clamps negative result to 0 (discount > subtotal)", () => {
    // Flat 20000 against 10000 → would be -10000; clamp to 0.
    expect(applyDiscount(10000, "flat", 20000)).toBe(0)
  })

  it("rejects non-integer subtotal", () => {
    expect(() => applyDiscount(100.5, "flat", 50)).toThrow(/integer/i)
  })
})

describe("applyTax", () => {
  it("zero tax rate returns input unchanged", () => {
    expect(applyTax(10000, 0, "add")).toBe(10000)
  })

  it("ADD tax — 8.5% of 10000 = 850 (10000 × 850 / 10000)", () => {
    // 850 bps = 8.50%. 10000 × 850 / 10000 = 850 exact.
    expect(applyTax(10000, 850, "add")).toBe(10850)
  })

  it("ADD tax — floor rounding (10001 × 850 / 10000 = 850.085 → floor 850)", () => {
    expect(applyTax(10001, 850, "add")).toBe(10851)
  })

  it("SUBTRACT tax — inclusive of total (rare; book-keeping)", () => {
    // Tax-inclusive: 10000 includes 850 bps of tax. Pull it back out.
    // tax_amount = floor(10000 × 850 / (10000+850)) = floor(783.41) = 783
    expect(applyTax(10000, 850, "subtract")).toBe(9217)
  })

  it("rejects non-integer subtotal", () => {
    expect(() => applyTax(100.5, 100, "add")).toThrow(/integer/i)
  })
})

describe("splitByPercentages", () => {
  it("even split — [5000, 5000] across 10000 → [5000, 5000]", () => {
    expect(splitByPercentages(10000, [5000, 5000])).toEqual([5000, 5000])
  })

  it("3-way with remainder — extras on FIRST, last is floor", () => {
    // 10001 × 3333 / 10000 = floor 3333; 10001 × 3334 / 10000 = floor 3334.
    // Sum = 3333 + 3333 + 3334 = 10000. Shortfall = 1. Distribute to first.
    // Result: [3334, 3333, 3334].
    expect(splitByPercentages(10001, [3333, 3333, 3334])).toEqual([3334, 3333, 3334])
  })

  it("Tech Arch §4 example — 6800.00 split [50%, 50%] = [340000, 340000]", () => {
    expect(splitByPercentages(680000, [5000, 5000])).toEqual([340000, 340000])
  })

  it("rejects bps array that doesn't sum to 10000", () => {
    expect(() => splitByPercentages(10000, [3000, 3000])).toThrow(/10000|sum/i)
    expect(() => splitByPercentages(10000, [5000, 5001])).toThrow(/10000|sum/i)
  })

  it("invariant: Σ result === totalCents for every valid bps array", () => {
    const cases: [number, number[]][] = [
      [12345, [3333, 3333, 3334]],
      [100000, [2500, 2500, 2500, 2500]],
      [99999, [5000, 5000]],
      [1, [5000, 5000]], // total of 1 cent, half-and-half rounding edge
      [3, [3333, 3333, 3334]],
    ]
    for (const [total, bps] of cases) {
      const parts = splitByPercentages(total, bps)
      expect(parts.length).toBe(bps.length)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
      expect(parts.every((p) => Number.isInteger(p))).toBe(true)
    }
  })

  it("rejects non-integer total", () => {
    expect(() => splitByPercentages(100.5, [5000, 5000])).toThrow(/integer/i)
  })
})

describe("splitByFractions", () => {
  it("two equal halves — fractions [1, 1] across 100 = [50, 50]", () => {
    expect(splitByFractions(100, [1, 1])).toEqual([50, 50])
  })

  it("uneven thirds with remainder — extras on first, last is floor", () => {
    // 10 / 3 with fractions [1, 1, 1]: floors are [3, 3, 3], sum 9.
    // Shortfall = 1. Distributed to first → [4, 3, 3].
    expect(splitByFractions(10, [1, 1, 1])).toEqual([4, 3, 3])
  })

  it("weighted fractions [2, 1, 1] across 100 = [50, 25, 25]", () => {
    expect(splitByFractions(100, [2, 1, 1])).toEqual([50, 25, 25])
  })

  it("invariant: Σ result === totalCents and all integer", () => {
    const cases: [number, number[]][] = [
      [100, [1, 2, 3]],
      [99, [1, 1, 1]],
      [1, [1, 1, 1]],
      [1000, [7, 3, 5]],
    ]
    for (const [total, fr] of cases) {
      const parts = splitByFractions(total, fr)
      expect(parts.length).toBe(fr.length)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
      expect(parts.every((p) => Number.isInteger(p))).toBe(true)
    }
  })
})

describe("validateManualSplit", () => {
  it("accepts amounts that sum exactly to total", () => {
    expect(() => {
      validateManualSplit(10000, [3000, 4000, 3000])
    }).not.toThrow()
  })

  it("rejects amounts that don't sum to total", () => {
    expect(() => {
      validateManualSplit(10000, [3000, 4000, 2999])
    }).toThrow(/sum|total/i)
  })

  it("rejects non-integer amounts (silent-corruption mode A)", () => {
    expect(() => {
      validateManualSplit(10000, [3000.5, 4000, 2999.5])
    }).toThrow(/integer/i)
  })

  it("rejects negative amounts", () => {
    expect(() => {
      validateManualSplit(10000, [-1000, 11000])
    }).toThrow(/negative|positive/i)
  })
})
