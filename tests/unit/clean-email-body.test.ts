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
import {
  cleanEmailBody,
  buildBodyPreview,
  decodeHtmlEntities,
} from "@/modules/email-log/body-cleaner"

// ── REAL captured Gmail payload (prod row xil9ac8293g055i9ywsjeko0, "Re: Test 2")
// Single-line HTML, entity-encoded, real gmail_quote_container. This is the exact
// shape the old line-based cleaner could never trim (LAW 7 — real payload, not a
// hand-written fixture).
const REAL_GMAIL_REPLY =
  '<div>Yes, it worked.</div><div><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">On Thu, Jul 9, 2026 at 11:08 PM Michael Shea &lt;<a href="mailto:mike@kandkphotography.com">mike@kandkphotography.com</a>&gt; wrote:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex"><div>Hey send me one back. Does this work. </div><img src="https://photo-crm-three.vercel.app/api/email/track/zt95lrv5jz5kw8v6zkpn77vi.png" width="1" height="1" alt="" style="display: none;">\r\n</blockquote></div></div>\r\n'

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

  // ── false-positive protection: never eat legitimate content ──────────────

  it("PRESERVES a stray '>' line that has real content AFTER it (no scatter-eating)", () => {
    // A client quoting inline mid-message, then continuing to write. The '>'
    // line is NOT part of a trailing quote block, so nothing after it is lost.
    const body = "Here is my answer.\n> your question was about the album\nAnd my response is yes, add it."
    const result = cleanEmailBody(body)
    expect(result).not.toBeNull()
    expect(result!).toContain("Here is my answer.")
    // The content AFTER the stray '>' line must survive.
    expect(result!).toContain("And my response is yes, add it.")
  })

  it("drops only the CONTIGUOUS trailing '>' block, keeping earlier content", () => {
    const body = "Real reply line one.\nReal reply line two.\n> quoted history 1\n> quoted history 2"
    const result = cleanEmailBody(body)
    expect(result).not.toBeNull()
    expect(result!).toContain("Real reply line one.")
    expect(result!).toContain("Real reply line two.")
    expect(result!).not.toContain("quoted history")
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

  it("strips a tracking pixel with a single-quoted src attribute", () => {
    // Some email clients (e.g. older Outlook) render attributes with single quotes.
    const withSingleQuotePixel =
      "<p>Got it!</p><img src='/api/email/track/abc123.png' width='1' height='1' />"
    const result = cleanEmailBody(withSingleQuotePixel)
    expect(result).not.toBeNull()
    expect(result!).toContain("Got it!")
    expect(result!).not.toContain("/api/email/track/")
    expect(result!).not.toContain("<img")
  })

  it("does NOT strip a regular image (non-tracking) with single-quoted src", () => {
    // The pixel strip must be scoped to /api/email/track/ paths only.
    const withRegularImage =
      "<p>See below</p><img src='https://cdn.example.com/photo.jpg' alt='photo' />"
    const result = cleanEmailBody(withRegularImage)
    // The img tag is stripped by the general HTML-tag cleaner, but the content
    // should survive and no pixel-specific logic should have run.
    expect(result).not.toBeNull()
    expect(result!).toContain("See below")
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

// ─── D1: real Gmail HTML payload (LAW 7 — assert on OUTPUT) ─────────────────

describe("cleanEmailBody — real captured Gmail reply (D1)", () => {
  it("trims the gmail_quote_container and decodes entities on the REAL payload", () => {
    const result = cleanEmailBody(REAL_GMAIL_REPLY)
    expect(result).not.toBeNull()
    // The new reply survives.
    expect(result!).toContain("Yes, it worked.")
    // The quoted history is GONE (container cut).
    expect(result!).not.toContain("Hey send me one back")
    expect(result!).not.toContain("On Thu, Jul 9")
    // HTML entities are decoded / removed — no literal &lt; &gt;.
    expect(result!).not.toContain("&lt;")
    expect(result!).not.toContain("&gt;")
    // The echoed tracking pixel is gone.
    expect(result!).not.toContain("/api/email/track/")
  })

  it("empty-guard: a bottom-posted reply (quote first, new text after) is NOT blank", () => {
    const bottomPosted =
      '<div class="gmail_quote gmail_quote_container"><blockquote class="gmail_quote"><div>Old original message.</div></blockquote></div><div>My new reply is below the quote.</div>'
    const result = cleanEmailBody(bottomPosted)
    expect(result).not.toBeNull()
    expect(result!.trim().length).toBeGreaterThan(0)
    // The user's new text must survive even though it sits after the quote.
    expect(result!).toContain("My new reply is below the quote.")
  })
})

describe("decodeHtmlEntities", () => {
  it("decodes named + numeric entities; &amp; last (no double-decode)", () => {
    expect(decodeHtmlEntities("&lt;a&gt;")).toBe("<a>")
    expect(decodeHtmlEntities("Tom &amp; Jerry")).toBe("Tom & Jerry")
    expect(decodeHtmlEntities("it&#39;s")).toBe("it's")
    expect(decodeHtmlEntities("it&#x27;s")).toBe("it's")
    expect(decodeHtmlEntities("a&nbsp;b")).toBe("a b")
    // &amp;lt; must stay &lt; (decoded once, not collapsed to <)
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;")
  })
})
