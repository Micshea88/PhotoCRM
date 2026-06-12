"use client"

import { Mic, MicOff, Phone, PhoneOff } from "lucide-react"
import { formatPhoneDisplay } from "@/lib/format/phone"
import { assertNever, type DialerUiState } from "./use-web-phone"

/**
 * Pure-JSX render components for the dialer UI. Extracted from the
 * popup-era dialer-shell.tsx (3a popup branch) and reused in the
 * inline architecture via the DockedDialer's ExpandedPanel.
 *
 * No state ownership here — every component is purely a function of
 * its props. State lives in `use-web-phone.ts` (the SDK lifecycle
 * hook) and `dialer-context.tsx` (the widget collapse/expand state).
 */

const KEYPAD_ROWS: readonly (readonly string[])[] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"],
]

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(totalSeconds / 60)
  const ss = totalSeconds % 60
  return `${mm.toString()}:${ss.toString().padStart(2, "0")}`
}

export function DialerHeader({
  externalUserId,
  state,
}: {
  externalUserId: string
  state: DialerUiState
}) {
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
      {label ? <h2 className="text-base font-semibold">{label}</h2> : null}
      {number && number !== label ? (
        <p className="text-xs text-[var(--color-muted-foreground)]">{number}</p>
      ) : null}
      {state.kind === "idle" ? (
        <>
          <h2 className="text-base font-semibold">Ready to dial</h2>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Calling as ext. {externalUserId}
          </p>
        </>
      ) : null}
    </div>
  )
}

export function DialerStatusRow({ state, now }: { state: DialerUiState; now: number }) {
  switch (state.kind) {
    case "idle":
      return null
    case "inbound_ringing":
      // Inbound ring renders via the dedicated IncomingCall panel, not
      // this status row — this case exists only for switch exhaustiveness.
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
          <p className="text-sm font-semibold">Could not start the dialer</p>
          <p className="text-xs text-[var(--color-muted-foreground)]">{state.error}</p>
        </div>
      )
    case "no_microphone":
      return (
        <div className="flex flex-col items-center gap-2 p-2 text-center">
          <p className="text-sm font-semibold">Microphone access required</p>
          <p className="text-xs">
            Allow microphone access in your browser settings, then reload the page.
          </p>
        </div>
      )
    default:
      assertNever(state)
  }
}

export function DialerActions({
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
      <div className="mt-auto flex justify-center pb-1">
        <HangupButton onClick={onHangup} />
      </div>
    )
  }
  if (state.kind === "connected") {
    return (
      <div className="mt-auto flex flex-col items-center gap-3 pb-1">
        <Keypad onDigit={onKeypadDigit} />
        <div className="flex items-center gap-2">
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
      style={{ width: "260px" }}
    >
      {KEYPAD_ROWS.flat().map((digit) => (
        <button
          key={digit}
          type="button"
          onClick={() => {
            onDigit(digit)
          }}
          className="rounded-md bg-[var(--color-secondary)] py-2 text-base font-medium text-[var(--color-secondary-foreground)] hover:bg-[var(--color-secondary)]/80"
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
      title={muted ? "Unmute" : "Mute"}
      className="flex size-10 items-center justify-center rounded-full bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)] hover:bg-[var(--color-secondary)]/80"
    >
      {muted ? (
        <MicOff className="size-4" aria-hidden="true" />
      ) : (
        <Mic className="size-4" aria-hidden="true" />
      )}
    </button>
  )
}

function HangupButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Hang up"
      onClick={onClick}
      title="Hang up"
      className="flex size-10 items-center justify-center rounded-full bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:bg-[var(--color-destructive)]/90"
    >
      <PhoneOff className="size-4" aria-hidden="true" />
    </button>
  )
}

/**
 * Inbound-call ringing panel (3b) — caller identity + Answer / Decline.
 *
 * Pure render: identity is the matched contact name (linked to the
 * contact detail per the approved scope — link only, no auto-navigate)
 * with the formatted number beneath; or just the formatted number when
 * the caller is unknown. Answer is green (emerald, matching the repo's
 * `ai-status-badge` client-green); Decline is the neutral secondary
 * token.
 */
export function IncomingCall({
  fromNumber,
  contactName,
  contactId,
  onAnswer,
  onDecline,
}: {
  fromNumber: string
  contactName?: string
  contactId?: string
  onAnswer: () => void
  onDecline: () => void
}) {
  const formatted = formatPhoneDisplay(fromNumber) || "Unknown caller"
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
        Incoming call
      </span>
      {contactName ? (
        <>
          {contactId ? (
            <a
              href={`/contacts/${contactId}`}
              className="text-base font-semibold hover:underline"
              data-testid="incoming-call-contact-link"
            >
              {contactName}
            </a>
          ) : (
            <h2 className="text-base font-semibold">{contactName}</h2>
          )}
          <p className="text-xs text-[var(--color-muted-foreground)]">{formatted}</p>
        </>
      ) : (
        <h2 className="text-base font-semibold">{formatted}</h2>
      )}
      <div className="mt-3 flex items-center justify-center gap-6">
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            aria-label="Decline call"
            onClick={onDecline}
            title="Decline"
            data-testid="incoming-call-decline"
            className="flex size-12 items-center justify-center rounded-full bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)] hover:bg-[var(--color-secondary)]/80"
          >
            <PhoneOff className="size-5" aria-hidden="true" />
          </button>
          <span className="text-[11px] text-[var(--color-muted-foreground)]">Decline</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            aria-label="Answer call"
            onClick={onAnswer}
            title="Answer"
            data-testid="incoming-call-answer"
            className="flex size-12 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <Phone className="size-5" aria-hidden="true" />
          </button>
          <span className="text-[11px] text-[var(--color-muted-foreground)]">Answer</span>
        </div>
      </div>
    </div>
  )
}
