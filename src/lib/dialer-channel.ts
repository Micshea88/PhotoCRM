/**
 * Cross-window message contract for the popup dialer.
 *
 * Per the locked Step-3 architecture (§2 of the audit), the popup
 * dialer is a separate browser window that holds the WebRTC SIP
 * session for RingCentral calling. The main app and the popup
 * communicate over a same-origin BroadcastChannel — no server hop,
 * no postMessage origin checks needed, survives main-app reload
 * because the popup is a peer window with its own lifecycle.
 *
 * Five message kinds (the audit's "4 message types" counts
 * ping/pong as a single conceptual discovery handshake; for clean
 * discriminated-union exhaustiveness they're 2 distinct kinds in
 * code):
 *
 *   v1.dial       main → popup      "place this call"
 *   v1.status     popup → main      "this is the live call state"
 *   v1.ping       main → popup      "any live dialer out there?"
 *   v1.pong       popup → main      "yes — and here's the active session"
 *   v1.terminate  main → popup      "shut down the popup"
 *
 * Versioned discriminator (every member carries `version: "v1"`
 * plus a `kind`) so a future v2 schema can be added without
 * breaking v1 consumers.
 *
 * DIALER_WINDOW_NAME deliberately equals DIALER_CHANNEL_NAME — when
 * a second contact card calls `window.open(url, DIALER_WINDOW_NAME,
 * ...)`, the browser FOCUSES the existing popup of that name
 * instead of opening a duplicate. A second dial reuses the open
 * dialer (which receives the new `v1.dial` via the BroadcastChannel)
 * instead of spawning dialer #2.
 *
 * Pure TypeScript: no DOM side-effects at module load. `new
 * BroadcastChannel(...)` lives inside `createDialerChannel()` so
 * server components can import the types without crashing.
 */

export const DIALER_CHANNEL_NAME = "pathway-rc-dialer"
export const DIALER_WINDOW_NAME = "pathway-rc-dialer"
export const DIALER_PING_TIMEOUT_MS = 500

export type DialerStatusState = "ringing" | "connecting" | "connected" | "ended"

/**
 * Snapshot a popup sends in its v1.pong reply so the main app can
 * re-render "call in progress" state after a reload mid-call.
 * State excludes "ended" — an ended call has no active session to
 * surface.
 */
export interface DialerActiveSession {
  sessionId: string
  state: Exclude<DialerStatusState, "ended">
  phoneNumber: string
  contactId?: string
  contactLabel?: string
  startedAt: number
}

export type DialerMessage =
  | {
      version: "v1"
      kind: "dial"
      phoneNumber: string
      contactId?: string
      contactLabel?: string
    }
  | {
      version: "v1"
      kind: "status"
      sessionId: string
      state: DialerStatusState
      durationMs?: number
      phoneNumber?: string
      contactId?: string
      contactLabel?: string
    }
  | {
      version: "v1"
      kind: "ping"
      popupId: string
    }
  | {
      version: "v1"
      kind: "pong"
      popupId: string
      activeSession?: DialerActiveSession
    }
  | {
      version: "v1"
      kind: "terminate"
    }

/** Construct a BroadcastChannel bound to the dialer contract. */
export function createDialerChannel(): BroadcastChannel {
  if (typeof window === "undefined") {
    throw new Error(
      "createDialerChannel() must be called from a browser context. Server components should import types only.",
    )
  }
  return new BroadcastChannel(DIALER_CHANNEL_NAME)
}

export function sendDial(
  channel: BroadcastChannel,
  args: { phoneNumber: string; contactId?: string; contactLabel?: string },
): void {
  const msg: DialerMessage = { version: "v1", kind: "dial", ...args }
  channel.postMessage(msg)
}

export function sendStatus(
  channel: BroadcastChannel,
  args: {
    sessionId: string
    state: DialerStatusState
    durationMs?: number
    phoneNumber?: string
    contactId?: string
    contactLabel?: string
  },
): void {
  const msg: DialerMessage = { version: "v1", kind: "status", ...args }
  channel.postMessage(msg)
}

export function sendPing(channel: BroadcastChannel, popupId: string): void {
  const msg: DialerMessage = { version: "v1", kind: "ping", popupId }
  channel.postMessage(msg)
}

export function sendPong(
  channel: BroadcastChannel,
  args: { popupId: string; activeSession?: DialerActiveSession },
): void {
  const msg: DialerMessage = { version: "v1", kind: "pong", ...args }
  channel.postMessage(msg)
}

export function sendTerminate(channel: BroadcastChannel): void {
  const msg: DialerMessage = { version: "v1", kind: "terminate" }
  channel.postMessage(msg)
}

/**
 * Runtime type guard. Use on any unknown postMessage payload before
 * narrowing — the BroadcastChannel is same-origin but nothing
 * prevents an unrelated script in another tab of this origin from
 * posting garbage to the channel.
 */
export function isDialerMessage(value: unknown): value is DialerMessage {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  if (v.version !== "v1") return false
  switch (v.kind) {
    case "dial":
      return typeof v.phoneNumber === "string"
    case "status":
      return typeof v.sessionId === "string" && isStatusState(v.state)
    case "ping":
      return typeof v.popupId === "string"
    case "pong":
      return typeof v.popupId === "string"
    case "terminate":
      return true
    default:
      return false
  }
}

function isStatusState(value: unknown): value is DialerStatusState {
  return value === "ringing" || value === "connecting" || value === "connected" || value === "ended"
}

/**
 * Call from the default branch of a `switch (msg.kind)` to force
 * the compiler to verify every kind is handled. If a new kind is
 * added to DialerMessage but not handled, the call site stops
 * compiling. Effective TypeScript Item 53.
 */
export function assertNever(_x: never): never {
  throw new Error("dialer-channel: unhandled message kind")
}
