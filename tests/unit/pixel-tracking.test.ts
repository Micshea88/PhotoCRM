/**
 * Unit tests for `recordPixelOpen` (email-log/pixel-tracking) — the open-tracking
 * classified-counter logic (Task 13), which moved out of the pixel ROUTE and into
 * this module in T2.6 (AGENTS rule-1 boundary). These tests preserve the
 * counter-column assertions the brief required: bot → open_bot_count,
 * human → open_human_count, unknown → open_unknown_count, first-open timestamps,
 * and no-row → no update.
 *
 * Seams (all mocked):
 *   - `@/lib/db` — db client
 *   - `@/modules/email-delivery/classify-open` — pure classifier
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockClassifyOpen = vi.hoisted(() => vi.fn<any>())

/** Shared sentAt object; mutated in beforeEach. */
const mockSentAt = vi.hoisted(() => ({ value: null as Date | null }))

// db.select().from().where() → [{ sentAt }]  (recordPixelOpen has no .limit())
const mockSelectWhere = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(mockSentAt.value !== null ? [{ sentAt: mockSentAt.value }] : [])),
)
const mockSelectFrom = vi.hoisted(() => vi.fn(() => ({ where: mockSelectWhere })))
const mockDbSelect = vi.hoisted(() => vi.fn(() => ({ from: mockSelectFrom })))

// db.update().set().where() — capture the .set() arg
const mockUpdateWhere = vi.hoisted(() => vi.fn(() => Promise.resolve([])))
const mockUpdateSet = vi.hoisted(() => vi.fn(() => ({ where: mockUpdateWhere })))
const mockDbUpdate = vi.hoisted(() => vi.fn(() => ({ set: mockUpdateSet })))

const mockDb = vi.hoisted(() => ({ select: mockDbSelect, update: mockDbUpdate }))

vi.mock("@/lib/db", () => ({ db: mockDb }))
vi.mock("@/modules/email-delivery/classify-open", () => ({ classifyOpen: mockClassifyOpen }))
vi.mock("server-only", () => ({}))

import { recordPixelOpen } from "@/modules/email-log/pixel-tracking"

/** The argument passed to the most recent db.update().set() call. */
function capturedSetArg(): Record<string, unknown> {
  const calls = mockUpdateSet.mock.calls as unknown as Record<string, unknown>[][]
  const last = calls[calls.length - 1]
  return last?.[0] ?? {}
}

describe("recordPixelOpen — classified open counters", () => {
  beforeEach(() => {
    mockClassifyOpen.mockReset()
    mockDbSelect.mockClear()
    mockSelectFrom.mockClear()
    mockSelectWhere.mockClear()
    mockDbUpdate.mockClear()
    mockUpdateSet.mockClear()
    mockUpdateWhere.mockClear()

    // Default: row found, sentAt = 2 min ago.
    mockSentAt.value = new Date(Date.now() - 120_000)
    mockSelectWhere.mockImplementation(() =>
      Promise.resolve(mockSentAt.value !== null ? [{ sentAt: mockSentAt.value }] : []),
    )
    mockSelectFrom.mockImplementation(() => ({ where: mockSelectWhere }))
    mockDbSelect.mockImplementation(() => ({ from: mockSelectFrom }))
    mockUpdateWhere.mockResolvedValue([])
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet })
  })

  it("bot → increments open_bot_count and open_count, not human/unknown", async () => {
    mockClassifyOpen.mockReturnValue("bot")
    await recordPixelOpen("px_abc123", { ip: null, userAgent: "GoogleImageProxy/1.0" })
    expect(mockUpdateSet).toHaveBeenCalledOnce()
    const setArg = capturedSetArg()
    expect(setArg.openBotCount).toBeDefined()
    expect(setArg.openCount).toBeDefined()
    expect(setArg.openHumanCount).toBeUndefined()
    expect(setArg.openUnknownCount).toBeUndefined()
  })

  it("human → increments open_human_count and open_count, not bot/unknown", async () => {
    mockClassifyOpen.mockReturnValue("human")
    await recordPixelOpen("px_abc123", { ip: "1.2.3.4", userAgent: "Mozilla/5.0 Chrome/124" })
    const setArg = capturedSetArg()
    expect(setArg.openHumanCount).toBeDefined()
    expect(setArg.openCount).toBeDefined()
    expect(setArg.openBotCount).toBeUndefined()
    expect(setArg.openUnknownCount).toBeUndefined()
  })

  it("unknown (Apple MPP) → increments open_unknown_count and open_count, not bot/human", async () => {
    mockClassifyOpen.mockReturnValue("unknown")
    await recordPixelOpen("px_abc123", { ip: "17.58.100.1", userAgent: "Mozilla/5.0 AppleWebKit" })
    const setArg = capturedSetArg()
    expect(setArg.openUnknownCount).toBeDefined()
    expect(setArg.openCount).toBeDefined()
    expect(setArg.openBotCount).toBeUndefined()
    expect(setArg.openHumanCount).toBeUndefined()
  })

  it("first open sets first_opened_at and last_opened_at in the update", async () => {
    mockClassifyOpen.mockReturnValue("human")
    await recordPixelOpen("px_abc123", { ip: null, userAgent: "Mozilla/5.0" })
    const setArg = capturedSetArg()
    expect(setArg.lastOpenedAt).toBeInstanceOf(Date)
    expect(setArg.firstOpenedAt).toBeDefined() // COALESCE(first_opened_at, now())
  })

  it("classify receives msSinceSend derived from sentAt", async () => {
    mockClassifyOpen.mockReturnValue("human")
    await recordPixelOpen("px_abc123", { ip: null, userAgent: "Mozilla/5.0" })
    const arg = mockClassifyOpen.mock.calls[0]?.[0] as { msSinceSend: unknown }
    expect(typeof arg.msSinceSend).toBe("number")
    expect(arg.msSinceSend as number).toBeGreaterThan(0)
  })

  it("no db row for pixelId → does NOT call update (miss)", async () => {
    mockSentAt.value = null
    mockSelectWhere.mockImplementation(() => Promise.resolve([]))
    await recordPixelOpen("px_missing", { ip: null, userAgent: "Mozilla/5.0" })
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })
})
