/**
 * Formatters for the V1 US-only product surface. Per LOC1 (PIVOTS_LEDGER
 * Section 1, "Localization + plain-language addendum"): US conventions
 * only; no country selector; no i18n library; adding locales is a
 * separate planned decision.
 *
 * - formatCents is the canonical helper for rule D1 (NEVER show raw
 *   cents to a human). Every UI / email / PDF / CSV consumer of a
 *   *_cents column MUST route through here.
 * - formatDate returns MM/DD/YYYY. No Date constructor for parsing;
 *   the input is a Drizzle date column or an ISO 8601 string, and we
 *   slice the YYYY-MM-DD portion lexicographically. No timezone
 *   library, no DST math.
 *
 * Future US formatters (phone / address / imperial units) land here as
 * named exports when the first surface needs them; document them in
 * LOC1 when they ship.
 */

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Render integer cents as a US dollar string ($X,XXX.XX).
 *
 *   formatCents(0)            -> "$0.00"
 *   formatCents(226667)       -> "$2,266.67"
 *   formatCents(-100)         -> "-$1.00"
 *   formatCents(99999999999)  -> "$999,999,999.99"
 *
 * Throws on non-integer input. Integer-cents discipline is the whole
 * point of the storage convention; a float here is a caller bug.
 */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`formatCents requires an integer cents value; received ${String(cents)}`)
  }
  return USD_FORMATTER.format(cents / 100)
}

/**
 * Render an ISO 8601 date-or-datetime as US MM/DD/YYYY.
 *
 *   formatDate("2026-05-20")             -> "05/20/2026"
 *   formatDate("2026-01-01")             -> "01/01/2026"
 *   formatDate("2026-12-31T15:00:00Z")   -> "12/31/2026"
 *
 * Throws on input that does NOT start with a YYYY-MM-DD prefix. No
 * Date constructor, no parsing past the date portion. Per LOC1 the V1
 * product is US-only with no timezone selector; per-studio timezone
 * is a deferred decision.
 */
export function formatDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) {
    throw new Error(`formatDate requires a YYYY-MM-DD or ISO 8601 prefix; received ${iso}`)
  }
  // Lexicographic slice — no Date constructor, no timezone math.
  // The regex above guarantees the offsets below are populated.
  const year = iso.slice(0, 4)
  const month = iso.slice(5, 7)
  const day = iso.slice(8, 10)
  return `${month}/${day}/${year}`
}
