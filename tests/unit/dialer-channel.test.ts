/**
 * Unit tests for the BroadcastChannel cross-window contract that
 * connects the main app to the popup dialer (src/lib/dialer-channel.ts).
 *
 * Three layers of coverage:
 *
 *   1. Round-trip per sendX helper — post a message on one channel,
 *      receive it on a second channel with the same name. Catches
 *      accidental field renames + verifies BroadcastChannel's
 *      structured-clone preserves the payload shape (our contract
 *      uses primitives only, so functions/symbols/cycles aren't a
 *      concern; this still pins the round-trip).
 *
 *   2. Runtime guard `isDialerMessage` — 5 acceptance cases (one per
 *      valid kind) + a battery of rejection cases (wrong version,
 *      unknown kind, missing required field per kind, null, non-
 *      object, primitives).
 *
 *   3. Compile-time exhaustiveness — `expectTypeOf` pins the kind
 *      discriminator to the 5-literal union AND a switch with
 *      assertNever proves that adding a kind without handling it
 *      breaks the test compile.
 */

import { describe, it, expect, beforeEach, afterEach, expectTypeOf } from "vitest"
import {
  DIALER_CHANNEL_NAME,
  DIALER_PING_TIMEOUT_MS,
  DIALER_WINDOW_NAME,
  assertNever,
  createDialerChannel,
  isDialerMessage,
  sendDial,
  sendPing,
  sendPong,
  sendStatus,
  sendTerminate,
  type DialerMessage,
} from "@/lib/dialer-channel"

// ─── 1. Round-trip per sendX helper ────────────────────────────────

/**
 * Open a receiver, register an onmessage handler, return a promise
 * that resolves with the next payload received OR rejects after a
 * timeout (so a structured-clone failure doesn't hang the test).
 */
function receiveNext(receiver: BroadcastChannel, timeoutMs = 500): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error("receiveNext: timed out waiting for BroadcastChannel message"))
    }, timeoutMs)
    receiver.addEventListener(
      "message",
      (e) => {
        clearTimeout(t)
        resolve(e.data)
      },
      { once: true },
    )
  })
}

describe("dialer-channel — sendX round-trip on real BroadcastChannel", () => {
  let sender: BroadcastChannel
  let receiver: BroadcastChannel

  beforeEach(() => {
    sender = createDialerChannel()
    receiver = createDialerChannel()
  })
  afterEach(() => {
    sender.close()
    receiver.close()
  })

  it("v1.dial round-trip preserves all fields", async () => {
    const wait = receiveNext(receiver)
    sendDial(sender, {
      phoneNumber: "5551234567",
      contactId: "cu1d2-abc",
      contactLabel: "Jane Doe",
    })
    const received = await wait
    expect(isDialerMessage(received)).toBe(true)
    expect(received).toEqual({
      version: "v1",
      kind: "dial",
      phoneNumber: "5551234567",
      contactId: "cu1d2-abc",
      contactLabel: "Jane Doe",
    })
  })

  it("v1.status round-trip preserves all fields including durationMs", async () => {
    const wait = receiveNext(receiver)
    sendStatus(sender, {
      sessionId: "sess-abc",
      state: "connected",
      durationMs: 42_000,
      phoneNumber: "5551234567",
      contactLabel: "Jane Doe",
    })
    const received = await wait
    expect(isDialerMessage(received)).toBe(true)
    expect(received).toMatchObject({
      version: "v1",
      kind: "status",
      sessionId: "sess-abc",
      state: "connected",
      durationMs: 42_000,
    })
  })

  it("v1.ping round-trip carries popupId only", async () => {
    const wait = receiveNext(receiver)
    sendPing(sender, "popup-7f3a")
    const received = await wait
    expect(received).toEqual({ version: "v1", kind: "ping", popupId: "popup-7f3a" })
  })

  it("v1.pong round-trip carries activeSession snapshot", async () => {
    const wait = receiveNext(receiver)
    sendPong(sender, {
      popupId: "popup-7f3a",
      activeSession: {
        sessionId: "sess-xyz",
        state: "connected",
        phoneNumber: "5551234567",
        contactId: "cu1d2-abc",
        contactLabel: "Jane Doe",
        startedAt: 1_780_000_000_000,
      },
    })
    const received = await wait
    expect(received).toMatchObject({
      version: "v1",
      kind: "pong",
      popupId: "popup-7f3a",
      activeSession: { sessionId: "sess-xyz", state: "connected" },
    })
  })

  it("v1.terminate round-trip carries only version + kind", async () => {
    const wait = receiveNext(receiver)
    sendTerminate(sender)
    const received = await wait
    expect(received).toEqual({ version: "v1", kind: "terminate" })
  })

  it("constants are exported and stable", () => {
    // Pinned values — these are what live in the wire contract.
    expect(DIALER_CHANNEL_NAME).toBe("pathway-rc-dialer")
    expect(DIALER_WINDOW_NAME).toBe("pathway-rc-dialer")
    expect(DIALER_PING_TIMEOUT_MS).toBe(500)
  })
})

// ─── 2. isDialerMessage runtime guard ──────────────────────────────

describe("dialer-channel — isDialerMessage accepts valid messages", () => {
  it("accepts v1.dial with phoneNumber", () => {
    expect(isDialerMessage({ version: "v1", kind: "dial", phoneNumber: "5551234567" })).toBe(true)
  })
  it("accepts v1.status with sessionId + state", () => {
    expect(
      isDialerMessage({ version: "v1", kind: "status", sessionId: "s", state: "ringing" }),
    ).toBe(true)
  })
  it("accepts v1.ping with popupId", () => {
    expect(isDialerMessage({ version: "v1", kind: "ping", popupId: "p" })).toBe(true)
  })
  it("accepts v1.pong with popupId", () => {
    expect(isDialerMessage({ version: "v1", kind: "pong", popupId: "p" })).toBe(true)
  })
  it("accepts v1.terminate with no extra fields", () => {
    expect(isDialerMessage({ version: "v1", kind: "terminate" })).toBe(true)
  })
})

describe("dialer-channel — isDialerMessage rejects invalid messages", () => {
  it("rejects wrong version 'v2'", () => {
    expect(isDialerMessage({ version: "v2", kind: "dial", phoneNumber: "5551234567" })).toBe(false)
  })
  it("rejects unknown kind 'explode'", () => {
    expect(isDialerMessage({ version: "v1", kind: "explode" })).toBe(false)
  })
  it("rejects dial without phoneNumber", () => {
    expect(isDialerMessage({ version: "v1", kind: "dial" })).toBe(false)
  })
  it("rejects status without sessionId", () => {
    expect(isDialerMessage({ version: "v1", kind: "status", state: "ringing" })).toBe(false)
  })
  it("rejects status with unknown state literal", () => {
    expect(
      isDialerMessage({ version: "v1", kind: "status", sessionId: "s", state: "exploded" }),
    ).toBe(false)
  })
  it("rejects ping without popupId", () => {
    expect(isDialerMessage({ version: "v1", kind: "ping" })).toBe(false)
  })
  it("rejects pong without popupId", () => {
    expect(isDialerMessage({ version: "v1", kind: "pong" })).toBe(false)
  })
  it("rejects null", () => {
    expect(isDialerMessage(null)).toBe(false)
  })
  it("rejects undefined", () => {
    expect(isDialerMessage(undefined)).toBe(false)
  })
  it("rejects a primitive string", () => {
    expect(isDialerMessage("v1.dial")).toBe(false)
  })
  it("rejects a primitive number", () => {
    expect(isDialerMessage(42)).toBe(false)
  })
  it("rejects an object with no kind at all", () => {
    expect(isDialerMessage({ version: "v1" })).toBe(false)
  })
})

// ─── 3. Compile-time exhaustiveness ────────────────────────────────

describe("dialer-channel — compile-time exhaustiveness", () => {
  it("DialerMessage['kind'] is exactly the 5-literal union", () => {
    expectTypeOf<DialerMessage["kind"]>().toEqualTypeOf<
      "dial" | "status" | "ping" | "pong" | "terminate"
    >()
  })

  it("a switch over msg.kind compiles only when every kind is handled (assertNever)", () => {
    function handle(m: DialerMessage): string {
      switch (m.kind) {
        case "dial":
          return "dial"
        case "status":
          return "status"
        case "ping":
          return "ping"
        case "pong":
          return "pong"
        case "terminate":
          return "terminate"
        default:
          // If a new kind is added to DialerMessage without a case
          // above, `m` will not narrow to never here and tsc will
          // refuse the assertNever call — compile error, this test
          // file stops typechecking.
          return assertNever(m)
      }
    }
    const sample: DialerMessage = { version: "v1", kind: "dial", phoneNumber: "5551234567" }
    expect(handle(sample)).toBe("dial")
  })
})
