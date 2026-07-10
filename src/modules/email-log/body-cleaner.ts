/**
 * Pure email-body cleaning utilities — no server deps, no side effects.
 * Safe to import in unit tests and in server-only modules alike.
 *
 * Exported from here so unit tests can import without pulling in the
 * full `inbound.ts` server-only graph (db, env, Resend, etc.).
 */

// Matches our own tracking-pixel img tag (echoed back in replied HTML).
// src="/api/email/track/<id>.png" or "https://…/api/email/track/…png".
// Accepts both double-quoted and single-quoted src attributes.
const TRACKING_PIXEL_RE =
  /<img\b[^>]*\bsrc=(?:"[^"]*\/api\/email\/track\/[^"]*"|'[^']*\/api\/email\/track\/[^']*')[^>]*\/?>/gi

// Detects the "On <date>, <name> wrote:" line that email clients insert before
// the quoted original. Strip-HTML is applied to each line before this check so
// it matches both plain-text and HTML (div-wrapped) quote headers.
//
// SILENT-TRUNCATION RISK: any legitimate line that happens to start with "on"
// and end with "wrote:" (e.g. a sentence such as "on this topic, the client
// wrote:") will cause cleanEmailBody to discard everything from that line
// onward with no warning or log.  This is intentional (the vast majority of
// such lines are reply-chain headers), but reviewers should be aware that
// false-positive truncations are possible.  This is a hot ingest path so no
// log is emitted here — the comment is the documentation.
const ON_WROTE_RE = /^on\s.+wrote:\s*$/i

/**
 * Shared email body cleaner. Strips HTML tags, removes our own tracking-pixel
 * echo, trims quoted reply history (both `>`-prefixed lines and the
 * "On <date>… wrote:" header), and collapses whitespace.  Truncates to
 * `opts.maxLen` only when provided.  Pure — no side effects.
 *
 * Trimming rule (trim ONLY from the first marker of the trailing quote block —
 * never scatter-filter individual lines, so legitimate content is preserved):
 *   1. Strip the tracking-pixel img first (before line-splitting).
 *   2. Cut at the "On … wrote:" reply header (first occurrence, HTML-stripped
 *      per line) — everything from that line onward is quoted history.
 *   3. Within what remains, peel a CONTIGUOUS trailing block of `>`-quoted
 *      lines (a quote block that carries no "On … wrote:" header). Only a run
 *      of `>` lines that reaches the end is dropped — a stray `>` line FOLLOWED
 *      by real content is kept (we never remove scattered mid-message `>` lines).
 *   4. Strip residual HTML tags from the kept lines and collapse whitespace.
 */
export function cleanEmailBody(raw: string | null, opts?: { maxLen?: number }): string | null {
  if (!raw) return null

  // 1. Strip our own tracking pixel (silently echoed back in replied HTML).
  const withoutPixel = raw.replace(TRACKING_PIXEL_RE, "")

  const lines = withoutPixel.split("\n")
  // Per-line HTML-stripped text, used only for quote-marker detection.
  const text = lines.map((l) => l.replace(/<[^>]*>/g, "").trim())

  // 2. Cut at the first "On … wrote:" reply header (quoted history from here on).
  let cut = lines.length
  for (const [i, t] of text.entries()) {
    if (ON_WROTE_RE.test(t)) {
      cut = i
      break
    }
  }

  // 3. Peel a CONTIGUOUS trailing run of `>`-quoted (or blank) lines within
  //    [0, cut). Drop it only if that run actually contains a `>` line — a run
  //    of just blank lines is not a quote block. A stray `>` line with real
  //    content after it never enters this trailing run, so it is preserved.
  let end = cut
  while (end > 0) {
    const prev = text[end - 1] ?? ""
    if (prev === "" || prev.startsWith(">")) {
      end--
      continue
    }
    break
  }
  const trailingHasQuote = text.slice(end, cut).some((t) => t.startsWith(">"))
  const keptCount = trailingHasQuote ? end : cut

  // 4. Join kept lines, strip residual HTML tags, collapse whitespace.
  const cleaned = lines
    .slice(0, keptCount)
    .join(" ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!cleaned) return null

  const maxLen = opts?.maxLen
  if (maxLen !== undefined && cleaned.length > maxLen) {
    return cleaned.slice(0, maxLen - 1) + "…"
  }
  return cleaned
}

/**
 * Thin wrapper around `cleanEmailBody` that always truncates to `maxLen`
 * (default 140) for notification previews.  Kept separately so call sites
 * that only need the preview can import a single name; the underlying
 * behavior is fully exercised via `cleanEmailBody` unit tests.
 *
 * NOTE: do NOT change the 140-char default — it drives notification body
 * previews and existing unit tests assert on it.
 */
export function buildBodyPreview(body: string | null, maxLen = 140): string | null {
  return cleanEmailBody(body, { maxLen })
}
