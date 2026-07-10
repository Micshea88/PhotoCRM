/**
 * Pure URL-detection utility — no DOM/React deps.
 *
 * `detectUrls` splits a plain-text string into typed segments so that callers
 * can render URLs as anchors and leave surrounding text as escaped nodes, with
 * NO dangerouslySetInnerHTML required.
 *
 * Only http/https URLs are detected; bare hostnames and mailto: links are
 * intentionally excluded (too many false positives in freeform email bodies).
 */

export type UrlSegment = { type: "text"; value: string } | { type: "url"; value: string }

const URL_RE = /https?:\/\/[^\s<>"']+/g

// Strip a trailing run of punctuation that commonly appears after a URL in
// natural prose: sentence-ending periods/bangs/questions, semicolons/colons,
// closing parens/brackets/quotes.  Applied AFTER the URL_RE match so the regex
// itself stays simple and non-backtracking (no ReDoS risk).
// Chars stripped: . , ! ? ; : ) ] ' "
const TRAILING_PUNCT_RE = /[.,!?;:)\]'"]+$/

/**
 * Split `text` into alternating text and url segments.
 * An empty string returns `[{ type: "text", value: "" }]`.
 * Text with no URLs returns a single text segment.
 *
 * Trailing punctuation (`.`, `,`, `!`, `?`, `;`, `:`, `)`, `]`, `'`, `"`) is
 * stripped from the captured URL and appended to the following plain-text
 * segment so no visible characters are lost.  Path-internal dots are unaffected
 * because the regex only strips a trailing RUN at the very end of the match.
 *
 * @example
 * detectUrls("See https://example.com for details")
 * // [{ type: "text", value: "See " }, { type: "url", value: "https://example.com" }, { type: "text", value: " for details" }]
 */
export function detectUrls(text: string): UrlSegment[] {
  const segments: UrlSegment[] = []
  let lastIndex = 0
  let pendingTrailing = "" // punctuation stripped from the previous URL match
  URL_RE.lastIndex = 0

  let m: RegExpExecArray | null
  while ((m = URL_RE.exec(text)) !== null) {
    // Build the interstitial text: any stripped trailing chars from the
    // previous URL plus whatever literal text lies between matches.
    const interstitial = pendingTrailing + text.slice(lastIndex, m.index)
    if (interstitial) {
      segments.push({ type: "text", value: interstitial })
    }

    // Strip trailing punctuation from this match; stash stripped chars so they
    // can be prepended to the next text segment (preserving visible output).
    const raw = m[0]
    const trailingMatch = TRAILING_PUNCT_RE.exec(raw)
    const urlValue = trailingMatch ? raw.slice(0, trailingMatch.index) : raw
    pendingTrailing = trailingMatch ? trailingMatch[0] : ""

    segments.push({ type: "url", value: urlValue })
    lastIndex = m.index + raw.length
  }

  // Flush any remaining text plus any pending trailing punctuation.
  const tail = pendingTrailing + text.slice(lastIndex)
  if (tail) {
    segments.push({ type: "text", value: tail })
  } else if (segments.length === 0) {
    // text was empty or contained no URLs
    segments.push({ type: "text", value: text })
  }

  return segments
}
