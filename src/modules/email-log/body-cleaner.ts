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
 * Order matters: strip the tracking pixel first (before line-splitting, so a
 * multi-attribute img tag is removed cleanly); then split on newlines so that
 * plain-text `>` quote markers are detectable; then check each line for the
 * "On … wrote:" header (after stripping that line's HTML tags) and break on
 * first match; finally strip HTML from the kept lines and collapse whitespace.
 */
export function cleanEmailBody(raw: string | null, opts?: { maxLen?: number }): string | null {
  if (!raw) return null

  // 1. Strip our own tracking pixel (silently echoed back in replied HTML).
  const withoutPixel = raw.replace(TRACKING_PIXEL_RE, "")

  // 2. Split on newlines; filter plain-text `>` quoted lines; break on the
  //    "On … wrote:" header so quoted history is dropped entirely.
  const lines = withoutPixel.split("\n")
  const kept: string[] = []
  for (const line of lines) {
    if (line.trim().startsWith(">")) continue
    // Strip HTML tags from THIS line to detect the quote header inside HTML.
    const textLine = line.replace(/<[^>]*>/g, "").trim()
    if (ON_WROTE_RE.test(textLine)) break
    kept.push(line)
  }

  // 3. Join remaining lines, strip residual HTML tags, collapse whitespace.
  const cleaned = kept
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
