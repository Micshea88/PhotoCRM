/**
 * Integer-cents money primitives for the recompute engine.
 *
 * ─── THE ROUNDING RULE ─────────────────────────────────────────────────
 *
 * When a total doesn't divide evenly across N items, **the FIRST
 * `(total mod N)` items each receive +1 cent over the floor; the
 * remaining items — including the LAST — receive the floor amount.**
 *
 * Equivalently: the LAST item is always the round-down (floor) value;
 * earlier items are rounded up by one cent each so the sum reconciles
 * to the total exactly.
 *
 * This rule applies UNIFORMLY across `distributeIntegerCents`,
 * `splitByPercentages`, and `splitByFractions`. The discount/tax
 * pipeline floors once at each step (only one number — no remainder
 * to distribute).
 *
 * **Plain-English client answer (write this in support replies):**
 *   "Installment 3 is the floor amount — installments 1 and 2 each
 *    gained a cent so the sum reconciles to your invoice exactly."
 *
 * Per Tech Arch §4 canonical example:
 *   $6,800 ÷ 3 = [$2,266.67, $2,266.67, $2,266.66]
 *   In cents:   [226667,    226667,    226666]
 *   Items 1+2 got +1 over the floor; item 3 IS the floor.
 *
 * ─── THE INTEGER-CENTS DISCIPLINE ─────────────────────────────────────
 *
 * Every input must be an integer. Every output is an integer. Floats
 * are silent-corruption mode A (money drift via IEEE-754); the entry
 * checks here reject them at the boundary so the only place a float
 * could leak in is via someone bypassing these primitives. Don't.
 */

function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer (got ${String(value)})`)
  }
}

function assertPositiveInteger(value: number, label: string): void {
  assertInteger(value, label)
  if (value <= 0) {
    throw new Error(`${label} must be a positive integer (got ${String(value)})`)
  }
}

/**
 * Distribute `totalCents` across `n` parts. Extras (the remainder)
 * land on the FIRST `(total mod n)` items; the last items take the
 * floor. Σ result === totalCents.
 */
export function distributeIntegerCents(totalCents: number, n: number): number[] {
  assertInteger(totalCents, "totalCents")
  assertPositiveInteger(n, "n")
  const base = Math.floor(totalCents / n)
  const remainder = totalCents - base * n
  const out = new Array<number>(n)
  for (let i = 0; i < n; i += 1) {
    out[i] = i < remainder ? base + 1 : base
  }
  return out
}

export type DiscountType = "none" | "flat" | "percent"

/**
 * Apply a discount to a subtotal. `value` interpretation depends on type:
 *   - "flat"    → value is cents (subtract directly)
 *   - "percent" → value is basis points (e.g., 1500 = 15.00%);
 *                 reduction = floor(subtotal × bps / 10000)
 *   - "none"    → value ignored, subtotal returned
 *
 * Result is clamped to ≥ 0 (a discount cannot push the price negative).
 */
export function applyDiscount(
  subtotalCents: number,
  type: DiscountType,
  value: number | null,
): number {
  assertInteger(subtotalCents, "subtotalCents")
  if (type === "none" || value == null) return subtotalCents
  assertInteger(value, "discount value")
  let reduction: number
  if (type === "flat") {
    reduction = value
  } else {
    // percent: value is bps; floor((subtotal × bps) / 10000)
    reduction = Math.floor((subtotalCents * value) / 10000)
  }
  return Math.max(0, subtotalCents - reduction)
}

export type TaxSign = "add" | "subtract"

/**
 * Compute the post-tax total. `taxRateBps` is basis points (850 = 8.50%).
 *
 *   - "add":      result = subtotal + floor(subtotal × bps / 10000)
 *   - "subtract": tax-inclusive — pull tax OUT of an already-inclusive
 *                  total. result = subtotal - floor(subtotal × bps / (10000 + bps))
 *
 * "subtract" is rare (book-keeping for tax-inclusive imports); kept
 * here because the projects schema carries a taxSign column.
 */
export function applyTax(subtotalCents: number, taxRateBps: number, sign: TaxSign): number {
  assertInteger(subtotalCents, "subtotalCents")
  assertInteger(taxRateBps, "taxRateBps")
  if (taxRateBps === 0) return subtotalCents
  if (sign === "add") {
    const taxAmount = Math.floor((subtotalCents * taxRateBps) / 10000)
    return subtotalCents + taxAmount
  }
  // subtract — tax-inclusive
  const taxAmount = Math.floor((subtotalCents * taxRateBps) / (10000 + taxRateBps))
  return subtotalCents - taxAmount
}

/**
 * Split `totalCents` according to an array of percentages expressed as
 * basis points. The percentages array must sum to exactly 10000 (100.00%).
 *
 * Algorithm: floor each piece against the percentage, sum the floors,
 * distribute the shortfall to the FIRST items (one cent each) so the
 * LAST item is the floor. Mirrors `distributeIntegerCents`.
 */
export function splitByPercentages(totalCents: number, percentagesBps: number[]): number[] {
  assertInteger(totalCents, "totalCents")
  for (const bps of percentagesBps) assertInteger(bps, "percentage bps")
  const sum = percentagesBps.reduce((a, b) => a + b, 0)
  if (sum !== 10000) {
    throw new Error(`percentages must sum to 10000 bps (got ${String(sum)})`)
  }
  const floors = percentagesBps.map((bps) => Math.floor((totalCents * bps) / 10000))
  const floorSum = floors.reduce((a, b) => a + b, 0)
  let shortfall = totalCents - floorSum
  // Distribute +1 to first items until shortfall is exhausted.
  const out = floors.slice()
  for (let i = 0; i < out.length && shortfall > 0; i += 1, shortfall -= 1) {
    out[i] = (out[i] ?? 0) + 1
  }
  return out
}

/**
 * Split `totalCents` according to integer weights (fractions). Each
 * fraction may be any positive integer; they're normalized internally.
 * Rounding rule identical to splitByPercentages — extras on first,
 * last is floor.
 */
export function splitByFractions(totalCents: number, fractions: number[]): number[] {
  assertInteger(totalCents, "totalCents")
  for (const f of fractions) assertPositiveInteger(f, "fraction weight")
  const denom = fractions.reduce((a, b) => a + b, 0)
  if (denom === 0) {
    throw new Error("fraction weights must sum to a positive value")
  }
  const floors = fractions.map((f) => Math.floor((totalCents * f) / denom))
  const floorSum = floors.reduce((a, b) => a + b, 0)
  let shortfall = totalCents - floorSum
  const out = floors.slice()
  for (let i = 0; i < out.length && shortfall > 0; i += 1, shortfall -= 1) {
    out[i] = (out[i] ?? 0) + 1
  }
  return out
}

/**
 * Validate a user-supplied manual split (every amount the user typed
 * by hand) sums to the total and contains only non-negative integers.
 * No rounding happens here — the user is responsible for exact cents.
 */
export function validateManualSplit(totalCents: number, amounts: number[]): void {
  assertInteger(totalCents, "totalCents")
  for (const a of amounts) {
    assertInteger(a, "split amount")
    if (a < 0) {
      throw new Error(`split amount cannot be negative (got ${String(a)})`)
    }
  }
  const sum = amounts.reduce((a, b) => a + b, 0)
  if (sum !== totalCents) {
    throw new Error(
      `split amounts must sum to total ${String(totalCents)} cents (got ${String(sum)})`,
    )
  }
}
