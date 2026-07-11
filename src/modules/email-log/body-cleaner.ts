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

// Gmail wraps the entire quoted history in a container/blockquote/attr-header
// whose class contains `gmail_quote` (e.g. `gmail_quote gmail_quote_container`,
// `blockquote.gmail_quote`) or `gmail_attr` (the "On … wrote:" header div).
// Cutting the RAW HTML at the FIRST such tag removes the whole quote block in
// one move — which the old line-based cut could never do, because a Gmail HTML
// body is a single line with no newlines for a line-anchored regex to catch.
//
// GMAIL MARKERS ONLY. Outlook + Apple Mail quote containers use different markup
// and are a KNOWN GAP (no real captured payload yet) — see
// docs/cleanup-and-tech-debt.md. Do NOT invent markers that haven't been
// observed in a real payload.
const GMAIL_QUOTE_RE =
  /<(?:div|blockquote)\b[^>]*\bclass=(?:"[^"]*gmail_(?:quote|attr)[^"]*"|'[^']*gmail_(?:quote|attr)[^']*')/i

// Detects the "On <date>, <name> wrote:" line that plain-text email clients
// insert before the quoted original. Used only on the PLAIN-TEXT / newline-based
// fallback path (the Resend text lane or non-Gmail bodies). HTML is stripped per
// line before this check so it matches a div-wrapped header too.
//
// SILENT-TRUNCATION RISK: a legitimate line that happens to start with "on" and
// end with "wrote:" would drop everything from that line onward. Intentional
// (the vast majority are reply-chain headers); documented here, not logged (hot
// ingest path).
const ON_WROTE_RE = /^on\s.+wrote:\s*$/i

/**
 * Decode the HTML entities that survive tag-stripping. Without this, `&lt;`
 * `&gt;` `&amp;` `&nbsp;` `&#39;` render as literal text on the timeline.
 * `&amp;` is decoded LAST so a double-encoded `&amp;lt;` is not collapsed to `<`.
 */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number(dec)))
    .replace(/&amp;/gi, "&")
}

function codePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return ""
  try {
    return String.fromCodePoint(n)
  } catch {
    return ""
  }
}

/**
 * Cut the raw HTML at the first Gmail quote marker (structure-aware). Everything
 * from that tag onward is quoted history. Returns the HTML unchanged when no
 * Gmail marker is present (plain-text bodies / non-Gmail clients).
 */
function cutGmailQuote(html: string): string {
  const m = GMAIL_QUOTE_RE.exec(html)
  return m ? html.slice(0, m.index) : html
}

/**
 * Turn a (possibly-already-cut) HTML/text body into clean display text:
 * pixel-strip → plain-text quote fallback (On…wrote: + contiguous trailing `>`
 * block) → tag-strip → entity-decode → whitespace-collapse. Returns "" when
 * nothing survives.
 */
function htmlToCleanText(html: string): string {
  // 1. Strip our own tracking pixel (belt-and-braces; usually already inside the
  //    Gmail cut region, but a non-Gmail body may carry it inline).
  const withoutPixel = html.replace(TRACKING_PIXEL_RE, "")

  // 2. Plain-text / newline-based fallback: trim from the first "On … wrote:"
  //    header, and peel a CONTIGUOUS trailing `>`-quoted block. A stray `>` line
  //    FOLLOWED by real content is preserved (never scatter-filtered).
  const lines = withoutPixel.split("\n")
  const text = lines.map((l) => l.replace(/<[^>]*>/g, "").trim())

  let cut = lines.length
  for (const [i, t] of text.entries()) {
    if (ON_WROTE_RE.test(t)) {
      cut = i
      break
    }
  }

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

  // 3. Join kept lines, strip residual HTML tags, decode entities, collapse ws.
  const stripped = lines
    .slice(0, keptCount)
    .join(" ")
    .replace(/<[^>]*>/g, " ")
  return decodeHtmlEntities(stripped).replace(/\s+/g, " ").trim()
}

/**
 * Shared email body cleaner. Produces clean, quote-trimmed display text from an
 * inbound email body (Gmail HTML or plain text). Pure — no side effects.
 *
 * Pipeline:
 *   1. Structure-aware Gmail quote cut on the RAW HTML (removes the whole quote
 *      container in one move — works on single-line HTML, which the line-based
 *      cut cannot).
 *   2. Clean the cut body (pixel-strip, plain-text quote fallback, tag-strip,
 *      HTML-entity decode, whitespace-collapse).
 *   3. EMPTY-GUARD: if the cut left nothing (e.g. a bottom-posted reply whose new
 *      text sits below/inside the quote), clean the FULL uncut body instead — a
 *      reply must never render blank.
 *   4. Truncate to `opts.maxLen` only when provided.
 */
export function cleanEmailBody(raw: string | null, opts?: { maxLen?: number }): string | null {
  if (!raw) return null

  const cutHtml = cutGmailQuote(raw)
  let cleaned = htmlToCleanText(cutHtml)

  // Empty-guard: the cut removed everything (bottom-posted / quote-first reply).
  // Fall back to the full body so a real reply is never blank.
  if (!cleaned) {
    cleaned = htmlToCleanText(raw)
  }

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
