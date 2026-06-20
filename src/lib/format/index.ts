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

const MS_PER_DAY = 86_400_000

function parseYMD(iso: string): { y: number; m: number; d: number } {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) {
    throw new Error(`expected YYYY-MM-DD prefix; received ${iso}`)
  }
  return {
    y: Number(iso.slice(0, 4)),
    m: Number(iso.slice(5, 7)),
    d: Number(iso.slice(8, 10)),
  }
}

function utcDateToISO(utcMs: number): string {
  // Format a UTC millisecond integer back to YYYY-MM-DD. The Date
  // constructor here is a pure calendar-lookup over UTC; no local time,
  // no DST.
  return new Date(utcMs).toISOString().slice(0, 10)
}

/**
 * Resolve the most-recent-Monday-through-following-Sunday window for
 * a given calendar date — the ISO 8601 week (Mike, 2026-06-20). Users
 * intuitively read Sunday as the END of the current week (the weekend
 * just ending), not day 1 of the next one, so "this week" runs Mon→Sun.
 * Pure UTC arithmetic; no timezone library; no DST handling. Per-studio
 * timezone is a deferred decision — the dashboard treats the input as a
 * UTC calendar date.
 *
 *   resolveMondaySundayWeek("2026-05-20") -> Wednesday
 *     -> { startISO: "2026-05-18", endISO: "2026-05-24" }
 *   resolveMondaySundayWeek("2026-05-18") -> Monday (returns itself)
 *     -> { startISO: "2026-05-18", endISO: "2026-05-24" }
 *   resolveMondaySundayWeek("2026-05-24") -> Sunday (end of the week)
 *     -> { startISO: "2026-05-18", endISO: "2026-05-24" }
 */
export function resolveMondaySundayWeek(todayISO: string): {
  startISO: string
  endISO: string
} {
  const { y, m, d } = parseYMD(todayISO)
  const todayUtc = Date.UTC(y, m - 1, d)
  // getUTCDay returns 0=Sunday..6=Saturday. Shift so Monday is the start:
  // Sun→6, Mon→0, Tue→1, … Sat→5 days back to the week's Monday. Used only
  // as a calendar lookup; the arithmetic below is integer math on ms values.
  const dayOfWeek = new Date(todayUtc).getUTCDay()
  const offsetToMonday = (dayOfWeek + 6) % 7
  const startUtc = todayUtc - offsetToMonday * MS_PER_DAY
  const endUtc = startUtc + 6 * MS_PER_DAY
  return { startISO: utcDateToISO(startUtc), endISO: utcDateToISO(endUtc) }
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number): number {
  // month is 1-indexed (January = 1).
  if (month === 2) return isLeapYear(year) ? 29 : 28
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30
  return 31
}

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n)
}

/**
 * Resolve the first-day and last-day-of-month window for a given
 * calendar date. Pure string math — leap years handled by
 * `daysInMonth`. No timezone library, no Date arithmetic.
 *
 *   resolveCurrentMonthRange("2026-05-20")
 *     -> { startISO: "2026-05-01", endISO: "2026-05-31" }
 *   resolveCurrentMonthRange("2024-02-15") (leap year)
 *     -> { startISO: "2024-02-01", endISO: "2024-02-29" }
 */
export function resolveCurrentMonthRange(todayISO: string): {
  startISO: string
  endISO: string
} {
  const { y, m } = parseYMD(todayISO)
  const yy = String(y)
  const mm = pad2(m)
  return {
    startISO: `${yy}-${mm}-01`,
    endISO: `${yy}-${mm}-${pad2(daysInMonth(y, m))}`,
  }
}

/**
 * Today's date as YYYY-MM-DD in UTC. This is the ONLY function in the
 * format module that reads the system clock; every other date helper
 * is a pure function of its inputs. UTC posture is deliberate per LOC1
 * (no per-studio timezone in V1; the dashboard window is a UTC calendar
 * window, not a local-time one).
 */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
