"use client"

import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import WebPhone from "ringcentral-web-phone"
import type { SipInfo } from "ringcentral-web-phone/types"

/**
 * SDK lifecycle hook for the inline dialer.
 *
 * Owns:
 *  - WebPhone construction + start() / dispose() in a useEffect with
 *    cleanup
 *  - outboundCall listener (attached BEFORE first call() per the SDK
 *    README — `await webPhone.call(...)` resolves AFTER the call is
 *    answered or has failed, too late to attach session listeners on
 *    the returned session)
 *  - session-event listeners (ringing / answered / failed / disposed /
 *    mediaStreamSet)
 *  - reducer + state machine
 *  - duration tick for the connected-state counter
 *  - ended → idle auto-transition (1.5s)
 *  - Public handlers: startCall, hangup, toggleMute, sendDtmf,
 *    transferToMobile
 *
 * Does NOT own:
 *  - Widget collapse/expand state (that lives in dialer-context.tsx)
 *  - Audit recording (the context calls recordCallTransferred via the
 *    onTransferred callback and recordOutboundCall via the
 *    onCallEnded callback — both fire on transferred calls; see
 *    onCallEnded's JSDoc below for the rationale)
 *  - The audio element itself (the docked widget renders it, but this
 *    hook owns the ref the SDK writes srcObject to)
 *
 * SDK constraint reminder (memory:web-phone-no-runtime-token-api):
 * the SIP session authenticates via SipInfo's embedded digest
 * credentials, NOT the OAuth access token. There is NO mid-call
 * refresh because there is no token to refresh on the SDK side.
 *
 * Transfer race protection (per Mike's Clarification 2): the success
 * dispatch (`session_ended` with reason="transferred") is fired
 * EXPLICITLY from the resolved-await branch of session.transfer().
 * We do NOT rely on the disposed event to fire it. If the transfer
 * throws, no dispatch happens — the user stays connected and can
 * retry. The disposed event handler always dispatches an unreasoned
 * session_ended; the reducer's existing same-kind guards make the
 * second dispatch a no-op when we already transitioned to ended.
 */

type CallSession = WebPhone["callSessions"][number]

export type DialerUiState =
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

export function assertNever(_x: never): never {
  throw new Error("use-web-phone: unhandled action")
}

const INITIAL_STATE: DialerUiState = { kind: "idle" }

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
        return {
          kind: "ended",
          sessionId: "",
          toNumber: state.toNumber,
          contactLabel: state.contactLabel,
          durationMs: 0,
          reason: action.reason,
        }
      }
      // Any other kind (already ended, idle, sdk failure, etc.) — no-op
      // Critical: this makes the transfer's explicit-dispatch + later
      // disposed-event-dispatch sequence safe (the second one is dropped).
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

function noop(): void {
  // intentionally empty — swallows `.catch()` rejections from
  // best-effort cleanup paths (session.hangup / webPhone.dispose).
}

export interface UseWebPhoneArgs {
  sipInfo: unknown
  userMobile?: string
  /** Called AFTER a successful transfer. The context wires this to
   *  the recordCallTransferred server action (audit-log entry with
   *  masked last-4 of the transfer target). */
  onTransferred?: (mobile: string) => void
  /** Called exactly once whenever a call reaches the "ended" state,
   *  REGARDLESS of how (completed / failed / transferred). The
   *  context wires this to the recordOutboundCall server action so a
   *  `call_log` row is written for every dialer call. Fires from a
   *  useEffect that watches the reducer's transition to "ended" —
   *  the reducer's same-kind guard absorbs the redundant
   *  `disposed`-event dispatch that follows a transfer's explicit
   *  session_ended, so the effect fires exactly once per call.
   *
   *  `recordCallTransferred` (forensic audit) and `recordOutboundCall`
   *  (CRM activity feed) intentionally BOTH fire on transferred
   *  calls — they serve different audiences. */
  onCallEnded?: (details: { durationMs: number; reason?: string }) => void
}

export interface UseWebPhoneResult {
  state: DialerUiState
  /** Callback ref for the remote-audio `<audio>` element. React 19's
   *  stricter `react-hooks/refs` rule forbids exposing RefObjects
   *  through context (any property access on a ref-containing object
   *  gets flagged). A callback ref avoids the issue: it's a plain
   *  function from React's perspective. The hook tracks the node
   *  internally and writes srcObject when both the node and a stream
   *  are present. */
  setAudioElement: (node: HTMLAudioElement | null) => void
  /** Re-renders every 1s while connected so render code can compute
   *  the duration as `now - state.startedAt` (purity-rule compliant). */
  now: number
  isReady: boolean
  canTransfer: boolean
  startCall: (args: { phoneNumber: string; contactLabel?: string }) => void
  hangup: () => void
  toggleMute: () => void
  sendDtmf: (digit: string) => void
  transferToMobile: () => void
}

export function useWebPhone(args: UseWebPhoneArgs): UseWebPhoneResult {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const [sdkReady, setSdkReady] = useState(false)
  const webPhoneRef = useRef<WebPhone | null>(null)
  const sessionRef = useRef<CallSession | null>(null)
  // Audio element node tracked via a callback ref (set by
  // setAudioElement below). Plus a pending-stream ref so we don't
  // lose the MediaStream if it arrives before the element mounts.
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const pendingStreamRef = useRef<MediaStream | null>(null)
  const cancelledRef = useRef(false)
  const isTransferringRef = useRef(false)

  const setAudioElement = useCallback((node: HTMLAudioElement | null) => {
    audioElementRef.current = node
    // If the SDK fired mediaStreamSet before this element mounted,
    // attach the pending stream now.
    if (node && pendingStreamRef.current) {
      node.srcObject = pendingStreamRef.current
    }
  }, [])

  // Duration tick — re-renders every 1s while connected.
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

  // ─── SDK init + cleanup ─────────────────────────────────────────

  useEffect(() => {
    let phoneInstance: WebPhone | null = null
    cancelledRef.current = false

    void (async () => {
      try {
        const phone = new WebPhone({ sipInfo: args.sipInfo as SipInfo })
        // Listener for outbound call sessions — attached BEFORE
        // start() so we never miss the outboundCall emission.
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
            // If transfer's success path already fired session_ended
            // with reason="transferred", the reducer's guard makes
            // this dispatch a no-op (state.kind is already "ended").
            dispatch({ type: "session_ended" })
            sessionRef.current = null
          })
          session.on("mediaStreamSet", (stream: MediaStream) => {
            pendingStreamRef.current = stream
            const node = audioElementRef.current
            if (node) {
              node.srcObject = stream
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
  }, [args.sipInfo])

  // ─── ended → idle auto-transition (1.5s) ───────────────────────

  useEffect(() => {
    if (state.kind !== "ended") return
    const timer = window.setTimeout(() => {
      dispatch({ type: "auto_reset_to_idle" })
    }, 1500)
    return () => {
      window.clearTimeout(timer)
    }
  }, [state.kind])

  // ─── onCallEnded fan-out (auto-log call_log row) ───────────────

  // Stash the latest callback in a ref so the effect below doesn't
  // re-fire on every parent render (fresh callback identity would
  // re-trigger the effect's dep array on no actual state change).
  const onCallEndedRef = useRef(args.onCallEnded)
  useEffect(() => {
    onCallEndedRef.current = args.onCallEnded
  }, [args.onCallEnded])

  // Fires exactly once on the transition into "ended". The reducer's
  // session_ended same-kind guard (returns the existing state ref
  // when state.kind is already "ended") makes the redundant disposed
  // dispatch that follows a transfer's explicit session_ended a
  // no-op at React's reconciliation layer, so this effect doesn't
  // double-fire.
  useEffect(() => {
    if (state.kind !== "ended") return
    const cb = onCallEndedRef.current
    if (!cb) return
    cb({ durationMs: state.durationMs, reason: state.reason })
  }, [state])

  // ─── Handlers ────────────────────────────────────────────────────

  const startCall = useCallback((callArgs: { phoneNumber: string; contactLabel?: string }) => {
    const cur = stateRef.current
    if (cur.kind !== "idle" && cur.kind !== "ended") return
    const phone = webPhoneRef.current
    if (!phone) return
    dispatch({ type: "dial", toNumber: callArgs.phoneNumber, contactLabel: callArgs.contactLabel })
    // Fire-and-forget. Per the SDK README, `await phone.call(...)`
    // resolves AFTER answered/failed; the session events drive state.
    phone.call(callArgs.phoneNumber).catch((e: unknown) => {
      const reason = e instanceof Error ? e.message : String(e)
      if (stateRef.current.kind === "starting" || stateRef.current.kind === "ringing") {
        dispatch({ type: "session_ended", reason })
      }
    })
  }, [])

  const hangup = useCallback(() => {
    const session = sessionRef.current
    if (!session) return
    void session.hangup().catch(noop)
  }, [])

  const toggleMute = useCallback(() => {
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

  const sendDtmf = useCallback((digit: string) => {
    if (stateRef.current.kind !== "connected") return
    const session = sessionRef.current
    if (!session) return
    session.sendDtmf(digit)
  }, [])

  // Capture onTransferred + userMobile in stable refs so the handler
  // identity doesn't churn on every render (which would invalidate
  // any memoization downstream).
  const userMobileRef = useRef(args.userMobile)
  const onTransferredRef = useRef(args.onTransferred)
  useEffect(() => {
    userMobileRef.current = args.userMobile
    onTransferredRef.current = args.onTransferred
  }, [args.userMobile, args.onTransferred])

  const transferToMobile = useCallback(() => {
    const cur = stateRef.current
    if (cur.kind !== "connected") return
    const session = sessionRef.current
    if (!session) return
    const target = userMobileRef.current
    if (!target) return
    isTransferringRef.current = true
    void (async () => {
      try {
        await session.transfer(target)
        // Transfer succeeded. Explicit dispatch BEFORE the disposed
        // event arrives — race-free per Clarification 2. If disposed
        // dispatches session_ended later, the reducer's same-kind
        // guard (`state.kind === "ended"` → no-op) absorbs it.
        dispatch({ type: "session_ended", reason: "transferred" })
        sessionRef.current = null
        const cb = onTransferredRef.current
        if (cb) cb(target)
      } catch {
        // Transfer failed at the SDK / RC layer. Do NOT dispatch — the
        // SIP session is still alive, the user stays connected and can
        // retry or hangup. The silent-self-healing UX applies (no
        // toast / no error surface).
        isTransferringRef.current = false
      }
    })()
  }, [])

  return {
    state,
    setAudioElement,
    now,
    isReady: sdkReady,
    canTransfer: !!args.userMobile,
    startCall,
    hangup,
    toggleMute,
    sendDtmf,
    transferToMobile,
  }
}
