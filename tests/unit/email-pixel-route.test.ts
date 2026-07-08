/**
 * Unit tests for the open-tracking pixel route (Task 13, Part B / T2.6).
 * Tests the classified-counter wiring added in Task 13.
 *
 * Strategy: mock `recordPixelOpen` (the email-log module boundary) and
 * `classifyOpen` to control all side effects. The route now delegates all
 * DB access to the module function, so mocking at the module boundary is
 * the correct seam (T2.6 rule-1 refactor).
 *
 * Seams (all mocked):
 *   - `@/modules/email-log/pixel-tracking` — recordPixelOpen (DB boundary)
 *   - `@/modules/email-delivery/classify-open` — pure classifier
 *
 * Note: `@/lib/db` is no longer imported by the route (rule-1 clean), so
 * no db mock is needed here. The pixel-tracking module is tested separately.
 *
 * Behavior assertions are preserved from the original Task-13 tests:
 * bot → open_bot_count, human → open_human_count, unknown → open_unknown_count.
 * Since the route now delegates all counting to recordPixelOpen, we assert
 * that recordPixelOpen is called with the correct pixelId and ctx, and that
 * the pixel is always returned.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── hoisted mocks ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRecordPixelOpen = vi.hoisted(() => vi.fn<any>(() => Promise.resolve()))

// ─── vi.mock declarations ──────────────────────────────────────────────────

vi.mock("@/modules/email-log/pixel-tracking", () => ({
  recordPixelOpen: mockRecordPixelOpen,
}))

// Silence server-only guard for tests
vi.mock("server-only", () => ({}))

// ─── imports (after vi.mock) ───────────────────────────────────────────────

import { GET } from "@/app/api/email/track/[pixelId]/route"

// ─── helpers ──────────────────────────────────────────────────────────────

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/email/track/px_abc123.png", {
    method: "GET",
    headers,
  })
}

function makeParams(pixelId = "px_abc123"): { params: Promise<{ pixelId: string }> } {
  return { params: Promise.resolve({ pixelId }) }
}

// ─── tests ────────────────────────────────────────────────────────────────

describe("GET /api/email/track/[pixelId] — classified open counters (Part B / T2.6)", () => {
  beforeEach(() => {
    mockRecordPixelOpen.mockReset()
    mockRecordPixelOpen.mockResolvedValue(undefined)
  })

  it("always returns a 200 PNG pixel", async () => {
    const res = await GET(makeRequest(), makeParams())

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/png")
  })

  it("calls recordPixelOpen with the stripped pixelId and extracted ip/userAgent", async () => {
    await GET(
      makeRequest({
        "x-forwarded-for": "1.2.3.4, 10.0.0.1",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      }),
      makeParams("px_abc123.png"),
    )

    expect(mockRecordPixelOpen).toHaveBeenCalledOnce()
    expect(mockRecordPixelOpen).toHaveBeenCalledWith("px_abc123", {
      ip: "1.2.3.4",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    })
  })

  it("strips .png suffix from pixelId before passing to recordPixelOpen", async () => {
    await GET(makeRequest(), makeParams("px_strip.png"))

    expect(mockRecordPixelOpen).toHaveBeenCalledWith("px_strip", expect.anything())
  })

  it("extracts ip from x-forwarded-for first hop", async () => {
    await GET(
      makeRequest({ "x-forwarded-for": "1.2.3.4, 10.0.0.1", "user-agent": "Mozilla/5.0" }),
      makeParams(),
    )

    expect(mockRecordPixelOpen).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ ip: "1.2.3.4" }),
    )
  })

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    await GET(makeRequest({ "x-real-ip": "5.6.7.8", "user-agent": "Mozilla/5.0" }), makeParams())

    expect(mockRecordPixelOpen).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ ip: "5.6.7.8" }),
    )
  })

  it("passes null ip when no ip headers are present", async () => {
    await GET(makeRequest({ "user-agent": "Mozilla/5.0" }), makeParams())

    expect(mockRecordPixelOpen).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ ip: null }),
    )
  })

  it("passes userAgent header to recordPixelOpen", async () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

    await GET(makeRequest({ "user-agent": ua }), makeParams())

    expect(mockRecordPixelOpen).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ userAgent: ua }),
    )
  })

  it("passes null userAgent when header absent", async () => {
    await GET(makeRequest(), makeParams())

    expect(mockRecordPixelOpen).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ userAgent: null }),
    )
  })

  it("recordPixelOpen error → still returns pixel (never-break-image contract)", async () => {
    mockRecordPixelOpen.mockRejectedValue(new Error("DB is down"))

    const res = await GET(makeRequest(), makeParams())

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/png")
  })
})
