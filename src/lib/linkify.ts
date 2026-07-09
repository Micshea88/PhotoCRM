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

/**
 * Split `text` into alternating text and url segments.
 * An empty string returns `[{ type: "text", value: "" }]`.
 * Text with no URLs returns a single text segment.
 *
 * @example
 * detectUrls("See https://example.com for details")
 * // [{ type: "text", value: "See " }, { type: "url", value: "https://example.com" }, { type: "text", value: " for details" }]
 */
export function detectUrls(text: string): UrlSegment[] {
  const segments: UrlSegment[] = []
  let lastIndex = 0
  URL_RE.lastIndex = 0

  let m: RegExpExecArray | null
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, m.index) })
    }
    segments.push({ type: "url", value: m[0] })
    lastIndex = m.index + m[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) })
  } else if (segments.length === 0) {
    segments.push({ type: "text", value: text })
  }

  return segments
}
