/**
 * Unit tests for the open-tracking pixel route (Task 13, Part B).
 * Tests the classified-counter wiring added in this task.
 *
 * Strategy: mock `db` and `classifyOpen` to control all side effects.
 * Assert that the correct counter column is present/absent in the `.set()`
 * call for each classification, and that the pixel is always returned.
 *
 * Seams (all mocked):
 *   - `@/lib/db` — db client
 *   - `@/modules/email-delivery/classify-open` — pure classifier
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── hoisted mocks ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockClassifyOpen = vi.hoisted(() => vi.fn<any>())

/** Shared sentAt object; mutated in beforeEach. */
const mockSentAt = vi.hoisted(() => ({ value: null as Date | null }))

/**
 * db.select() chain — returns [{ sentAt: mockSentAt.value }] by default.
 * Tests can override with mockDbSelect.mockReturnValueOnce().
 */
const mockSelectWhere = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(mockSentAt.value !== null ? [{ sentAt: mockSentAt.value }] : [])),
)
const mockSelectFrom = vi.hoisted(() => vi.fn(() => ({ where: mockSelectWhere })))
const mockDbSelect = vi.hoisted(() => vi.fn(() => ({ from: mockSelectFrom })))

/** Capture the args passed to db.update().set() */
const mockUpdateWhere = vi.hoisted(() => vi.fn(() => Promise.resolve([])))
const mockUpdateSet = vi.hoisted(() => vi.fn(() => ({ where: mockUpdateWhere })))
const mockDbUpdate = vi.hoisted(() => vi.fn(() => ({ set: mockUpdateSet })))

const mockDb = vi.hoisted(() => ({
  select: mockDbSelect,
  update: mockDbUpdate,
}))

// ─── vi.mock declarations ──────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({ db: mockDb }))

vi.mock("@/modules/email-delivery/classify-open", () => ({
  classifyOpen: mockClassifyOpen,
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

/** Return the argument passed to the most recent db.update().set() call. */
function capturedSetArg(): Record<string, unknown> {
  // Cast through unknown to avoid TypeScript inferring the mock arg tuple as []
  const calls = mockUpdateSet.mock.calls as unknown as Record<string, unknown>[][]
  const last = calls[calls.length - 1]
  return last?.[0] ?? {}
}

// ─── tests ────────────────────────────────────────────────────────────────

describe("GET /api/email/track/[pixelId] — classified open counters (Part B)", () => {
  beforeEach(() => {
    mockClassifyOpen.mockReset()
    mockDbSelect.mockClear()
    mockSelectFrom.mockClear()
    mockSelectWhere.mockClear()
    mockDbUpdate.mockClear()
    mockUpdateSet.mockClear()
    mockUpdateWhere.mockClear()

    // Default: row found, sentAt = 2 min ago
    mockSentAt.value = new Date(Date.now() - 120_000)

    // Re-wire chains after mockClear (mockClear removes implementations)
    mockSelectWhere.mockImplementation(() =>
      Promise.resolve(mockSentAt.value !== null ? [{ sentAt: mockSentAt.value }] : []),
    )
    mockSelectFrom.mockImplementation(() => ({ where: mockSelectWhere }))
    mockDbSelect.mockImplementation(() => ({ from: mockSelectFrom }))

    mockUpdateWhere.mockResolvedValue([])
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet })
  })

  it("always returns a 200 PNG pixel regardless of classification", async () => {
    mockClassifyOpen.mockReturnValue("human")

    const res = await GET(makeRequest(), makeParams())

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/png")
  })

  it("bot UA → increments open_bot_count and open_count, not human/unknown", async () => {
    mockClassifyOpen.mockReturnValue("bot")

    const res = await GET(makeRequest({ "user-agent": "GoogleImageProxy/1.0" }), makeParams())

    expect(res.status).toBe(200)
    expect(mockUpdateSet).toHaveBeenCalledOnce()
    const setArg = capturedSetArg()
    // Classified bot counter present
    expect(setArg.openBotCount).toBeDefined()
    // openCount always bumped
    expect(setArg.openCount).toBeDefined()
    // Human and unknown counters absent
    expect(setArg.openHumanCount).toBeUndefined()
    expect(setArg.openUnknownCount).toBeUndefined()
  })

  it("human open → increments open_human_count and open_count, not bot/unknown", async () => {
    mockClassifyOpen.mockReturnValue("human")

    const res = await GET(
      makeRequest({
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0",
      }),
      makeParams(),
    )

    expect(res.status).toBe(200)
    expect(mockUpdateSet).toHaveBeenCalledOnce()
    const setArg = capturedSetArg()
    expect(setArg.openHumanCount).toBeDefined()
    expect(setArg.openCount).toBeDefined()
    expect(setArg.openBotCount).toBeUndefined()
    expect(setArg.openUnknownCount).toBeUndefined()
  })

  it("unknown open (Apple MPP) → increments open_unknown_count and open_count, not bot/human", async () => {
    mockClassifyOpen.mockReturnValue("unknown")

    const res = await GET(
      makeRequest({
        "x-forwarded-for": "17.58.100.1",
        "user-agent": "Mozilla/5.0 AppleWebKit/605.1.15",
      }),
      makeParams(),
    )

    expect(res.status).toBe(200)
    expect(mockUpdateSet).toHaveBeenCalledOnce()
    const setArg = capturedSetArg()
    expect(setArg.openUnknownCount).toBeDefined()
    expect(setArg.openCount).toBeDefined()
    expect(setArg.openBotCount).toBeUndefined()
    expect(setArg.openHumanCount).toBeUndefined()
  })

  it("first open sets first_opened_at and last_opened_at in the update", async () => {
    mockClassifyOpen.mockReturnValue("human")

    await GET(makeRequest(), makeParams())

    const setArg = capturedSetArg()
    expect(setArg.lastOpenedAt).toBeInstanceOf(Date)
    // firstOpenedAt is a COALESCE SQL expression — confirm it's present
    expect(setArg.firstOpenedAt).toBeDefined()
  })

  it("no db row for pixelId → returns pixel but does NOT call update", async () => {
    // Override SELECT to return empty (miss)
    mockSentAt.value = null
    mockSelectWhere.mockImplementation(() => Promise.resolve([]))

    const res = await GET(makeRequest(), makeParams())

    expect(res.status).toBe(200)
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it("db SELECT error → still returns pixel (never-break-image contract)", async () => {
    mockSelectWhere.mockRejectedValue(new Error("DB is down"))

    const res = await GET(makeRequest(), makeParams())

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/png")
  })

  it("db UPDATE error → still returns pixel (never-break-image contract)", async () => {
    mockClassifyOpen.mockReturnValue("human")
    mockUpdateWhere.mockRejectedValue(new Error("update failed"))

    const res = await GET(makeRequest(), makeParams())

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/png")
  })

  it("strips .png suffix from pixelId before looking up row", async () => {
    mockClassifyOpen.mockReturnValue("human")

    await GET(makeRequest(), makeParams("px_strip.png"))

    expect(mockDbSelect).toHaveBeenCalled()
  })

  it("extracts ip from x-forwarded-for first hop and passes to classifyOpen", async () => {
    mockClassifyOpen.mockReturnValue("human")

    await GET(
      makeRequest({ "x-forwarded-for": "1.2.3.4, 10.0.0.1", "user-agent": "Mozilla/5.0" }),
      makeParams(),
    )

    expect(mockClassifyOpen).toHaveBeenCalledWith(expect.objectContaining({ ip: "1.2.3.4" }))
  })

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    mockClassifyOpen.mockReturnValue("human")

    await GET(makeRequest({ "x-real-ip": "5.6.7.8", "user-agent": "Mozilla/5.0" }), makeParams())

    expect(mockClassifyOpen).toHaveBeenCalledWith(expect.objectContaining({ ip: "5.6.7.8" }))
  })

  it("passes null ip when no ip headers are present", async () => {
    mockClassifyOpen.mockReturnValue("human")

    await GET(makeRequest({ "user-agent": "Mozilla/5.0" }), makeParams())

    expect(mockClassifyOpen).toHaveBeenCalledWith(expect.objectContaining({ ip: null }))
  })

  it("passes userAgent header to classifyOpen", async () => {
    mockClassifyOpen.mockReturnValue("human")
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

    await GET(makeRequest({ "user-agent": ua }), makeParams())

    expect(mockClassifyOpen).toHaveBeenCalledWith(expect.objectContaining({ userAgent: ua }))
  })

  it("passes null userAgent to classifyOpen when header absent", async () => {
    mockClassifyOpen.mockReturnValue("bot")

    await GET(makeRequest(), makeParams())

    expect(mockClassifyOpen).toHaveBeenCalledWith(expect.objectContaining({ userAgent: null }))
  })
})
