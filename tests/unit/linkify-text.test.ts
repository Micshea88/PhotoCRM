/**
 * Unit tests for `detectUrls` — the pure URL-detection utility used by
 * the contact-activity-feed's LinkifiedBody component.
 *
 * Covers:
 *  1. Detects a single http URL
 *  2. Detects a single https URL
 *  3. Leaves surrounding plain text intact and escaped by caller (React)
 *  4. Text with no URLs → single text segment
 *  5. Multiple URLs in one string
 *  6. Empty string
 *  7. URL at start / end of string (no surrounding text segments)
 */
import { describe, it, expect } from "vitest"
import { detectUrls } from "@/lib/linkify"

describe("detectUrls", () => {
  it("detects a single http URL", () => {
    const segments = detectUrls("Visit http://example.com for info")
    expect(segments).toHaveLength(3)
    expect(segments[0]).toEqual({ type: "text", value: "Visit " })
    expect(segments[1]).toEqual({ type: "url", value: "http://example.com" })
    expect(segments[2]).toEqual({ type: "text", value: " for info" })
  })

  it("detects a single https URL", () => {
    const segments = detectUrls("Check https://studio.com/gallery")
    const urlSeg = segments.find((s) => s.type === "url")
    expect(urlSeg).toBeDefined()
    expect(urlSeg!.value).toBe("https://studio.com/gallery")
  })

  it("preserves surrounding text verbatim (caller is responsible for escaping)", () => {
    const segments = detectUrls("Hello https://a.com world")
    const textSegs = segments.filter((s) => s.type === "text")
    expect(textSegs.map((s) => s.value)).toEqual(["Hello ", " world"])
  })

  it("returns a single text segment when no URLs are present", () => {
    const segments = detectUrls("Just a plain message, no links.")
    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual({ type: "text", value: "Just a plain message, no links." })
  })

  it("handles an empty string", () => {
    const segments = detectUrls("")
    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual({ type: "text", value: "" })
  })

  it("detects multiple URLs in one string", () => {
    const text = "See https://a.com and https://b.com for details"
    const segments = detectUrls(text)
    const urls = segments.filter((s) => s.type === "url")
    expect(urls).toHaveLength(2)
    expect(urls[0]!.value).toBe("https://a.com")
    expect(urls[1]!.value).toBe("https://b.com")
  })

  it("emits no leading text segment when URL is at the start", () => {
    const segments = detectUrls("https://example.com is great")
    expect(segments[0]).toEqual({ type: "url", value: "https://example.com" })
    expect(segments[1]).toEqual({ type: "text", value: " is great" })
  })

  it("emits no trailing text segment when URL is at the end", () => {
    const segments = detectUrls("Visit https://example.com")
    expect(segments[0]).toEqual({ type: "text", value: "Visit " })
    expect(segments[1]).toEqual({ type: "url", value: "https://example.com" })
    expect(segments).toHaveLength(2)
  })

  it("does not detect bare hostnames (no http/https prefix)", () => {
    const segments = detectUrls("Go to example.com for info")
    expect(segments).toHaveLength(1)
    expect(segments[0]!.type).toBe("text")
  })
})

// ── Trailing-punctuation stripping ───────────────────────────────────────────
//
// URLs at the end of a sentence or wrapped in punctuation must NOT include the
// punctuation in the href, but the punctuation MUST still appear as visible
// text in the surrounding segment.

describe("detectUrls — trailing punctuation stripping", () => {
  it("strips a trailing period from a sentence-ending URL", () => {
    // "Visit https://example.com." — the period ends the sentence, not the URL.
    const segments = detectUrls("Visit https://example.com.")
    const url = segments.find((s) => s.type === "url")
    const text = segments.filter((s) => s.type === "text")
    expect(url?.value).toBe("https://example.com")
    // The period must still be visible (part of a text segment)
    const allText = text.map((s) => s.value).join("")
    expect(allText).toContain(".")
  })

  it("strips a trailing exclamation mark", () => {
    // "https://studio.com/gallery!" — the bang punctuates the sentence.
    const segments = detectUrls("Check out https://studio.com/gallery!")
    const url = segments.find((s) => s.type === "url")
    const text = segments.filter((s) => s.type === "text")
    expect(url?.value).toBe("https://studio.com/gallery")
    expect(text.map((s) => s.value).join("")).toContain("!")
  })

  it("strips a trailing closing paren when URL is wrapped in parentheses", () => {
    // "(https://example.com)" — closing paren must not be in the href.
    const segments = detectUrls("(https://example.com)")
    const url = segments.find((s) => s.type === "url")
    const text = segments.filter((s) => s.type === "text")
    expect(url?.value).toBe("https://example.com")
    // Both opening and closing parens must appear as visible text
    const allText = text.map((s) => s.value).join("")
    expect(allText).toContain("(")
    expect(allText).toContain(")")
  })

  it("does NOT strip a mid-path dot (e.g. https://x.com/a.b)", () => {
    // The dot is interior to the path — must not be trimmed.
    const segments = detectUrls("See https://x.com/a.b for details")
    const url = segments.find((s) => s.type === "url")
    expect(url?.value).toBe("https://x.com/a.b")
  })

  it("preserves a trailing slash (https://x.com/path/)", () => {
    // A trailing slash is a valid URL component and must not be stripped.
    const segments = detectUrls("See https://x.com/path/ for details")
    const url = segments.find((s) => s.type === "url")
    expect(url?.value).toBe("https://x.com/path/")
  })
})
