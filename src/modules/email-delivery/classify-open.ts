/**
 * classify-open.ts — Pure open-event classifier (Task 13).
 *
 * Determines whether an email open event came from a human, a bot/scanner,
 * or is ambiguous (Apple Mail Privacy Protection).
 *
 * PURE — no DB, no fetch, no Date.now() inside. msSinceSend is passed in.
 * No server-only boundary needed — this module imports nothing server-side.
 */

export type OpenClass = "human" | "bot" | "unknown"

export interface ClassifyOpenInput {
  ip: string | null
  userAgent: string | null
  /** Milliseconds between email_log.sentAt and the pixel request; null if unknown. */
  msSinceSend: number | null
}

/**
 * Heuristic timing constant: an open within this many milliseconds of send is
 * almost certainly a pre-delivery security scanner, not a human; tunable.
 *
 * Default 3000ms (3s). Raise if you see legitimate rapid mobile clients being
 * classified as bots; lower if your scanner-hit rate is still high at 3s.
 */
export const OPEN_BOT_TIMING_MS = 3000

/**
 * Case-insensitive substrings that identify bot, proxy, or scanner User-Agent
 * strings. Rules 1–2 of classifyOpen check these in order; first match wins.
 * Extensible — add a new pattern as a single array entry.
 */
export const BOT_UA_PATTERNS: readonly string[] = [
  "googleimageproxy", // Google image proxy (Gmail pre-fetch)
  "ggpht", // Google Photos / GgpHt proxy
  "bot", // generic bots (also matches claudebot, gptbot, etc.)
  "crawler", // generic web crawlers
  "spider", // generic web spiders
  "proofpoint", // Proofpoint Targeted Attack Protection pre-fetch
  "mimecast", // Mimecast URL Defense pre-fetch
  "barracuda", // Barracuda Email Security Gateway pre-fetch
  "microsoft-outlook", // Outlook Safe Links pre-fetch
  "claudebot", // Anthropic ClaudeBot (explicit, even though "bot" already matches)
  "gptbot", // OpenAI GPTBot (explicit)
  "bingpreview", // Bing link preview fetcher
  "feedfetcher", // Google FeedFetcher / RSS readers
]

/**
 * Apple Mail Privacy Protection (MPP) egress CIDR prefixes — starter set.
 *
 * Apple routes MPP pixel fetches through proxy servers in their 17.0.0.0/8
 * allocation. The full authoritative list is published at:
 *   https://mask-api.icloud.com/egress-ip-ranges.csv
 * Fetching and caching that CSV at build/runtime is a documented follow-up
 * task. Until that ships, this starter set covers Apple's well-known /8 plus
 * a selection of more specific proxy subnets observed in the wild.
 *
 * Coverage note: 17.0.0.0/8 already matches all 17.x.x.x addresses, so the
 * specific sub-ranges below are redundant but kept for documentation value.
 * Once the full CSV fetch is implemented, replace this array with the cached
 * result.
 */
const APPLE_MPP_CIDRS: readonly string[] = [
  "17.0.0.0/8", // Apple's primary /8 allocation (entire 17.x.x.x space)
  "17.58.96.0/19", // observed MPP egress range
  "17.75.76.0/22", // observed MPP egress range
  "17.169.0.0/21", // observed MPP egress range
]

/**
 * Parse a dotted-decimal IPv4 address string into a 32-bit unsigned integer.
 * Returns null if the string is not a valid IPv4 address (including IPv6 and
 * garbage input) — callers must treat null as "no match".
 */
function ipv4ToNum(ip: string): number | null {
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  const nums = parts.map(Number)
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  // Destructure after validation so TypeScript knows each element is present.
  const [a, b, c, d] = nums
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null
  // >>> 0 converts to unsigned 32-bit — required for IPs in 128.x.x.x–255.x.x.x
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
}

/**
 * Test whether an IPv4 address falls within a CIDR block.
 *
 * Returns false (never throws) for:
 *   - IPv6 addresses (we don't yet match them — follow-up)
 *   - garbage / non-IP strings
 *   - malformed CIDR notation
 *
 * Uses only built-in arithmetic (no net/os/node modules).
 */
export function ipInCidr(ip: string, cidr: string): boolean {
  const slashIdx = cidr.indexOf("/")
  if (slashIdx === -1) return false
  const cidrIp = cidr.slice(0, slashIdx)
  const prefix = Number.parseInt(cidr.slice(slashIdx + 1), 10)
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return false
  const ipNum = ipv4ToNum(ip)
  const cidrNum = ipv4ToNum(cidrIp)
  if (ipNum === null || cidrNum === null) return false
  // Build the mask: prefix=0 → all zeros, prefix=32 → all ones.
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
  return (ipNum & mask) === (cidrNum & mask)
}

/**
 * Test whether the given IP is a known Apple MPP egress address.
 * Returns false if ip is null or not a valid IPv4 address.
 */
export function isAppleMppIp(ip: string | null): boolean {
  if (ip === null) return false
  return APPLE_MPP_CIDRS.some((cidr) => ipInCidr(ip, cidr))
}

/**
 * Classify an email open event as "human" | "bot" | "unknown".
 *
 * Rules applied in order (first match wins — deterministic):
 *   1. Empty / missing UA → "bot"  (headless fetchers rarely send a UA)
 *   2. Known bot / proxy / scanner UA substring → "bot"
 *   3. Apple MPP egress IP → "unknown"  (origin is ambiguous — could be
 *      a human who opened in Apple Mail, but we cannot confirm)
 *   4. Open faster than OPEN_BOT_TIMING_MS → "bot"  (pre-delivery scanner)
 *   5. Otherwise → "human"
 */
export function classifyOpen(input: ClassifyOpenInput): OpenClass {
  const { ip, userAgent, msSinceSend } = input

  // Rule 1 — missing / blank UA
  if (!userAgent || userAgent.trim() === "") return "bot"

  // Rule 2 — known bot/proxy/scanner UA
  const uaLower = userAgent.toLowerCase()
  if (BOT_UA_PATTERNS.some((pattern) => uaLower.includes(pattern))) return "bot"

  // Rule 3 — Apple Mail Privacy Protection
  if (isAppleMppIp(ip)) return "unknown"

  // Rule 4 — timing heuristic (skip if msSinceSend is unknown)
  if (msSinceSend !== null && msSinceSend < OPEN_BOT_TIMING_MS) return "bot"

  // Rule 5 — human
  return "human"
}
