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
