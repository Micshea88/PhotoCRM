"use client"

import { Mic, MicOff, PhoneOff, PhoneForwarded } from "lucide-react"
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
 *
 * The TransferButton is new for D9 (transfer-to-mobile). The
 * DialerStatusRow's `ended` branch was extended to render
 * "Transferred to phone" when the reason is "transferred"; otherwise
 * unchanged from the popup version.
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
    case "starting":
      return <p className="text-center text-sm">Connecting…</p>
    case "ringing":
      return <p className="text-center text-sm">Ringing…</p>
    case "connected":
      return (
        <p className="text-center font-mono text-base">{formatDuration(now - state.startedAt)}</p>
      )
    case "ended":
      if (state.reason === "transferred") {
        return (
          <p className="text-center text-sm text-[var(--color-muted-foreground)]">
            Transferred to phone · {formatDuration(state.durationMs)}
          </p>
        )
      }
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
  canTransfer,
  onHangup,
  onMute,
  onKeypadDigit,
  onTransfer,
}: {
  state: DialerUiState
  canTransfer: boolean
  onHangup: () => void
  onMute: () => void
  onKeypadDigit: (digit: string) => void
  onTransfer: () => void
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
          <TransferButton enabled={canTransfer} onClick={onTransfer} />
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

/**
 * Transfer-to-mobile button. Disabled when the user has no mobile
 * number registered in RingCentral (graceful degradation of D9 when
 * the user-mobile probe at bootstrap returns null). Click calls
 * `session.transfer(userMobile)` via the hook's transferToMobile.
 */
function TransferButton({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-label="Transfer call to phone"
      title={
        enabled ? "Transfer to phone" : "Set a mobile number in RingCentral to enable transfer."
      }
      className="flex size-10 items-center justify-center rounded-full bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)] hover:bg-[var(--color-secondary)]/80 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <PhoneForwarded className="size-4" aria-hidden="true" />
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
