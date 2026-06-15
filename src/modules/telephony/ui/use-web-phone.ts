"use client"

import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import WebPhone from "ringcentral-web-phone"
import type { SipInfo } from "ringcentral-web-phone/types"
import type InboundCallSession from "ringcentral-web-phone/call-session/inbound"
import type InboundMessage from "ringcentral-web-phone/sip-message/inbound"
import { isAnsweredElsewhere } from "@/modules/telephony/inbound-cancel-reason"

/**
 * SDK lifecycle hook for the inline dialer.
 *
 * Owns:
 *  - WebPhone construction + start() / dispose() in a useEffect with
 *    cleanup
 *  - outboundCall listener (attached BEFORE start() per the SDK
 *    README — `await webPhone.call(...)` resolves AFTER the call is
 *    answered or has failed, too late to attach session listeners on
 *    the returned session)
 *  - inboundCall listener (3b — attached alongside outboundCall, also
 *    before start()). Shows an inbound_ringing state with Answer /
 *    Decline. No call-waiting in V1: an inbound that arrives while a
 *    call is active is declined immediately.
 *  - session-event listeners (ringing / answered / failed / disposed /
 *    mediaStreamSet) for BOTH directions
 *  - reducer + state machine
 *  - duration tick for the connected-state counter
 *  - ended → idle auto-transition (1.5s)
 *  - Public handlers: startCall, hangup, toggleMute, sendDtmf,
 *    answerInbound, declineInbound, setInboundContact
 *
 * Does NOT own:
 *  - Widget collapse/expand state (that lives in dialer-context.tsx)
 *  - Audit recording (the context calls recordOutboundCall /
 *    recordInboundCall via the onCallEnded / onInbound* callbacks)
 *  - Caller-ID → contact lookup (the context calls the
 *    lookupContactByPhone server action from onInboundRinging and
 *    pushes the result back via setInboundContact)
 *  - The audio element itself (the docked widget renders it, but this
 *    hook owns the ref the SDK writes srcObject to)
 *
 * SDK constraint reminder (memory:web-phone-no-runtime-token-api):
 * the SIP session authenticates via SipInfo's embedded digest
 * credentials, NOT the OAuth access token. There is NO mid-call
 * refresh because there is no token to refresh on the SDK side.
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
      // Inbound call ringing — awaiting the user's Answer / Decline.
      // `toNumber` is intentionally absent: the other party here is the
      // CALLER (`fromNumber`). `contactId` / `contactName` are filled
      // asynchronously by the caller-ID lookup (inbound_contact_resolved).
      kind: "inbound_ringing"
      sessionId: string
      fromNumber: string
      contactId?: string
      contactName?: string
      startedAt: number
    }
  | {
      kind: "connected"
      sessionId: string
      // The OTHER party's number — callee for outgoing, caller for
      // incoming. Named `toNumber` for continuity with the outbound
      // path + the shared dialer-controls render code.
      toNumber: string
      contactLabel?: string
      startedAt: number
      muted: boolean
      direction: "incoming" | "outgoing"
    }
  | {
      kind: "ended"
      sessionId: string
      toNumber: string
      contactLabel?: string
      durationMs: number
      reason?: string
      direction: "incoming" | "outgoing"
      /**
       * Reducer state immediately before transitioning to "ended".
       * Threaded through to the disposition classifier; currently
       * unused on the no-reason path (SDK's `answered` event fires
       * unreliably per 2026-06-11 [TELEPHONY-DIAG] capture) but kept
       * for future use in case SDK behavior changes.
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
  // Inbound (3b)
  | { type: "inbound_ringing"; sessionId: string; fromNumber: string }
  | { type: "inbound_contact_resolved"; contactId?: string; contactName?: string }
  | { type: "inbound_answered" }
  // Declined by the user OR abandoned by the caller before answer —
  // both return the machine to idle.
  | { type: "inbound_dismissed" }

export function assertNever(_x: never): never {
  throw new Error("use-web-phone: unhandled action")
}

export const INITIAL_STATE: DialerUiState = { kind: "idle" }

/**
 * Exported for unit testing (tests/unit/use-web-phone-reducer.test.ts).
 * Pure function of (state, action); all side effects live in the hook.
 */
export function reducer(state: DialerUiState, action: Action): DialerUiState {
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
        direction: "outgoing",
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
          direction: state.kind === "connected" ? state.direction : "outgoing",
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
          direction: "outgoing",
          previousKind: "starting",
        }
      }
      // Any other kind (already ended, idle, sdk failure, etc.) —
      // no-op. The same-kind guard makes redundant session_ended
      // dispatches safe (e.g., disposed firing after a failed event
      // we've already processed).
      return state
    case "toggle_mute":
      if (state.kind !== "connected") return state
      return { ...state, muted: !state.muted }
    case "auto_reset_to_idle":
      if (state.kind !== "ended") return state
      return { kind: "idle" }
    case "inbound_ringing":
      // Only from a quiescent machine. The hook ALSO guards (declines
      // the SDK session when busy) so this is defense-in-depth.
      if (state.kind !== "idle" && state.kind !== "ended") return state
      return {
        kind: "inbound_ringing",
        sessionId: action.sessionId,
        fromNumber: action.fromNumber,
        startedAt: Date.now(),
      }
    case "inbound_contact_resolved":
      if (state.kind !== "inbound_ringing") return state
      return { ...state, contactId: action.contactId, contactName: action.contactName }
    case "inbound_answered":
      if (state.kind !== "inbound_ringing") return state
      return {
        kind: "connected",
        sessionId: state.sessionId,
        toNumber: state.fromNumber,
        contactLabel: state.contactName,
        // Talk-time clock starts at answer (NOT ring-start) so the
        // logged duration + classifier see conversation length, not
        // how long the caller waited.
        startedAt: Date.now(),
        muted: false,
        direction: "incoming",
      }
    case "inbound_dismissed":
      if (state.kind !== "inbound_ringing") return state
      return { kind: "idle" }
    default:
      assertNever(action)
  }
}

function noop(): void {
  // intentionally empty — swallows `.catch()` rejections from
  // best-effort cleanup paths (session.hangup / webPhone.dispose).
}

/** Read an inbound session's caller number defensively. The SDK's
 *  `remoteNumber` getter runs `extractNumber(remotePeer)` which can
 *  throw on an unexpected From-header shape; fall back to "" so the
 *  ring UI still appears (formatPhoneDisplay renders "" gracefully). */
function safeRemoteNumber(session: CallSession): string {
  try {
    return session.remoteNumber || ""
  } catch {
    return ""
  }
}

/**
 * Defensive per-call teardown (Fix B). Explicitly stops the mic tracks
 * and closes the RTCPeerConnection so the NEXT call's getUserMedia never
 * contends with a still-live capture of the built-in mic (the muffled-
 * audio + can't-redial-for-60s regressions). Previously we relied 100%
 * on the SDK's `dispose()`, which only runs when its dispatcher sees an
 * inbound BYE/CANCEL — not guaranteed on every end path, and not before a
 * fast re-dial from the new in-dialer keypad.
 *
 * We deliberately do NOT call `session.dispose()` here: the SDK's
 * dispose() emits "disposed" BEFORE `removeAllListeners()`, so invoking it
 * from inside our own "disposed" handler would recurse infinitely. We free
 * the same two resources (tracks + peer connection) directly; both ops are
 * idempotent, so calling this on a path where the SDK already disposed is
 * harmless.
 */
export function releaseSession(session: CallSession | null): void {
  if (!session) return
  const tracks = session.mediaStream?.getTracks() ?? []
  // eslint-disable-next-line no-console -- TELEPHONY-DIAG temporary; stripped in follow-up once Mike confirms
  console.log("[TELEPHONY-DIAG]", "releaseSession", {
    sessionId: session.callId,
    micTracks: tracks.length,
  })
  for (const track of tracks) {
    try {
      track.stop()
    } catch {
      // Track already ended — best-effort.
    }
  }
  try {
    // Typed non-null, but undefined at runtime for a ringing-only inbound
    // session that never answered (init() — which creates the PC — never
    // ran). The try/catch covers that + a double-close.
    session.rtcPeerConnection.close()
  } catch {
    // No peer connection yet, or already closed — best-effort.
  }
}

export interface UseWebPhoneArgs {
  sipInfo: unknown
  /** Called exactly once whenever a call reaches the "ended" state.
   *  The context wires this to the recordOutboundCall server action
   *  so a `call_log` row is written for every dialer call.
   *
   *  `previousKind` is the reducer state at the moment of transition
   *  (one of `"starting"` / `"ringing"` / `"connected"`); the
   *  classifier currently ignores it on the no-reason path (SDK's
   *  `answered` event fires unreliably; verified 2026-06-11) but the
   *  field is kept for future use. */
  onCallEnded?: (details: {
    durationMs: number
    reason?: string
    previousKind: "starting" | "ringing" | "connected"
    /** RC telephony session id of the just-ended call (when the SDK
     *  surfaced one) — the RC-sync Layer-2 precise reconciliation key. */
    telephonySessionId?: string
  }) => void
  /** Fired when an inbound call starts ringing. The context expands
   *  the widget and kicks off the caller-ID → contact lookup, pushing
   *  the result back via `setInboundContact`. */
  onInboundRinging?: (fromNumber: string) => void
  /** Fired the moment an inbound call is answered (SDK `answered`
   *  event). The context stamps its current-call ref with
   *  direction="incoming" so the shared `onCallEnded` path logs the
   *  row via `recordInboundCall`. */
  onInboundAnswered?: (info: { fromNumber: string; contactId?: string }) => void
  /** Fired when an inbound call ends WITHOUT being answered — the user
   *  declined or the caller hung up first. Per Option A the context
   *  logs a `no_answer` row only when `contactId` is set. */
  onInboundUnanswered?: (info: { fromNumber: string; contactId?: string }) => void
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
  startCall: (args: { phoneNumber: string; contactLabel?: string }) => void
  hangup: () => void
  toggleMute: () => void
  sendDtmf: (digit: string) => void
  /** Answer the currently-ringing inbound call. */
  answerInbound: () => void
  /** Decline the currently-ringing inbound call (RC routes per the
   *  user's rules — mobile app, voicemail, etc.). */
  declineInbound: () => void
  /** Push the caller-ID → contact lookup result into the
   *  inbound_ringing state (called by the context after the async
   *  lookup resolves). Null is a no-op (unknown caller). */
  setInboundContact: (contact: { contactId: string; name: string } | null) => void
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
  // Inbound sessions only — typed as InboundCallSession so answer() /
  // decline() (absent on the base CallSession) are callable. The same
  // session is ALSO stored in sessionRef for the shared hangup / mute /
  // dtmf controls once the call is connected.
  const inboundSessionRef = useRef<InboundCallSession | null>(null)
  // The per-inbound-call sipClient "inboundMessage" listener (reads the
  // raw CANCEL/BYE Reason header). Held in a ref so it can be removed
  // from every teardown path — including ones outside the SDK-init
  // effect (declineInbound).
  const inboundSipHandlerRef = useRef<((msg: InboundMessage) => void) | null>(null)
  // Audio element node tracked via a callback ref (set by
  // setAudioElement below). Plus a pending-stream ref so we don't
  // lose the MediaStream if it arrives before the element mounts.
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const pendingStreamRef = useRef<MediaStream | null>(null)
  const cancelledRef = useRef(false)
  // RC telephony session id of the current call, captured from the SDK at
  // end (populated by then). Threaded through onCallEnded so the row + the
  // RC-sync Layer-2 job carry the precise reconciliation key. Cleared at the
  // start of each new call so a stale id never leaks across calls.
  const telephonySessionIdRef = useRef<string | null>(null)

  // Inbound callbacks — stashed in refs so the SDK-init effect (which
  // depends only on sipInfo) always reads the latest identity without
  // re-subscribing the SDK listeners on every parent render.
  const onInboundRingingRef = useRef(args.onInboundRinging)
  const onInboundAnsweredRef = useRef(args.onInboundAnswered)
  const onInboundUnansweredRef = useRef(args.onInboundUnanswered)
  useEffect(() => {
    onInboundRingingRef.current = args.onInboundRinging
    onInboundAnsweredRef.current = args.onInboundAnswered
    onInboundUnansweredRef.current = args.onInboundUnanswered
  }, [args.onInboundRinging, args.onInboundAnswered, args.onInboundUnanswered])

  // Remove the inbound sipClient listener from any teardown path. Safe
  // to call repeatedly: the SDK's EventEmitter.off() is filter-based, so
  // removing an already-removed (or never-registered) listener is a
  // no-op. Reads webPhoneRef so it works from handlers defined outside
  // the SDK-init effect (e.g. declineInbound).
  const detachInboundSipHandler = useCallback(() => {
    const handler = inboundSipHandlerRef.current
    if (!handler) return
    webPhoneRef.current?.sipClient.off("inboundMessage", handler)
    inboundSipHandlerRef.current = null
  }, [])

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

        // `mediaStreamSet` fires with the LOCAL microphone stream (NOT
        // the remote/inbound stream — verified against
        // ringcentral-web-phone@2.4.4 source at
        // `node_modules/.../call-session/index.mjs`). The SDK's
        // internal getUserMedia uses `audio: { deviceId: { exact } }`
        // which does NOT default-enable WebRTC DSP, so without these
        // constraints the OTHER party gets a raw, choppy mic stream.
        // We apply the three standard DSP constraints to the live mic
        // track. We do NOT attach this stream to our `<audio>` element
        // — remote audio is handled by the SDK's internal hidden
        // element (its RTCPeerConnection.ontrack handler). Attaching
        // the local stream caused the 3a echo loop. Shared by BOTH
        // outbound and inbound sessions — inbound `answer()` runs the
        // same `init()` and fires the same event. See
        // memory:telephony-sdk-mediastreamset-gotcha.
        const attachMicDsp = (session: CallSession) => {
          session.on("mediaStreamSet", (stream: MediaStream) => {
            stream.getAudioTracks().forEach((track) => {
              void track
                .applyConstraints({
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                })
                .catch(() => {
                  // Browser may not support runtime constraint changes
                  // on a live audio track; degrades to raw mic (no
                  // worse than before). Silent self-heal.
                })
            })
          })
        }

        // Listener for inbound call sessions — attached BEFORE start()
        // so we never miss the inboundCall emission. The SDK has
        // already auto-replied 100 Trying + 180 Ringing by the time
        // this fires; we drive the Answer/Decline UI from here.
        phone.on("inboundCall", (session: InboundCallSession) => {
          const cur = stateRef.current
          // No call-waiting in V1: if a call is already active (or
          // ringing), decline the newcomer immediately so RC routes it
          // per the user's rules (mobile app, voicemail, etc.).
          if (cur.kind !== "idle" && cur.kind !== "ended") {
            void session.decline().catch(noop)
            return
          }
          sessionRef.current = session
          inboundSessionRef.current = session
          telephonySessionIdRef.current = null
          const sessionId = session.callId || `inbound-${Date.now().toString(36)}`
          const fromNumber = safeRemoteNumber(session)
          dispatch({ type: "inbound_ringing", sessionId, fromNumber })
          onInboundRingingRef.current?.(fromNumber)

          session.on("answered", () => {
            // Read the pre-dispatch snapshot (stateRef updates via an
            // effect AFTER render, so it still holds inbound_ringing
            // here) to capture the resolved contactId for logging.
            const snap = stateRef.current
            dispatch({ type: "inbound_answered" })
            if (snap.kind === "inbound_ringing") {
              onInboundAnsweredRef.current?.({
                fromNumber: snap.fromNumber,
                contactId: snap.contactId,
              })
            }
          })
          // Pre-answer teardown classifier. RC rings ALL of the user's
          // devices at once; when the call is answered on another device
          // (cell, mobile app, desk phone), RC cancels THIS leg with a
          // CANCEL carrying `Reason: SIP;cause=200;text="Call completed
          // elsewhere"`. That is NOT a miss — logging a no_answer row for
          // it would be false data on most calls for a phone-first user.
          // The SDK's `disposed` event carries no payload (dispose()
          // emits with no args — verified in call-session/index.mjs), so
          // we read the raw CANCEL/BYE off the sipClient channel where
          // the Reason header is visible. Registered AFTER the SDK's own
          // dispatcher, so `disposed` (below) fires first; the
          // inbound_ringing teardown decision therefore lives HERE. The
          // SDK's emit() iterates a snapshot, so a detach during the same
          // emit never skips this handler.
          const sipMsgHandler = (msg: InboundMessage) => {
            if (msg.headers["Call-Id"] !== session.callId) return
            const cseq = msg.headers.CSeq ?? ""
            if (!cseq.endsWith(" CANCEL") && !cseq.endsWith(" BYE")) return
            const snap = stateRef.current
            if (snap.kind === "inbound_ringing") {
              if (isAnsweredElsewhere(msg.headers.Reason)) {
                // Answered on another device — write NO Pathway row. RC's
                // own call log has it; a future call-log sync imports it.
              } else {
                // Genuine caller abandonment before answer.
                onInboundUnansweredRef.current?.({
                  fromNumber: snap.fromNumber,
                  contactId: snap.contactId,
                })
              }
              dispatch({ type: "inbound_dismissed" })
            }
            // else: an answered call's BYE — the disposed handler drives
            // the shared ended/log path.
            releaseSession(sessionRef.current)
            detachInboundSipHandler()
            sessionRef.current = null
            inboundSessionRef.current = null
          }
          phone.sipClient.on("inboundMessage", sipMsgHandler)
          inboundSipHandlerRef.current = sipMsgHandler

          session.on("failed", () => {
            const snap = stateRef.current
            if (session.sessionId) telephonySessionIdRef.current = session.sessionId
            if (snap.kind === "inbound_ringing") {
              // Technical failure before answer (negotiation error, etc.)
              // — dismiss the ring UI but write NO row: a failure is not
              // a missed call, and logging no_answer for it is false data.
              dispatch({ type: "inbound_dismissed" })
            } else {
              // Failure after answer — end the call so the shared ended
              // path logs it.
              dispatch({ type: "session_ended" })
            }
            releaseSession(sessionRef.current)
            detachInboundSipHandler()
            sessionRef.current = null
            inboundSessionRef.current = null
          })

          session.on("disposed", () => {
            const snap = stateRef.current
            if (session.sessionId) telephonySessionIdRef.current = session.sessionId
            if (snap.kind !== "inbound_ringing") {
              // Answered call ended → shared ended path logs the row.
              dispatch({ type: "session_ended" })
            }
            // The inbound_ringing teardown is handled by sipMsgHandler
            // (it needs the CANCEL's Reason header this event lacks).
            releaseSession(sessionRef.current)
            detachInboundSipHandler()
            sessionRef.current = null
            inboundSessionRef.current = null
          })
          attachMicDsp(session)
        })

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
            if (session.sessionId) telephonySessionIdRef.current = session.sessionId
            releaseSession(sessionRef.current)
            dispatch({ type: "session_ended", reason })
            sessionRef.current = null
          })
          session.on("disposed", () => {
            if (session.sessionId) telephonySessionIdRef.current = session.sessionId
            releaseSession(sessionRef.current)
            dispatch({ type: "session_ended" })
            sessionRef.current = null
          })
          // Same local-mic DSP path used for inbound — see attachMicDsp
          // definition above. The `<audio>` element + setAudioElement
          // plumbing in docked-dialer.tsx are dead-but-harmless (remote
          // audio plays through the SDK's own hidden element).
          attachMicDsp(session)
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
      // Remove any lingering inbound sipClient listener BEFORE nulling
      // webPhoneRef (detach reads it). Safe if already removed.
      detachInboundSipHandler()
      if (phoneInstance) {
        void phoneInstance.dispose()
      }
      webPhoneRef.current = null
      sessionRef.current = null
      inboundSessionRef.current = null
    }
  }, [args.sipInfo, detachInboundSipHandler])

  // ─── ended → idle auto-transition (1.5s) ───────────────────────

  useEffect(() => {
    if (state.kind !== "ended") return
    // Backstop: by the time we reach "ended" the end handler has already
    // released + nulled the session, so this is normally a no-op — but it
    // guarantees no live mic/peer-connection survives into the idle state
    // regardless of which path got us here.
    releaseSession(sessionRef.current)
    sessionRef.current = null
    inboundSessionRef.current = null
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

  // Fires exactly once on the transition into "ended".
  useEffect(() => {
    if (state.kind !== "ended") return
    const cb = onCallEndedRef.current
    if (!cb) return
    cb({
      durationMs: state.durationMs,
      reason: state.reason,
      previousKind: state.previousKind,
      telephonySessionId: telephonySessionIdRef.current ?? undefined,
    })
  }, [state])

  // ─── Handlers ────────────────────────────────────────────────────

  const startCall = useCallback((callArgs: { phoneNumber: string; contactLabel?: string }) => {
    const cur = stateRef.current
    if (cur.kind !== "idle" && cur.kind !== "ended") return
    const phone = webPhoneRef.current
    if (!phone) return
    // Safety net for the redial scenario: if a prior session ref somehow
    // lingers (an end path that didn't fire its event), release its mic +
    // peer connection NOW, before the SDK's next getUserMedia opens a new
    // capture. Normally a no-op (teardown already nulled the refs).
    releaseSession(sessionRef.current)
    sessionRef.current = null
    inboundSessionRef.current = null
    telephonySessionIdRef.current = null
    // eslint-disable-next-line no-console -- TELEPHONY-DIAG temporary; stripped in follow-up once Mike confirms
    console.log("[TELEPHONY-DIAG]", "startCall → getUserMedia imminent", {
      to: callArgs.phoneNumber,
    })
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

  // ─── Inbound handlers ────────────────────────────────────────────

  const answerInbound = useCallback(() => {
    if (stateRef.current.kind !== "inbound_ringing") return
    const session = inboundSessionRef.current
    if (!session) return
    // eslint-disable-next-line no-console -- TELEPHONY-DIAG temporary; stripped in follow-up once Mike confirms
    console.log("[TELEPHONY-DIAG]", "answerInbound → getUserMedia imminent")
    // SDK negotiates SDP and emits `answered`; our session-level
    // `answered` listener drives the state transition + onInboundAnswered.
    void session.answer().catch(noop)
  }, [])

  const declineInbound = useCallback(() => {
    const cur = stateRef.current
    if (cur.kind !== "inbound_ringing") return
    const session = inboundSessionRef.current
    if (!session) return
    // Decline only dismisses Pathway's leg — RC's other devices (cell,
    // mobile app) keep ringing, so the call may still be answered
    // elsewhere. Pathway therefore writes NOTHING on decline (a
    // no_answer row would be false data when the call is then picked up
    // on the cell). The upcoming RC call-log sync records the true
    // outcome. Contrast the caller-abandoned path (sipMsgHandler), which
    // DOES log no_answer — that's a genuine miss Pathway witnessed.
    void session.decline().catch(noop)
    // Ringing-only session (never answered) holds no mic/PC, so this is a
    // no-op today — kept for uniformity with the other teardown paths.
    releaseSession(sessionRef.current)
    dispatch({ type: "inbound_dismissed" })
    detachInboundSipHandler()
    sessionRef.current = null
    inboundSessionRef.current = null
  }, [detachInboundSipHandler])

  const setInboundContact = useCallback((contact: { contactId: string; name: string } | null) => {
    if (!contact) return
    dispatch({
      type: "inbound_contact_resolved",
      contactId: contact.contactId,
      contactName: contact.name,
    })
  }, [])

  return {
    state,
    setAudioElement,
    now,
    isReady: sdkReady,
    startCall,
    hangup,
    toggleMute,
    sendDtmf,
    answerInbound,
    declineInbound,
    setInboundContact,
  }
}
