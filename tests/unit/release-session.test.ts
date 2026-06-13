/**
 * Unit tests for releaseSession — the defensive per-call teardown (Fix B).
 *
 * Guarantees the prior call's mic tracks are stopped and its peer
 * connection closed on every end path, so the next getUserMedia doesn't
 * contend with a still-live capture (the muffled-audio + can't-redial-60s
 * regressions). Must be null-safe and must NOT throw when a ringing-only
 * session has no peer connection yet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { releaseSession } from "@/modules/telephony/ui/use-web-phone"

type AnySession = Parameters<typeof releaseSession>[0]

beforeEach(() => {
  // Quiet the temporary [TELEPHONY-DIAG] console.log during assertions.
  vi.spyOn(console, "log").mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
})

function fakeSession(opts: { tracks?: { stop: () => void }[]; close?: () => void }): AnySession {
  return {
    callId: "call-1",
    mediaStream: opts.tracks ? { getTracks: () => opts.tracks } : undefined,
    rtcPeerConnection: { close: opts.close ?? (() => undefined) },
  } as unknown as AnySession
}

describe("releaseSession", () => {
  it("is a no-op for a null session", () => {
    expect(() => {
      releaseSession(null)
    }).not.toThrow()
  })

  it("stops every mic track and closes the peer connection", () => {
    const t1 = { stop: vi.fn() }
    const t2 = { stop: vi.fn() }
    const close = vi.fn()
    releaseSession(fakeSession({ tracks: [t1, t2], close }))
    expect(t1.stop).toHaveBeenCalledOnce()
    expect(t2.stop).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it("does not throw when the session has no mediaStream (ringing-only)", () => {
    const close = vi.fn()
    expect(() => {
      releaseSession(fakeSession({ close }))
    }).not.toThrow()
    expect(close).toHaveBeenCalledOnce()
  })

  it("swallows a throwing peer-connection close (best-effort)", () => {
    const t1 = { stop: vi.fn() }
    expect(() => {
      releaseSession(
        fakeSession({
          tracks: [t1],
          close: () => {
            throw new Error("already closed")
          },
        }),
      )
    }).not.toThrow()
    // Track stop still happened despite the close throwing.
    expect(t1.stop).toHaveBeenCalledOnce()
  })

  it("swallows a throwing track.stop (best-effort) and still closes the PC", () => {
    const close = vi.fn()
    const bad = {
      stop: () => {
        throw new Error("track gone")
      },
    }
    expect(() => {
      releaseSession(fakeSession({ tracks: [bad], close }))
    }).not.toThrow()
    expect(close).toHaveBeenCalledOnce()
  })
})
