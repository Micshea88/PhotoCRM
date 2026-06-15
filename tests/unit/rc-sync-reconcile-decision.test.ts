/**
 * Unit tests for the rc-sync reconciliation decision core + RC-result mapping
 * + the locked retry backoff (Build 2).
 */
import { describe, it, expect } from "vitest"
import {
  decideReconcileAction,
  mapRcResultToDisposition,
  RC_SYNC_BACKOFF_SECONDS,
  RC_SYNC_MAX_ATTEMPTS,
} from "@/modules/rc-sync/rules"

const T1 = new Date("2026-06-14T00:00:00Z")
const T2 = new Date("2026-06-14T00:05:00Z")

describe("decideReconcileAction — rule precedence", () => {
  it("Rule 0: precise telephony_session_id match wins over everything", () => {
    const d = decideReconcileAction({
      sessionMatch: { id: "row-session", rcLastModifiedTime: null },
      rcCallIdMatch: { id: "row-rc", rcLastModifiedTime: null },
      fuzzyMatchIds: ["row-fuzzy"],
      incomingLastModified: T1,
    })
    expect(d).toEqual({ action: "update", targetId: "row-session", via: "session", stale: false })
  })

  it("Rule 1: rc_call_id match when no session match", () => {
    const d = decideReconcileAction({
      sessionMatch: null,
      rcCallIdMatch: { id: "row-rc", rcLastModifiedTime: null },
      fuzzyMatchIds: ["row-fuzzy"],
      incomingLastModified: T1,
    })
    expect(d).toMatchObject({ action: "update", targetId: "row-rc", via: "rc_call_id" })
  })

  it("Rule 2: single fuzzy match merges", () => {
    const d = decideReconcileAction({
      sessionMatch: null,
      rcCallIdMatch: null,
      fuzzyMatchIds: ["row-fuzzy"],
      incomingLastModified: null,
    })
    expect(d).toEqual({ action: "update", targetId: "row-fuzzy", via: "fuzzy", stale: false })
  })

  it("Rule 2 ambiguous: >1 fuzzy match inserts instead of mis-merging", () => {
    const d = decideReconcileAction({
      sessionMatch: null,
      rcCallIdMatch: null,
      fuzzyMatchIds: ["a", "b"],
      incomingLastModified: null,
    })
    expect(d).toEqual({ action: "insert", via: "ambiguous_fuzzy" })
  })

  it("Rule 3: no match inserts", () => {
    const d = decideReconcileAction({
      sessionMatch: null,
      rcCallIdMatch: null,
      fuzzyMatchIds: [],
      incomingLastModified: null,
    })
    expect(d).toEqual({ action: "insert", via: "no_match" })
  })

  it("monotonicity: existing newer-or-equal RC truth marks the update stale", () => {
    const stale = decideReconcileAction({
      sessionMatch: { id: "r", rcLastModifiedTime: T2 },
      rcCallIdMatch: null,
      fuzzyMatchIds: [],
      incomingLastModified: T1, // incoming is OLDER → stale
    })
    expect(stale).toMatchObject({ action: "update", stale: true })

    const fresh = decideReconcileAction({
      sessionMatch: { id: "r", rcLastModifiedTime: T1 },
      rcCallIdMatch: null,
      fuzzyMatchIds: [],
      incomingLastModified: T2, // incoming is NEWER → not stale
    })
    expect(fresh).toMatchObject({ action: "update", stale: false })
  })

  it("a witnessed row (rcLastModifiedTime null) is never stale", () => {
    const d = decideReconcileAction({
      sessionMatch: { id: "r", rcLastModifiedTime: null },
      rcCallIdMatch: null,
      fuzzyMatchIds: [],
      incomingLastModified: T1,
    })
    expect(d).toMatchObject({ stale: false })
  })
})

describe("mapRcResultToDisposition", () => {
  it("maps known RC results", () => {
    expect(mapRcResultToDisposition("Call connected", 120)).toBe("completed")
    expect(mapRcResultToDisposition("Voicemail", 5)).toBe("voicemail")
    expect(mapRcResultToDisposition("Busy", 0)).toBe("busy")
    expect(mapRcResultToDisposition("Missed", 0)).toBe("no_answer")
    expect(mapRcResultToDisposition("Rejected", 0)).toBe("no_answer")
    expect(mapRcResultToDisposition("Hang Up", 0)).toBe("cancelled")
  })
  it("falls back to duration for unknown results", () => {
    expect(mapRcResultToDisposition("Weird New Result", 42)).toBe("completed")
    expect(mapRcResultToDisposition(undefined, 0)).toBe("no_answer")
  })
})

describe("retry backoff (locked schedule)", () => {
  it("is exactly 3s/10s/30s/1m/90s/3m/5m/8m/12m/15m, dead after 10", () => {
    expect([...RC_SYNC_BACKOFF_SECONDS]).toEqual([3, 10, 30, 60, 90, 180, 300, 480, 720, 900])
    expect(RC_SYNC_MAX_ATTEMPTS).toBe(10)
  })
})
