"use client"

import { ChevronDown, Phone } from "lucide-react"
import { formatPhoneDisplay } from "@/lib/format/phone"
import { useDialer } from "./dialer-context"
import {
  DialerActions,
  DialerHeader,
  DialerStatusRow,
  IncomingCall,
  formatDuration,
} from "./dialer-controls"

/**
 * Docked floating dialer widget — fixed bottom-right of the (app)
 * shell. Replaces the popup window architecture from 3a.
 *
 * Two visual states:
 *   - Collapsed pill: 220×40, shows current call status briefly
 *   - Expanded panel: 360×520, full dialer UI (header + status row +
 *     keypad/mute/hangup actions)
 *
 * The hidden `<audio autoPlay>` element is rendered at the TOP level
 * of the widget container — OUTSIDE the conditional that swaps
 * collapsed↔expanded. If it were inside the conditional, collapsing
 * during a call would unmount the audio element, dropping the remote
 * audio. The widget chrome state and the audio playback state are
 * independent by design.
 *
 * Renders `null` when `isAvailable` is false (no RC connection for
 * this user). Call sites still call `useDialer().startCall(...)`
 * unconditionally; in the not-available branch, that's a no-op stub.
 * (For the action-icon-row's tel:-vs-connected branch selector, the
 * `hasConnectedPhoneProvider` server-side check determines whether
 * the button onClick is `startCall` or the tel: link — same as
 * before.)
 */
export function DockedDialer() {
  // React 19's react-hooks/refs rule misfires on the entire context
  // object because it contains the setAudioElement callback function.
  // Spreading + reading individual primitives sidesteps the heuristic.
  const { isAvailable, widgetExpanded, setAudioElement, state } = useDialer()
  if (!isAvailable) return null

  // An inbound ring takes over the widget regardless of collapse state —
  // the user must see Answer / Decline.
  const inbound = state.kind === "inbound_ringing"

  return (
    <div className="fixed right-4 bottom-4 z-50">
      {inbound ? <IncomingCallPanel /> : widgetExpanded ? <ExpandedPanel /> : <CollapsedPill />}
      {/* Audio MUST stay mounted across expand/collapse — see file header. */}
      <audio ref={setAudioElement} autoPlay />
    </div>
  )
}

function IncomingCallPanel() {
  const { state, answerInbound, declineInbound } = useDialer()
  if (state.kind !== "inbound_ringing") return null
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-lg"
      style={{ width: "360px" }}
      role="dialog"
      aria-label="Incoming call"
    >
      <IncomingCall
        fromNumber={state.fromNumber}
        contactName={state.contactName}
        contactId={state.contactId}
        onAnswer={answerInbound}
        onDecline={declineInbound}
      />
    </div>
  )
}

function ExpandedPanel() {
  const dialer = useDialer()
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-lg"
      style={{ width: "360px", height: "520px" }}
      role="dialog"
      aria-label="Dialer"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--color-muted-foreground)]">Dialer</span>
        <button
          type="button"
          onClick={dialer.collapseWidget}
          aria-label="Collapse dialer"
          title="Collapse"
          className="flex size-6 items-center justify-center rounded hover:bg-[var(--color-accent)]/40"
        >
          <ChevronDown className="size-4" aria-hidden="true" />
        </button>
      </div>
      <DialerHeader externalUserId={dialer.externalUserId} state={dialer.state} />
      <DialerStatusRow state={dialer.state} now={dialer.now} />
      <DialerActions
        state={dialer.state}
        onHangup={dialer.hangup}
        onMute={dialer.toggleMute}
        onKeypadDigit={dialer.sendDtmf}
      />
    </div>
  )
}

function CollapsedPill() {
  const dialer = useDialer()
  const label = collapsedLabel(dialer.state, dialer.now)
  return (
    <button
      type="button"
      onClick={dialer.expandWidget}
      aria-label="Expand dialer"
      title="Expand dialer"
      className="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-2 text-sm font-medium shadow-lg hover:bg-[var(--color-accent)]/20"
      style={{ minWidth: "220px", height: "40px" }}
    >
      <Phone className="size-4" aria-hidden="true" />
      <span className="flex-1 truncate text-left">{label}</span>
    </button>
  )
}

function collapsedLabel(state: ReturnType<typeof useDialer>["state"], now: number): string {
  switch (state.kind) {
    case "idle":
      return "Dialer · ready"
    case "inbound_ringing":
      return "Incoming call…"
    case "starting":
      return `Calling ${state.contactLabel ?? formatPhoneDisplay(state.toNumber)}…`
    case "ringing":
      return `Ringing ${state.contactLabel ?? formatPhoneDisplay(state.toNumber)}…`
    case "connected":
      return `In call · ${formatDuration(now - state.startedAt)}`
    case "ended":
      return "Call ended"
    case "sdk_init_failed":
      return "Dialer error"
    case "no_microphone":
      return "Microphone required"
  }
}
