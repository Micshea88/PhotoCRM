/**
 * Date primitives for the recompute engine. STRING-IN, STRING-OUT.
 *
 * ─── THE DATE DISCIPLINE (silent-corruption mode C) ────────────────────
 *
 * NEVER call `new Date(string)` in this file. Parsing an ISO date
 * string with `new Date()` interprets it in the JS engine's local
 * timezone, then `.getDate()` / `.toString()` returns the local-time
 * day — which can differ from the original ISO day at DST boundaries
 * and even at midnight UTC in time zones east of UTC.
 *
 * Concrete bug we defend against: under `TZ=America/Los_Angeles`,
 * `new Date("2026-03-08")` is parsed as UTC midnight (2026-03-08T00:00Z),
 * which is 2026-03-07 16:00 PST. Then `d.setDate(d.getDate()+1)` reads
 * `getDate()` as 7 (local) and sets it to 8, yielding 2026-03-08 in LA
 * local — but the original ISO day was 03-08, so we'd report a 0-day
 * shift for `addDays("2026-03-08", 1)`.
 *
 * Defense: parse YYYY-MM-DD as three integers, do arithmetic via
 * `Date.UTC` (UTC has no DST), format back as YYYY-MM-DD using UTC
 * methods. The Date object is only used as a calendrical calculator;
 * its timezone is irrelevant because we read/write UTC only.
 */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

interface ParsedDate {
  year: number
  month: number // 1-12
  day: number // 1-31
}

function parseIsoDate(input: string): ParsedDate {
  if (typeof input !== "string") {
    throw new Error(`date must be a YYYY-MM-DD string (got ${typeof input})`)
  }
  const match = ISO_RE.exec(input)
  if (!match) {
    throw new Error(`date must be in YYYY-MM-DD format (got "${input}")`)
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12) {
    throw new Error(`invalid month in "${input}"`)
  }
  // Validate day-of-month against month length (and leap years).
  // Date.UTC clamps overflow silently (Feb 30 → Mar 2), so check
  // explicitly: build the UTC date and verify round-trip.
  const utcMs = Date.UTC(year, month - 1, day)
  const probe = new Date(utcMs)
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`invalid day in "${input}"`)
  }
  return { year, month, day }
}

function formatIsoDate({ year, month, day }: ParsedDate): string {
  const yy = String(year).padStart(4, "0")
  const mm = String(month).padStart(2, "0")
  const dd = String(day).padStart(2, "0")
  return `${yy}-${mm}-${dd}`
}

/**
 * Add `n` days to a YYYY-MM-DD date string. Negative `n` subtracts.
 * The arithmetic is performed in UTC — never depends on system TZ.
 */
export function addDays(date: string, n: number): string {
  if (!Number.isInteger(n)) {
    throw new Error(`offset must be an integer (got ${String(n)})`)
  }
  const { year, month, day } = parseIsoDate(date)
  const baseMs = Date.UTC(year, month - 1, day)
  const shifted = new Date(baseMs + n * 86_400_000)
  return formatIsoDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  })
}

/**
 * Returns true if the input is a valid YYYY-MM-DD calendar date.
 * Used by callers that want to validate without throwing.
 */
export function isValidIsoDate(input: unknown): boolean {
  if (typeof input !== "string") return false
  try {
    parseIsoDate(input)
    return true
  } catch {
    return false
  }
}
