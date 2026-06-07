"use client"

import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import WebPhone from "ringcentral-web-phone"
import type { SipInfo } from "ringcentral-web-phone/types"
import { formatPhoneDisplay, parsePhoneInput } from "@/lib/format/phone"
import {
  assertNever,
  createDialerChannel,
  isDialerMessage,
  sendPong,
  sendStatus,
  type DialerActiveSession,
} from "@/lib/dialer-channel"

/**
 * Popup-dialer client shell. Mounts the `ringcentral-web-phone`
 * WebPhone SDK; reads `?to=&contactId=&contactLabel=` URL params
 * for the first-dial intent; attaches a BroadcastChannel listener
 * for subsequent dials, ping/pong reattachment, and main-app-driven
 * terminate.
 *
 * SDK constraint (verified against ringcentral-web-phone@2.4.4
 * README + types): the SIP session is authenticated by `SipInfo`'s
 * embedded SIP digest credentials, NOT the OAuth access token.
 * There is NO runtime token-replacement API on WebPhone; we do NOT
 * schedule a mid-call refresh timer. A long call running past the
 * OAuth token's expiry is a non-event because the SIP session never
 * consults the OAuth token. See memory:web-phone-no-runtime-token-api
 * for the design rationale.
 *
 * Session-event flow (also from the README): `webPhone.call(callee)`
 * resolves AFTER the call is answered or has failed — too late to
 * attach session-event listeners on the returned session. Instead we
 * register `webPhone.on("outboundCall", session => ...)` ONCE at SDK
 * init and attach the per-session listeners there.
 *
 * Audio playback: the SDK emits `mediaStreamSet` on the session when
 * the remote audio MediaStream is established. We attach that stream
 * to a hidden `<audio autoPlay>`'s srcObject so the user hears the
 * other party. Without this wiring the call connects but is silent.
 *
 * SDK-ready gate: `sdkReady` (useState) toggles true after
 * `phone.start()` resolves; URL-param first-dial waits for it so the
 * popup doesn't try to place a call before the SIP registration is
 * up.
 */

type CallSession = WebPhone["callSessions"][number]

export interface DialerShellProps {
  sipInfo: unknown
  externalUserId: string
}

type DialerUiState =
  | { kind: "idle" }
  | { kind: "starting"; toNumber: string; contactLabel?: string }
  | {
      kind: "ringing"
      sessionId: string
      toNumber: string
      contactLabel?: string
      startedAt: number
    }
  | {
      kind: "connected"
      sessionId: string
      toNumber: string
      contactLabel?: string
      startedAt: number
      muted: boolean
    }
  | {
      kind: "ended"
      sessionId: string
      toNumber: string
      contactLabel?: string
      durationMs: number
      reason?: string
    }
  | { kind: "sdk_init_failed"; error: string }
  | { kind: "no_microphone"; error: string }

type Action =
  | { type: "sdk_init_failed"; error: string }
  | { type: "no_microphone"; error: string }
  | { type: "dial"; toNumber: string; contactLabel?: string }
  | { type: "session_ringing"; sessionId: string }
  | { type: "session_answered" }
  | { type: "session_ended"; reason?: string }
  | { type: "toggle_mute" }
  | { type: "auto_reset_to_idle" }

const initialState: DialerUiState = { kind: "idle" }

function reducer(state: DialerUiState, action: Action): DialerUiState {
  switch (action.type) {
    case "sdk_init_failed":
      return { kind: "sdk_init_failed", error: action.error }
    case "no_microphone":
      return { kind: "no_microphone", error: action.error }
    case "dial":
      if (state.kind !== "idle" && state.kind !== "ended") return state
      return { kind: "starting", toNumber: action.toNumber, contactLabel: action.contactLabel }
    case "session_ringing":
      if (state.kind !== "starting") return state
      return {
        kind: "ringing",
        sessionId: action.sessionId,
        toNumber: state.toNumber,
        contactLabel: state.contactLabel,
        startedAt: Date.now(),
      }
    case "session_answered":
      if (state.kind !== "ringing") return state
      return {
        kind: "connected",
        sessionId: state.sessionId,
        toNumber: state.toNumber,
        contactLabel: state.contactLabel,
        startedAt: state.startedAt,
        muted: false,
      }
    case "session_ended":
      if (state.kind === "ringing" || state.kind === "connected") {
        return {
          kind: "ended",
          sessionId: state.sessionId,
          toNumber: state.toNumber,
          contactLabel: state.contactLabel,
          durationMs: Date.now() - state.startedAt,
          reason: action.reason,
        }
      }
      if (state.kind === "starting") {
        // Call failed before ringing — synthesize an ended-state with
        // an empty sessionId so the UI has a stable shape; durationMs
        // is 0 (no time elapsed).
        return {
          kind: "ended",
          sessionId: "",
          toNumber: state.toNumber,
          contactLabel: state.contactLabel,
          durationMs: 0,
          reason: action.reason,
        }
      }
      return state
    case "toggle_mute":
      if (state.kind !== "connected") return state
      return { ...state, muted: !state.muted }
    case "auto_reset_to_idle":
      if (state.kind !== "ended") return state
      return { kind: "idle" }
    default:
      assertNever(action)
  }
}

const KEYPAD_ROWS: readonly (readonly string[])[] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"],
]

function noop(): void {
  // intentionally empty — used to swallow `.catch()` rejections from
  // best-effort cleanup paths (session.hangup / webPhone.dispose)
  // where there is no actionable error handling.
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(totalSeconds / 60)
  const ss = totalSeconds % 60
  return `${mm.toString()}:${ss.toString().padStart(2, "0")}`
}

export function DialerShell({ sipInfo, externalUserId }: DialerShellProps) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // SDK readiness signal — drives the URL-param first-dial gate.
  // Not a reducer kind because it doesn't change the user-visible UI
  // state (the kind stays "idle" before AND after SDK ready); it
  // only gates the auto-dial behavior.
  const [sdkReady, setSdkReady] = useState(false)

  const webPhoneRef = useRef<WebPhone | null>(null)
  const sessionRef = useRef<CallSession | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const searchParams = useSearchParams()
  const didUrlDialRef = useRef(false)
  // SDK-init cancellation flag. A ref instead of a `let cancelled`
  // closure variable because TypeScript's flow analysis can't see
  // through the cleanup closure to know the boolean ever mutates —
  // it would treat `if (cancelled)` as a dead branch. The ref makes
  // the mutation explicit and unblocks the no-unnecessary-condition
  // lint rule.
  const cancelledRef = useRef(false)

  // `now` state for the connected-state duration counter — re-renders
  // every 1s while connected. Stored as state (not a ref) so the
  // render path stays pure — `Date.now()` in render would violate
  // React's purity rule.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (state.kind !== "connected") return
    const interval = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      window.clearInterval(interval)
    }
  }, [state.kind])

  // ─── Event handlers ──────────────────────────────────────────────

  const handleDial = useCallback((args: { phoneNumber: string; contactLabel?: string }) => {
    const cur = stateRef.current
    if (cur.kind !== "idle" && cur.kind !== "ended") return
    const phone = webPhoneRef.current
    if (!phone) return
    dispatch({ type: "dial", toNumber: args.phoneNumber, contactLabel: args.contactLabel })
    // Fire-and-forget: per the README, `await phone.call(...)`
    // resolves AFTER the call is answered or failed, by which time
    // the session events have already fired and driven state. We
    // .catch synchronous rejections defensively.
    phone.call(args.phoneNumber).catch((e: unknown) => {
      const reason = e instanceof Error ? e.message : String(e)
      if (stateRef.current.kind === "starting" || stateRef.current.kind === "ringing") {
        dispatch({ type: "session_ended", reason })
      }
    })
  }, [])

  const handleHangup = useCallback(() => {
    const session = sessionRef.current
    if (!session) return
    // hangup() works for both ringing (CANCEL) and connected (BYE)
    // per the base CallSession surface; the SDK picks the right SIP
    // message internally.
    void session.hangup().catch(() => {
      /* swallow — session_ended will arrive via the disposed event */
    })
  }, [])

  const handleMute = useCallback(() => {
    const cur = stateRef.current
    if (cur.kind !== "connected") return
    const session = sessionRef.current
    if (!session) return
    if (cur.muted) {
      session.unmute()
    } else {
      session.mute()
    }
    dispatch({ type: "toggle_mute" })
  }, [])

  const handleKeypadDigit = useCallback((digit: string) => {
    if (stateRef.current.kind !== "connected") return
    const session = sessionRef.current
    if (!session) return
    session.sendDtmf(digit)
  }, [])

  // Stable handler ref so the channel listener (attached once at mount)
  // can call the latest handleDial without re-attaching on every render.
  const handleDialRef = useRef(handleDial)
  useEffect(() => {
    handleDialRef.current = handleDial
  }, [handleDial])

  // ─── useEffect 1: SDK init + cleanup ────────────────────────────

  useEffect(() => {
    let phoneInstance: WebPhone | null = null
    cancelledRef.current = false

    void (async () => {
      try {
        const phone = new WebPhone({ sipInfo: sipInfo as SipInfo })
        // Listener for outbound call sessions — attached BEFORE
        // start() so we never miss the outboundCall emission. Per
        // session, wire up ringing / answered / failed / disposed +
        // mediaStreamSet for audio playback.
        phone.on("outboundCall", (session: CallSession) => {
          sessionRef.current = session
          const sessionId = session.callId || `local-${Date.now().toString(36)}`
          session.on("ringing", () => {
            dispatch({ type: "session_ringing", sessionId })
          })
          session.on("answered", () => {
            dispatch({ type: "session_answered" })
          })
          session.on("failed", (subject: unknown) => {
            const reason = typeof subject === "string" ? subject : "failed"
            dispatch({ type: "session_ended", reason })
            sessionRef.current = null
          })
          session.on("disposed", () => {
            dispatch({ type: "session_ended" })
            sessionRef.current = null
          })
          // SDK emits the remote-audio MediaStream here. Attach it to
          // our hidden <audio autoPlay> so the user hears the other
          // party. Without this the call connects but is silent.
          session.on("mediaStreamSet", (stream: MediaStream) => {
            if (audioRef.current) {
              audioRef.current.srcObject = stream
            }
          })
        })
        await phone.start()
        if (cancelledRef.current) {
          void phone.dispose()
          return
        }
        phoneInstance = phone
        webPhoneRef.current = phone
        setSdkReady(true)
      } catch (e) {
        if (cancelledRef.current) return
        const errMsg = e instanceof Error ? e.message : String(e)
        const errName = e instanceof Error ? e.name : ""
        if (errName === "NotAllowedError" || errName === "NotFoundError") {
          dispatch({ type: "no_microphone", error: errMsg })
        } else {
          dispatch({ type: "sdk_init_failed", error: errMsg })
        }
      }
    })()

    return () => {
      cancelledRef.current = true
      if (phoneInstance) {
        void phoneInstance.dispose()
      }
      webPhoneRef.current = null
      sessionRef.current = null
    }
  }, [sipInfo])

  // ─── useEffect 2: BroadcastChannel listener + cleanup ────────────

  useEffect(() => {
    const channel = createDialerChannel()
    const handler = (e: MessageEvent) => {
      if (!isDialerMessage(e.data)) return
      const msg = e.data
      switch (msg.kind) {
        case "dial":
          handleDialRef.current({
            phoneNumber: msg.phoneNumber,
            contactLabel: msg.contactLabel,
          })
          break
        case "ping": {
          const cur = stateRef.current
          let activeSession: DialerActiveSession | undefined
          if (cur.kind === "ringing" || cur.kind === "connected") {
            activeSession = {
              sessionId: cur.sessionId,
              state: cur.kind,
              phoneNumber: cur.toNumber,
              contactLabel: cur.contactLabel,
              startedAt: cur.startedAt,
            }
          }
          sendPong(channel, { popupId: msg.popupId, activeSession })
          break
        }
        case "terminate":
          if (sessionRef.current) {
            void sessionRef.current.hangup().catch(noop)
          }
          if (webPhoneRef.current) {
            void webPhoneRef.current.dispose()
          }
          window.close()
          break
        case "status":
        case "pong":
          // sent by popup, not handled by popup
          break
        default:
          assertNever(msg)
      }
    }
    channel.addEventListener("message", handler)
    return () => {
      channel.removeEventListener("message", handler)
      channel.close()
    }
  }, [])

  // ─── useEffect 3: URL-param first-dial ──────────────────────────

  useEffect(() => {
    if (didUrlDialRef.current) return
    if (!sdkReady) return
    if (state.kind !== "idle") return
    const to = searchParams.get("to")
    if (!to) return
    const normalized = parsePhoneInput(to) ?? to
    const contactLabel = searchParams.get("contactLabel") ?? undefined
    didUrlDialRef.current = true
    handleDial({ phoneNumber: normalized, contactLabel })
  }, [sdkReady, state.kind, searchParams, handleDial])

  // ─── useEffect 4: beforeunload cleanup + status emission ─────────

  useEffect(() => {
    const handler = () => {
      const cur = stateRef.current
      if (sessionRef.current) {
        void sessionRef.current.hangup().catch(noop)
      }
      if (webPhoneRef.current) {
        void webPhoneRef.current.dispose()
      }
      if (cur.kind === "ringing" || cur.kind === "connected") {
        try {
          const channel = createDialerChannel()
          sendStatus(channel, {
            sessionId: cur.sessionId,
            state: "ended",
            phoneNumber: cur.toNumber,
            contactLabel: cur.contactLabel,
            durationMs: Date.now() - cur.startedAt,
          })
          channel.close()
        } catch {
          /* swallow */
        }
      }
    }
    window.addEventListener("beforeunload", handler)
    return () => {
      window.removeEventListener("beforeunload", handler)
    }
  }, [])

  // ─── useEffect 5: ended → idle auto-transition ──────────────────

  useEffect(() => {
    if (state.kind !== "ended") return
    const timer = window.setTimeout(() => {
      dispatch({ type: "auto_reset_to_idle" })
    }, 1500)
    return () => {
      window.clearTimeout(timer)
    }
  }, [state.kind])

  // ─── useEffect 6: status emission to main on state.kind change ───

  useEffect(() => {
    if (state.kind !== "ringing" && state.kind !== "connected" && state.kind !== "ended") {
      return
    }
    const channel = createDialerChannel()
    try {
      sendStatus(channel, {
        sessionId: state.sessionId,
        state: state.kind,
        phoneNumber: state.toNumber,
        contactLabel: state.contactLabel,
        durationMs: state.kind === "ended" ? state.durationMs : undefined,
      })
    } finally {
      channel.close()
    }
    // Only re-fire on state.kind transitions, not on mute toggles
    // within connected. sessionId / toNumber don't change without
    // kind changing first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind])

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className="flex h-full w-full flex-col gap-3 p-4">
      <DialerHeader externalUserId={externalUserId} state={state} />
      <DialerStatusRow state={state} now={now} />
      <DialerActions
        state={state}
        onHangup={handleHangup}
        onMute={handleMute}
        onKeypadDigit={handleKeypadDigit}
      />
      <audio ref={audioRef} autoPlay />
    </div>
  )
}

function DialerHeader({ externalUserId, state }: { externalUserId: string; state: DialerUiState }) {
  const label =
    state.kind === "starting" ||
    state.kind === "ringing" ||
    state.kind === "connected" ||
    state.kind === "ended"
      ? (state.contactLabel ?? formatPhoneDisplay(state.toNumber))
      : null
  const number =
    state.kind === "starting" ||
    state.kind === "ringing" ||
    state.kind === "connected" ||
    state.kind === "ended"
      ? formatPhoneDisplay(state.toNumber)
      : null
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      {label ? <h1 className="text-lg font-semibold">{label}</h1> : null}
      {number && number !== label ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">{number}</p>
      ) : null}
      {state.kind === "idle" ? (
        <>
          <h1 className="text-lg font-semibold">Ready to dial</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Calling as ext. {externalUserId}
          </p>
        </>
      ) : null}
    </div>
  )
}

function DialerStatusRow({ state, now }: { state: DialerUiState; now: number }) {
  switch (state.kind) {
    case "idle":
      return null
    case "starting":
      return <p className="text-center text-sm">Connecting…</p>
    case "ringing":
      return <p className="text-center text-sm">Ringing…</p>
    case "connected":
      return (
        <p className="text-center font-mono text-base">{formatDuration(now - state.startedAt)}</p>
      )
    case "ended":
      return (
        <p className="text-center text-sm text-[var(--color-muted-foreground)]">
          Call ended · {formatDuration(state.durationMs)}
        </p>
      )
    case "sdk_init_failed":
      return (
        <div className="flex flex-col items-center gap-2 p-2 text-center">
          <h1 className="text-base font-semibold">Could not start the dialer</h1>
          <p className="text-xs text-[var(--color-muted-foreground)]">{state.error}</p>
          <a href="" className="text-sm font-medium underline">
            Retry
          </a>
        </div>
      )
    case "no_microphone":
      return (
        <div className="flex flex-col items-center gap-2 p-2 text-center">
          <h1 className="text-base font-semibold">Microphone access required</h1>
          <p className="text-xs">Allow microphone access in your browser settings, then reload.</p>
          <a href="" className="text-sm font-medium underline">
            Reload
          </a>
        </div>
      )
    default:
      assertNever(state)
  }
}

function DialerActions({
  state,
  onHangup,
  onMute,
  onKeypadDigit,
}: {
  state: DialerUiState
  onHangup: () => void
  onMute: () => void
  onKeypadDigit: (digit: string) => void
}) {
  if (state.kind === "ringing") {
    return (
      <div className="mt-auto flex justify-center pb-2">
        <HangupButton onClick={onHangup} />
      </div>
    )
  }
  if (state.kind === "connected") {
    return (
      <div className="mt-auto flex flex-col items-center gap-3 pb-2">
        <Keypad onDigit={onKeypadDigit} />
        <div className="flex items-center gap-3">
          <MuteButton muted={state.muted} onClick={onMute} />
          <HangupButton onClick={onHangup} />
        </div>
      </div>
    )
  }
  return null
}

function Keypad({ onDigit }: { onDigit: (digit: string) => void }) {
  return (
    <div
      role="grid"
      aria-label="Dial pad"
      className="grid grid-cols-3 gap-1.5"
      style={{ width: "280px" }}
    >
      {KEYPAD_ROWS.flat().map((digit) => (
        <button
          key={digit}
          type="button"
          onClick={() => {
            onDigit(digit)
          }}
          className="bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md py-2.5 text-base font-medium"
        >
          {digit}
        </button>
      ))}
    </div>
  )
}

function MuteButton({ muted, onClick }: { muted: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={muted}
      aria-label={muted ? "Unmute" : "Mute"}
      onClick={onClick}
      className="bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-full px-4 py-2 text-sm font-medium"
    >
      {muted ? "Unmute" : "Mute"}
    </button>
  )
}

function HangupButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Hang up"
      onClick={onClick}
      className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-full px-6 py-2 text-sm font-medium"
    >
      Hang up
    </button>
  )
}
