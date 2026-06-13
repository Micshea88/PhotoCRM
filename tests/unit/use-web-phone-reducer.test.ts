/**
 * Unit tests for the dialer reducer (use-web-phone.ts) — inbound (3b)
 * transitions plus the outbound direction regression guards.
 *
 * The reducer is a pure function of (state, action); all SDK side
 * effects live in the hook, so these transitions are testable in
 * isolation. Importing use-web-phone pulls in the `ringcentral-web-phone`
 * SDK module, but the SDK only touches browser globals (RTCPeerConnection
 * etc.) inside method bodies at runtime — module load is side-effect-free,
 * so no mocks are needed here.
 *
 * Contract under test:
 *   - idle → inbound_ringing carries the caller number.
 *   - inbound_contact_resolved patches name/contactId onto the ring.
 *   - inbound_answered → connected(direction="incoming"), other party
 *     is the caller, talk clock resets at answer.
 *   - inbound_dismissed (decline/abandon) → idle.
 *   - answered inbound that ends → ended(direction="incoming").
 *   - Busy guard: an inbound that arrives mid-call is a no-op (the hook
 *     declines it; the reducer must not transition).
 *   - Outbound path still stamps direction="outgoing" end-to-end.
 */
import { describe, it, expect } from "vitest"
import { reducer, INITIAL_STATE, type DialerUiState } from "@/modules/telephony/ui/use-web-phone"

const idle: DialerUiState = { kind: "idle" }

describe("dialer reducer — inbound transitions", () => {
  it("idle + inbound_ringing → inbound_ringing with the caller number", () => {
    const next = reducer(idle, {
      type: "inbound_ringing",
      sessionId: "s1",
      fromNumber: "5551234567",
    })
    expect(next.kind).toBe("inbound_ringing")
    if (next.kind !== "inbound_ringing") throw new Error("unreachable")
    expect(next.fromNumber).toBe("5551234567")
    expect(next.sessionId).toBe("s1")
    expect(typeof next.startedAt).toBe("number")
    expect(next.contactId).toBeUndefined()
    expect(next.contactName).toBeUndefined()
  })

  it("inbound_contact_resolved patches the matched contact onto the ring", () => {
    const ringing = reducer(idle, {
      type: "inbound_ringing",
      sessionId: "s1",
      fromNumber: "5551234567",
    })
    const next = reducer(ringing, {
      type: "inbound_contact_resolved",
      contactId: "c1",
      contactName: "Ada Lovelace",
    })
    expect(next.kind).toBe("inbound_ringing")
    if (next.kind !== "inbound_ringing") throw new Error("unreachable")
    expect(next.contactId).toBe("c1")
    expect(next.contactName).toBe("Ada Lovelace")
    // The number is preserved across the resolve.
    expect(next.fromNumber).toBe("5551234567")
  })

  it("inbound_answered → connected(direction=incoming), other party = caller", () => {
    const ringing = reducer(idle, {
      type: "inbound_ringing",
      sessionId: "s1",
      fromNumber: "5551234567",
    })
    const resolved = reducer(ringing, {
      type: "inbound_contact_resolved",
      contactId: "c1",
      contactName: "Ada Lovelace",
    })
    const next = reducer(resolved, { type: "inbound_answered" })
    expect(next.kind).toBe("connected")
    if (next.kind !== "connected") throw new Error("unreachable")
    expect(next.direction).toBe("incoming")
    expect(next.toNumber).toBe("5551234567")
    expect(next.contactLabel).toBe("Ada Lovelace")
    expect(next.muted).toBe(false)
  })

  it("inbound_dismissed (decline or abandon) → idle", () => {
    const ringing = reducer(idle, {
      type: "inbound_ringing",
      sessionId: "s1",
      fromNumber: "5551234567",
    })
    expect(reducer(ringing, { type: "inbound_dismissed" })).toEqual({ kind: "idle" })
  })

  it("answered inbound that ends → ended(direction=incoming, previousKind=connected)", () => {
    const ringing = reducer(idle, {
      type: "inbound_ringing",
      sessionId: "s1",
      fromNumber: "5551234567",
    })
    const connected = reducer(ringing, { type: "inbound_answered" })
    const next = reducer(connected, { type: "session_ended" })
    expect(next.kind).toBe("ended")
    if (next.kind !== "ended") throw new Error("unreachable")
    expect(next.direction).toBe("incoming")
    expect(next.previousKind).toBe("connected")
  })

  it("busy guard: inbound_ringing while connected is a no-op", () => {
    const connected: DialerUiState = {
      kind: "connected",
      sessionId: "out1",
      toNumber: "5559998888",
      startedAt: Date.now(),
      muted: false,
      direction: "outgoing",
    }
    const next = reducer(connected, {
      type: "inbound_ringing",
      sessionId: "s2",
      fromNumber: "5551234567",
    })
    expect(next).toBe(connected)
  })

  it("inbound_answered from idle is a no-op (no ringing session)", () => {
    expect(reducer(idle, { type: "inbound_answered" })).toBe(idle)
  })

  it("inbound_dismissed is idempotent from idle (answered-elsewhere & double-teardown safety)", () => {
    // The answered-elsewhere and pre-answer-failed paths both resolve to
    // inbound_dismissed, and the disposed + sipMsgHandler listeners can
    // each fire for one teardown. A dismissal once already idle must be a
    // no-op so a second teardown signal can't corrupt state.
    expect(reducer(idle, { type: "inbound_dismissed" })).toBe(idle)
  })

  it("failed after answer resolves through session_ended → ended(incoming)", () => {
    // The hook's inbound `failed` listener dispatches session_ended when
    // the call was already answered; the reducer must carry the incoming
    // direction through so it logs as an inbound call.
    const ringing = reducer(idle, {
      type: "inbound_ringing",
      sessionId: "s1",
      fromNumber: "5551234567",
    })
    const connected = reducer(ringing, { type: "inbound_answered" })
    const ended = reducer(connected, { type: "session_ended", reason: "failed" })
    expect(ended.kind).toBe("ended")
    if (ended.kind !== "ended") throw new Error("unreachable")
    expect(ended.direction).toBe("incoming")
  })
})

describe("dialer reducer — outbound direction regression guards", () => {
  it("idle + dial (from the idle DialPad's Call) → starting with the typed number", () => {
    const next = reducer(idle, { type: "dial", toNumber: "7275551234" })
    expect(next.kind).toBe("starting")
    if (next.kind !== "starting") throw new Error("unreachable")
    expect(next.toNumber).toBe("7275551234")
  })

  it("session_answered stamps direction=outgoing", () => {
    const starting = reducer(INITIAL_STATE, { type: "dial", toNumber: "5559998888" })
    const ringing = reducer(starting, { type: "session_ringing", sessionId: "out1" })
    const connected = reducer(ringing, { type: "session_answered" })
    expect(connected.kind).toBe("connected")
    if (connected.kind !== "connected") throw new Error("unreachable")
    expect(connected.direction).toBe("outgoing")
  })

  it("outbound connected → ended keeps direction=outgoing", () => {
    const starting = reducer(INITIAL_STATE, { type: "dial", toNumber: "5559998888" })
    const ringing = reducer(starting, { type: "session_ringing", sessionId: "out1" })
    const connected = reducer(ringing, { type: "session_answered" })
    const ended = reducer(connected, { type: "session_ended" })
    expect(ended.kind).toBe("ended")
    if (ended.kind !== "ended") throw new Error("unreachable")
    expect(ended.direction).toBe("outgoing")
  })
})
