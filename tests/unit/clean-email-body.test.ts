/**
 * Unit tests for `cleanEmailBody` (and its thin wrapper `buildBodyPreview`).
 *
 * Covers:
 *  1. html → plain text (strip tags)
 *  2. Quoted-reply `>` line stripping
 *  3. "On <date>… wrote:" marker: drop that line and everything after
 *  4. Tracking-pixel <img> stripping
 *  5. Full-length call (no maxLen) — NOT truncated regardless of length
 *  6. maxLen = 140 — truncates with ellipsis
 *  7. Null / empty input
 *  8. buildBodyPreview — thin wrapper preserves existing behavior
 */
import { describe, it, expect } from "vitest"
// Import from body-cleaner (pure utils, no server-only deps) rather than
// inbound.ts, which pulls in db/env/Resend and triggers the server-only guard.
import { cleanEmailBody, buildBodyPreview } from "@/modules/email-log/body-cleaner"

describe("cleanEmailBody", () => {
  it("returns null for null input", () => {
    expect(cleanEmailBody(null)).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(cleanEmailBody("")).toBeNull()
  })

  // ── HTML → plain text ───────────────────────────────────────────────────

  it("strips HTML tags and collapses whitespace", () => {
    expect(cleanEmailBody("<p>Hello <b>world</b></p>")).toBe("Hello world")
  })

  it("converts HTML body to clean plain text", () => {
    const html = "<div>Thanks for the update!</div><br /><p>See you soon.</p>"
    const result = cleanEmailBody(html)
    expect(result).toBe("Thanks for the update! See you soon.")
  })

  // ── Quoted `>` line stripping ───────────────────────────────────────────

  it("drops lines beginning with '>'", () => {
    const body = "Thanks!\n> On Monday you wrote:\n> Please review the gallery."
    const result = cleanEmailBody(body)
    expect(result).not.toBeNull()
    expect(result!).toContain("Thanks!")
    expect(result!).not.toContain(">")
  })

  it("returns null when only > quoted content remains", () => {
    const body = "> quoted line\n> another quoted line"
    expect(cleanEmailBody(body)).toBeNull()
  })

  // ── "On … wrote:" marker ─────────────────────────────────────────────────

  it("drops everything from the 'On … wrote:' plain-text marker onward", () => {
    const body =
      "Sounds great!\n\nOn Mon, Jan 1, 2026 at 12:00 PM, Alice <alice@example.com> wrote:\nOriginal message here."
    const result = cleanEmailBody(body)
    expect(result).not.toBeNull()
    expect(result!).toContain("Sounds great!")
    expect(result!).not.toMatch(/wrote:/i)
    expect(result!).not.toContain("Original message")
  })

  it("drops the HTML-wrapped 'On … wrote:' quote header and everything after", () => {
    const html =
      "<p>Thanks!</p>\n<div>On Wed, Jul 1, 2026 at 10:00 AM, Bob &lt;bob@studio.com&gt; wrote:</div>\n<blockquote><p>Earlier content</p></blockquote>"
    const result = cleanEmailBody(html)
    expect(result).not.toBeNull()
    expect(result!).toContain("Thanks!")
    expect(result!).not.toMatch(/wrote:/i)
    expect(result!).not.toContain("Earlier content")
  })

  it("is case-insensitive for the 'on … wrote:' marker", () => {
    const body = "Hello\non saturday alice wrote:\nsome old text"
    const result = cleanEmailBody(body)
    expect(result).not.toBeNull()
    expect(result!).toContain("Hello")
    expect(result!).not.toMatch(/wrote:/i)
  })

  // ── Tracking pixel stripping ────────────────────────────────────────────

  it("strips our own tracking-pixel img tag", () => {
    const withPixel =
      '<p>Got it!</p><img src="https://app.example.com/api/email/track/abc123.png" width="1" height="1" alt="" style="display:none" />'
    const result = cleanEmailBody(withPixel)
    expect(result).not.toBeNull()
    expect(result!).toContain("Got it!")
    expect(result!).not.toContain("/api/email/track/")
    expect(result!).not.toContain("<img")
  })

  it("strips the tracking pixel even when nested in a reply", () => {
    const body =
      'Thanks!\n> <img src="/api/email/track/xyz.png" /> Original quote\n> more quoted text'
    const result = cleanEmailBody(body)
    // The > lines are filtered, so the pixel disappears with them —
    // but even without the > filter, the pixel regex fires first.
    expect(result).not.toBeNull()
    expect(result!).not.toContain("/api/email/track/")
  })

  // ── maxLen / truncation ──────────────────────────────────────────────────

  it("does NOT truncate when no maxLen is provided (full-length)", () => {
    const long = "A".repeat(500)
    const result = cleanEmailBody(long)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(500)
    expect(result!.endsWith("…")).toBe(false)
  })

  it("does NOT truncate when content is shorter than maxLen", () => {
    expect(cleanEmailBody("Short", { maxLen: 140 })).toBe("Short")
  })

  it("truncates to maxLen and appends ellipsis", () => {
    const long = "A".repeat(200)
    const result = cleanEmailBody(long, { maxLen: 140 })
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(140)
    expect(result!.endsWith("…")).toBe(true)
  })

  it("collapses multiple whitespace sequences to a single space", () => {
    expect(cleanEmailBody("Hello   \n\n   World")).toBe("Hello World")
  })
})

// ── buildBodyPreview — thin wrapper ──────────────────────────────────────────

describe("buildBodyPreview (thin wrapper — existing behavior preserved)", () => {
  it("returns null for null input", () => {
    expect(buildBodyPreview(null)).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(buildBodyPreview("")).toBeNull()
  })

  it("strips HTML tags and collapses whitespace", () => {
    expect(buildBodyPreview("<p>Hello <b>world</b></p>")).toBe("Hello world")
  })

  it("removes quoted reply lines (> prefix)", () => {
    const body = "Thanks!\n> On Monday you wrote:\n> Please review the gallery."
    const result = buildBodyPreview(body)
    expect(result).not.toBeNull()
    expect(result!).toContain("Thanks!")
    expect(result!).not.toContain(">")
  })

  it("caps at maxLen and appends ellipsis", () => {
    const long = "A".repeat(200)
    const result = buildBodyPreview(long, 140)
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(140)
    expect(result!.endsWith("…")).toBe(true)
  })

  it("does not truncate when content is shorter than maxLen", () => {
    expect(buildBodyPreview("Short message")).toBe("Short message")
  })

  it("collapses multiple whitespace sequences to a single space", () => {
    expect(buildBodyPreview("Hello   \n\n   World")).toBe("Hello World")
  })

  it("returns null when only quoted content remains after stripping", () => {
    const body = "> quoted line\n> another quoted line"
    expect(buildBodyPreview(body)).toBeNull()
  })
})
