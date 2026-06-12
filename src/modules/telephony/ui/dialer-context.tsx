"use client"

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react"
import { recordOutboundCall } from "@/modules/calls/actions"
import { recordCallTransferred } from "@/modules/telephony/actions"
import { useWebPhone, type DialerUiState } from "./use-web-phone"

/**
 * React Context that exposes the dialer to the rest of the app.
 *
 * Mounted by app/(app)/layout.tsx wrapping ClientLayoutShell. Receives
 * the server-fetched DialerBootstrap as a prop; passes the SipInfo
 * pass-through down to useWebPhone, which constructs the SDK and runs
 * the state machine.
 *
 * When bootstrap is null (RC not connected for this user, or the
 * bootstrap fetch errored), the provider renders an EMPTY API so call
 * sites can use useDialer() unconditionally. `isAvailable=false` is
 * how call sites detect "RC not configured" state — they can choose
 * to render alternative UI (the tel: branch already handles this in
 * action-icon-row.tsx; activity-feed's "Make a call" already routes
 * to the picker when hasConnectedPhoneProvider is false).
 *
 * Widget collapse/expand state lives here, NOT in useWebPhone. Auto-
 * expand fires on startCall + on any non-idle/non-ended call-machine
 * state. The ended state's auto-reset-to-idle (1.5s) flows through —
 * after reset, widget stays expanded until user collapses it.
 */

export interface DialerBootstrapClient {
  accessToken: string
  accessTokenExpiresAt: string // ISO — Date doesn't structured-clone reliably across the boundary
  sipInfo: unknown
  externalUserId: string
  userMobile?: string
  /** Mirrors DialerBootstrap.userMobileNeedsReconnect — true when the
   *  transfer-target probe got a 403 from RC (existing user's OAuth
   *  grant lacks the ReadAccounts scope we added 2026-06-08). The
   *  Transfer button's tooltip branches on this to prompt reconnect
   *  instead of the generic "configure your business number" copy.
   *  See memory:ringcentral-oauth-scopes. */
  userMobileNeedsReconnect?: boolean
}

interface DialerPublicApi {
  // Call state machine
  state: DialerUiState
  isReady: boolean
  isAvailable: boolean // true iff bootstrap is non-null
  canTransfer: boolean // true iff userMobile is set
  /** true iff the transfer-target probe failed with 403. Drives the
   *  TransferButton's tooltip toward "Reconnect RC…" instead of the
   *  generic "Configure your business number…" copy. */
  transferNeedsReconnect: boolean
  externalUserId: string

  // Audio element binding via callback ref (React 19 react-hooks/refs
  // forbids exposing RefObjects through context — a callback function
  // sidesteps the rule). Consumer: `<audio ref={dialer.setAudioElement}>`.
  setAudioElement: (node: HTMLAudioElement | null) => void

  // Tick (for render-only consumers computing connected-call duration)
  now: number

  // Widget visual state
  widgetExpanded: boolean
  expandWidget: () => void
  collapseWidget: () => void

  // Call lifecycle
  startCall: (args: { phoneNumber: string; contactId?: string; contactLabel?: string }) => void
  hangup: () => void
  toggleMute: () => void
  sendDtmf: (digit: string) => void
  transferToMobile: () => void
}

const noop = () => {
  // intentionally empty — used as the action stub when no DialerProvider
  // is in scope or the bootstrap was null.
}

const EMPTY_API: DialerPublicApi = {
  state: { kind: "idle" },
  isReady: false,
  isAvailable: false,
  canTransfer: false,
  transferNeedsReconnect: false,
  externalUserId: "",
  setAudioElement: noop,
  now: 0,
  widgetExpanded: false,
  expandWidget: noop,
  collapseWidget: noop,
  startCall: noop,
  hangup: noop,
  toggleMute: noop,
  sendDtmf: noop,
  transferToMobile: noop,
}

const DialerContext = createContext<DialerPublicApi>(EMPTY_API)

export function useDialer(): DialerPublicApi {
  return useContext(DialerContext)
}

/**
 * Mask a phone number to its last 4 digits for the audit payload.
 * `+15551234567` → `*******4567`. Removes all non-digit characters
 * before slicing so formatted-or-not input shapes are absorbed.
 */
function maskLast4(mobile: string): string {
  const digits = mobile.replace(/\D/g, "")
  const last4 = digits.slice(-4)
  return `*******${last4}`
}

export function DialerProvider({
  bootstrap,
  children,
}: {
  bootstrap: DialerBootstrapClient | null
  children: ReactNode
}) {
  if (!bootstrap) {
    // No RC connection or bootstrap failure — render the empty API so
    // useDialer() works unconditionally. DockedDialer reads isAvailable
    // and renders nothing in this case.
    return <DialerContext.Provider value={EMPTY_API}>{children}</DialerContext.Provider>
  }
  return <DialerProviderInner bootstrap={bootstrap}>{children}</DialerProviderInner>
}

function DialerProviderInner({
  bootstrap,
  children,
}: {
  bootstrap: DialerBootstrapClient
  children: ReactNode
}) {
  // Stable callback for audit recording. The hook captures this in a
  // ref so a fresh-identity callback wouldn't cause SDK re-init.
  const handleTransferred = useCallback((mobile: string) => {
    void recordCallTransferred({ targetMaskedLast4: maskLast4(mobile) }).catch(() => {
      // best-effort audit. Transfer already happened; failure to
      // audit doesn't roll anything back. Server-side pino captures
      // the action errror.
    })
  }, [])

  // Snapshot of the in-flight call's per-row data — stamped in
  // startCall, read in handleCallEnded, nulled after the auto-log
  // server action fires. Single-slot is sufficient because the
  // dialer can only run one call at a time; a second startCall
  // overwrites the slot, and the previous call's session_ended has
  // already fired (the reducer can't transition out of "ended"
  // without going through "idle").
  const currentCallRef = useRef<{
    contactId?: string
    phoneNumber: string
    startedAt: string
  } | null>(null)

  // Auto-log the call_log row on session_ended. Disposition is
  // inferred from the reason carried by the hook:
  //   reason === "transferred"  → "transferred"
  //   reason present (anything else) → "failed"
  //   reason absent → "completed"
  // The reason itself is stored in externalMetadata for debugging;
  // the action synthesizes the notes copy from disposition + reason.
  const handleCallEnded = useCallback((details: { durationMs: number; reason?: string }) => {
    const call = currentCallRef.current
    if (!call) return
    currentCallRef.current = null
    const disposition =
      details.reason === "transferred" ? "transferred" : details.reason ? "failed" : "completed"
    void recordOutboundCall({
      contactId: call.contactId,
      phoneNumber: call.phoneNumber,
      startedAt: call.startedAt,
      durationSeconds: Math.round(details.durationMs / 1000),
      disposition,
      reason: details.reason ?? null,
      externalId: null,
    }).catch(() => {
      // Best-effort. The call already happened; if the server
      // action fails (network blip, validation rejection because
      // the contact was deleted mid-call, etc.) we don't surface
      // an error to the user — the dialer UX flow is independent
      // of the activity-feed write. 3b webhook will backfill via
      // the partial unique index when it lands.
    })
  }, [])

  const webPhone = useWebPhone({
    sipInfo: bootstrap.sipInfo,
    userMobile: bootstrap.userMobile,
    onTransferred: handleTransferred,
    onCallEnded: handleCallEnded,
  })

  // Widget collapse/expand state.
  const [widgetExpanded, setWidgetExpanded] = useState(false)
  const expandWidget = useCallback(() => {
    setWidgetExpanded(true)
  }, [])
  const collapseWidget = useCallback(() => {
    setWidgetExpanded(false)
  }, [])

  // Auto-expand happens at the `startCall` source ONLY. We deliberately
  // do NOT have an effect that watches state.kind and auto-expands on
  // ringing/connected transitions — that would forcibly re-expand the
  // widget if the user collapsed it mid-call, which is bad UX (and
  // forbidden by React 19's set-state-in-effect rule). The user is in
  // control after their initial dial.

  const startCall = useCallback(
    (args: { phoneNumber: string; contactId?: string; contactLabel?: string }) => {
      // Stamp the current-call ref BEFORE invoking the SDK so even
      // an immediate failure inside webPhone.startCall (which catches
      // the rejection and dispatches session_ended synchronously)
      // still has the per-row data available to handleCallEnded.
      currentCallRef.current = {
        contactId: args.contactId,
        phoneNumber: args.phoneNumber,
        startedAt: new Date().toISOString(),
      }
      setWidgetExpanded(true)
      webPhone.startCall({ phoneNumber: args.phoneNumber, contactLabel: args.contactLabel })
    },
    [webPhone],
  )

  // Plain-object API construction — no ref indirection (React 19's
  // react-hooks/refs rule forbids reading ref values during render,
  // and threading the value through `apiRef.current` poisoned every
  // downstream `dialer.xxx` access). New object identity per render
  // is acceptable for a singleton provider with shallow consumers.
  const api: DialerPublicApi = {
    state: webPhone.state,
    isReady: webPhone.isReady,
    isAvailable: true,
    canTransfer: webPhone.canTransfer,
    transferNeedsReconnect: bootstrap.userMobileNeedsReconnect === true,
    externalUserId: bootstrap.externalUserId,
    setAudioElement: webPhone.setAudioElement,
    now: webPhone.now,
    widgetExpanded,
    expandWidget,
    collapseWidget,
    startCall,
    hangup: webPhone.hangup,
    toggleMute: webPhone.toggleMute,
    sendDtmf: webPhone.sendDtmf,
    transferToMobile: webPhone.transferToMobile,
  }

  return <DialerContext.Provider value={api}>{children}</DialerContext.Provider>
}
