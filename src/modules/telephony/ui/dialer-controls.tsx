"use client"

import { useEffect, useRef, useState } from "react"
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react"
import { formatPhoneDisplay } from "@/lib/format/phone"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { assertNever, type DialerUiState } from "./use-web-phone"

/**
 * Render components for the dialer UI. Extracted from the popup-era
 * dialer-shell.tsx (3a popup branch) and reused in the inline
 * architecture via the DockedDialer's ExpandedPanel.
 *
 * Most components are pure functions of their props; the small
 * exceptions own only ephemeral UI state (the idle DialPad's typed
 * number, a KeypadKey's press-flash). Call-machine state lives in
 * `use-web-phone.ts`; widget collapse/expand lives in `dialer-context.tsx`.
 */

const KEYPAD_ROWS: readonly (readonly string[])[] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"],
]

/** Dialable characters: digits plus the two DTMF symbols the keypad
 *  emits. Everything else (parens, spaces, dashes, "+1", letters) is
 *  stripped so a pasted "(727) 555-1234" or "+1 727 555 1234" just works. */
function sanitizeDialInput(raw: string): string {
  return raw.replace(/[^0-9*#]/g, "")
}

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

/** Keypad key with a brief press-flash. A pure CSS `:active` style only
 *  highlights WHILE the button is physically held, so a normal fast click
 *  shows nothing perceptible. Instead we flash on `onPointerDown` (fires
 *  for mouse AND touch) and hold the highlight ~140ms so even a quick tap
 *  is visible. */
function KeypadKey({ digit, onPress }: { digit: string; onPress: (digit: string) => void }) {
  const [flashing, setFlashing] = useState(false)
  const timerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )
  const flash = () => {
    setFlashing(true)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      setFlashing(false)
    }, 140)
  }
  return (
    <button
      type="button"
      onPointerDown={flash}
      onClick={() => {
        onPress(digit)
      }}
      className={cn(
        "touch-manipulation rounded-md py-2 text-base font-medium transition-colors select-none",
        flashing
          ? "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]"
          : "bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)] hover:bg-[var(--color-secondary)]/80",
      )}
    >
      {digit}
    </button>
  )
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
        <KeypadKey key={digit} digit={digit} onPress={onDigit} />
      ))}
    </div>
  )
}

/**
 * Idle dialer: a number field + Call button + the shared keypad. Lets the
 * user place an outbound call from the dialer itself (no contact page
 * needed). Owns only the typed-number string. Input is sanitized to
 * dialable characters (digits + * / #) so pasting a formatted number works.
 * Submits through the SAME `startCall` flow the contact page uses (the
 * parent wires `onCall` → `dialer.startCall({ phoneNumber })`).
 */
export function DialPad({ onCall }: { onCall: (phoneNumber: string) => void }) {
  const [value, setValue] = useState("")
  const submit = () => {
    const number = value.trim()
    if (!number) return
    onCall(number)
  }
  return (
    <div className="mt-auto flex flex-col items-center gap-3 pb-1">
      <div className="flex w-full items-center gap-2">
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="Enter number"
          aria-label="Phone number"
          value={value}
          onChange={(e) => {
            setValue(sanitizeDialInput(e.target.value))
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              submit()
            }
          }}
        />
        <Button type="button" onClick={submit} disabled={!value.trim()}>
          Call
        </Button>
      </div>
      <Keypad
        onDigit={(digit) => {
          setValue((v) => v + digit)
        }}
      />
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
          <span className="text-2xs text-[var(--color-muted-foreground)]">Decline</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            aria-label="Answer call"
            onClick={onAnswer}
            title="Answer"
            data-testid="incoming-call-answer"
            className="flex size-12 items-center justify-center rounded-full bg-[var(--color-success)] text-white hover:bg-[var(--color-success)]"
          >
            <Phone className="size-5" aria-hidden="true" />
          </button>
          <span className="text-2xs text-[var(--color-muted-foreground)]">Answer</span>
        </div>
      </div>
    </div>
  )
}
