"use client"

import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import WebPhone from "ringcentral-web-phone"
import type InboundCallSession from "ringcentral-web-phone/call-session/inbound"
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
      /**
       * Which state the reducer was in immediately before transitioning
       * to "ended". Drives the disposition classifier downstream:
       *   - "connected" → call did reach answered state; absent reason → completed
       *   - "ringing"   → call never connected; reason (SIP code) classifies
       *                   busy / no_answer / cancelled / failed
       *   - "starting"  → call failed before ringing (catch path from
       *                   phone.call()); reason classifies as failed
       *
       * Captured because the SDK's session lifecycle alone (the `failed`
       * event payload) isn't always sufficient — a `disposed` event
       * after a connected call fires with no reason and SHOULD classify
       * as completed, whereas a `disposed` after a never-connected call
       * (e.g., user hangs up mid-ring; SDK sends BYE; server returns
       * 487 raced with our local disposed) should not. previousKind
       * makes the call-reached-connected question deterministic.
       */
      previousKind: "starting" | "ringing" | "connected"
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
          previousKind: state.kind,
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
          previousKind: "starting",
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
   *  REGARDLESS of how (completed / failed / transferred / etc.).
   *  The context wires this to the recordOutboundCall server action
   *  so a `call_log` row is written for every dialer call.
   *
   *  `previousKind` is the reducer state at the moment of transition
   *  (one of `"starting"` / `"ringing"` / `"connected"`). The
   *  disposition classifier in `dialer-context.tsx` uses it together
   *  with `reason` to derive a `RecordedCallDisposition`. See the
   *  `ended`-state JSDoc above for the design rationale.
   *
   *  `recordCallTransferred` (forensic audit) and `recordOutboundCall`
   *  (CRM activity feed) intentionally BOTH fire on transferred
   *  calls — they serve different audiences. */
  onCallEnded?: (details: {
    durationMs: number
    reason?: string
    previousKind: "starting" | "ringing" | "connected"
  }) => void
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

        // INTERIM (until 3b inbound-answer UI ships): when RC sends
        // an inbound INVITE to Pathway — whether as a real inbound
        // call or as a post-transfer side-effect — immediately
        // decline it. The SDK's default behavior is to auto-reply
        // 100 Trying + 180 Ringing without confirming receipt (see
        // `node_modules/ringcentral-web-phone/dist/index.mjs:23-59`),
        // which leaves the session half-handled and surfaces as the
        // "laptop hijack" symptom: ringback audio + dialer-widget
        // ringing with no answer UI.
        //
        // Verified 2026-06-11 via [TELEPHONY-DIAG] capture: an
        // inbound INVITE arrives during Mike's transfer flow,
        // confusing RC's bridge → recipient is put on hold awaiting
        // resolution → eventually dropped. The same hijack also
        // surfaces on Mike's everyday inbound calls.
        //
        // `session.decline()` sends a `Client Reject` to RC, which
        // then routes the call per the user's RC routing rules
        // (typically mobile app first, then voicemail). We stay out
        // of the way; RC handles routing.
        //
        // The 3b push will REPLACE this handler with the actual
        // inbound-answer UI. Until then this is the deliberate
        // interim behavior.
        phone.on("inboundCall", (session: InboundCallSession) => {
          // eslint-disable-next-line no-console -- TELEPHONY-DIAG temporary
          console.log("[TELEPHONY-DIAG]", "inboundCall-event", {
            sessionId: session.callId,
            stateBefore: stateRef.current.kind,
            remotePeer: session.remotePeer,
            // SDK populates sipMessage on the InboundCallSession
            // constructor; these headers identify who/why RC is
            // calling Pathway.
            sipSubject: session.sipMessage.subject,
            sipFrom: session.sipMessage.headers.From,
            sipTo: session.sipMessage.headers.To,
            sipCallId: session.sipMessage.headers["Call-Id"],
            sipAlertInfo: session.sipMessage.headers["Alert-Info"],
            callSessionsCount: phone.callSessions.length,
            ts: Date.now(),
          })
          void session.decline().catch(() => {
            // Best-effort. If decline fails (network blip / SDK
            // weirdness), RC will time the session out on its own
            // side. The user might briefly see hijack symptoms;
            // closing the tab recovers.
          })
        })

        // Listener for outbound call sessions — attached BEFORE
        // start() so we never miss the outboundCall emission.
        phone.on("outboundCall", (session: CallSession) => {
          // eslint-disable-next-line no-console -- TELEPHONY-DIAG temporary; removed in follow-up commit
          console.log("[TELEPHONY-DIAG]", "outboundCall-event", {
            sessionId: session.callId,
            stateBefore: stateRef.current.kind,
            ts: Date.now(),
          })
          sessionRef.current = session
          const sessionId = session.callId || `local-${Date.now().toString(36)}`
          session.on("ringing", () => {
            // eslint-disable-next-line no-console -- TELEPHONY-DIAG temporary
            console.log("[TELEPHONY-DIAG]", "ringing-event", {
              stateBefore: stateRef.current.kind,
              ts: Date.now(),
            })
            dispatch({ type: "session_ringing", sessionId })
          })
          session.on("answered", () => {
            // eslint-disable-next-line no-console -- TELEPHONY-DIAG temporary
            console.log("[TELEPHONY-DIAG]", "answered-event", {
              stateBefore: stateRef.current.kind,
              ts: Date.now(),
            })
            dispatch({ type: "session_answered" })
          })
          session.on("failed", (subject: unknown) => {
            const reason = typeof subject === "string" ? subject : "failed"
            // eslint-disable-next-line no-console -- TELEPHONY-DIAG temporary
            console.log("[TELEPHONY-DIAG]", "failed-event", {
              subjectRaw: subject,
              subjectTypeof: typeof subject,
              reasonDispatched: reason,
              stateBefore: stateRef.current.kind,
              ts: Date.now(),
            })
            dispatch({ type: "session_ended", reason })
            sessionRef.current = null
          })
          session.on("disposed", () => {
            // eslint-disable-next-line no-console -- TELEPHONY-DIAG temporary
            console.log("[TELEPHONY-DIAG]", "disposed-event", {
              stateBefore: stateRef.current.kind,
              isTransferring: isTransferringRef.current,
              ts: Date.now(),
            })
            // SDK ordering reality (verified 2026-06-11): `disposed`
            // ALWAYS fires before `transferToMobile`'s `await
            // session.transfer()` resolves. The WebPhone constructor's
            // main `inboundMessage` handler is registered first; when
            // RC's BYE arrives in response to our REFER, that handler
            // splices the session and calls `dispose()` (firing
            // "disposed" synchronously) BEFORE `_transfer`'s handler
            // resolves the promise. So we tag the dispatch's reason
            // HERE based on whether a transfer is in flight, rather
            // than relying on `transferToMobile`'s later (absorbed)
            // dispatch to set it.
            if (isTransferringRef.current) {
              dispatch({ type: "session_ended", reason: "transferred" })
              isTransferringRef.current = false
            } else {
              dispatch({ type: "session_ended" })
            }
            sessionRef.current = null
          })
          // `mediaStreamSet` fires with the LOCAL microphone stream
          // (NOT the remote/inbound stream — verified against
          // ringcentral-web-phone@2.4.4 source at
          // `node_modules/.../call-session/index.mjs.map`). The SDK's
          // README at line 706-714 explicitly recommends this event
          // for applying noise reduction to the OUTBOUND mic.
          //
          // **DSP constraints required.** The SDK's internal
          // getUserMedia call uses `audio: { deviceId: { exact: ... } }`
          // with NO `echoCancellation` / `noiseSuppression` /
          // `autoGainControl` constraints. Per WebRTC convention,
          // passing an `audio` constraint object (not `audio: true`)
          // does NOT default-enable DSP processing — the recipient
          // gets the raw mic stream. Apply the three standard DSP
          // constraints here so the recipient gets clean audio.
          //
          // **DO NOT attach this stream to our `<audio>` element.**
          // The prior 3a code did exactly that (treating it as if it
          // were the REMOTE stream) which caused Mike's own mic to
          // play through Mike's own speakers — an acoustic echo loop.
          // Remote audio is handled by the SDK's internal hidden
          // audio element created in its RTCPeerConnection.ontrack
          // handler; we don't need a manual element for inbound
          // playback. The `<audio>` element in `docked-dialer.tsx`
          // plus the `audioElementRef` / `pendingStreamRef` /
          // `setAudioElement` plumbing below are now dead-but-
          // harmless code, kept in place to minimize the surgery for
          // this fix. Future cleanup: remove them entirely. See
          // memory:telephony-sdk-mediastreamset-gotcha.
          session.on("mediaStreamSet", (stream: MediaStream) => {
            stream.getAudioTracks().forEach((track) => {
              void track
                .applyConstraints({
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                })
                .catch(() => {
                  // Browser may not support runtime constraint
                  // changes on a live audio track; degrades to raw
                  // mic (no worse than today's behavior). Silent
                  // self-heal — no toast / no error surface.
                })
            })
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
    // eslint-disable-next-line no-console -- TELEPHONY-DIAG temporary; removed in follow-up commit
    console.log("[TELEPHONY-DIAG]", "onCallEnded-effect-fire", {
      stateNow: state.kind,
      durationMs: state.durationMs,
      reason: state.reason,
      previousKind: state.previousKind,
      ts: Date.now(),
    })
    const cb = onCallEndedRef.current
    if (!cb) return
    cb({
      durationMs: state.durationMs,
      reason: state.reason,
      previousKind: state.previousKind,
    })
  }, [state])

  // ─── Handlers ────────────────────────────────────────────────────

  const startCall = useCallback((callArgs: { phoneNumber: string; contactLabel?: string }) => {
    const cur = stateRef.current
    if (cur.kind !== "idle" && cur.kind !== "ended") return
    const phone = webPhoneRef.current
    if (!phone) return
    // Defensive: clear any stale isTransferringRef value left over
    // from a prior call where transfer hung without resolving (rare
    // but possible). The flag is only meaningful for the current
    // in-flight call's disposed-event-time reason tagging.
    isTransferringRef.current = false
    // eslint-disable-next-line no-console -- TELEPHONY-DIAG temporary
    console.log("[TELEPHONY-DIAG]", "startCall-dispatch-dial", {
      phoneNumber: callArgs.phoneNumber,
      stateBefore: cur.kind,
      ts: Date.now(),
    })
    dispatch({ type: "dial", toNumber: callArgs.phoneNumber, contactLabel: callArgs.contactLabel })
    // Fire-and-forget. Per the SDK README, `await phone.call(...)`
    // resolves AFTER answered/failed; the session events drive state.
    phone.call(callArgs.phoneNumber).catch((e: unknown) => {
      const reason = e instanceof Error ? e.message : String(e)
      // eslint-disable-next-line no-console -- TELEPHONY-DIAG temporary
      console.log("[TELEPHONY-DIAG]", "phone.call-catch", {
        reason,
        stateBefore: stateRef.current.kind,
        ts: Date.now(),
      })
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
        // eslint-disable-next-line no-console -- TELEPHONY-DIAG temporary
        console.log("[TELEPHONY-DIAG]", "transferToMobile-dispatch-transferred", {
          stateBefore: stateRef.current.kind,
          ts: Date.now(),
        })
        // SDK ordering reality: by the time this await resolves,
        // RC's BYE has already arrived and the SDK has fired
        // "disposed" — our disposed handler already dispatched
        // session_ended with reason="transferred" (gated on
        // isTransferringRef.current=true that we set before this
        // async block ran). The dispatch below is now redundant but
        // harmless: the reducer's same-kind guard (state.kind
        // already "ended") absorbs it. Kept for defensive symmetry
        // in case the SDK ever inverts the event ordering.
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
