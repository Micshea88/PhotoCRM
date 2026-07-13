"use client"

import { useState, useTransition } from "react"
import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/tooltip"
import {
  NOTIFICATION_SETTINGS_CATALOG,
  rowIsOn,
  type SettingsRow,
} from "@/modules/notifications/settings-catalog"
import { NOTIFICATION_TYPES } from "@/modules/notifications/types"
import { updateNotificationPreference } from "@/modules/notifications/actions"
import type { NotificationPreference } from "@/modules/notifications/schema"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Canonical per-type state used inside the component. */
interface ChannelState {
  in_app: boolean
  email: boolean
  mobile: boolean
}

type PrefsByType = Partial<Record<string, ChannelState>>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a PrefsByType map from the sparse NotificationPreference[] array
 * received from the server. Types not present fall back to registry defaults
 * inside rowIsOn / getEffective.
 */
function buildPrefsByType(prefs: NotificationPreference[]): PrefsByType {
  const map: PrefsByType = {}
  for (const p of prefs) {
    map[p.type] = { in_app: p.inApp, email: p.email, mobile: p.mobile }
  }
  return map
}

/**
 * Effective state for a single type: stored pref if present, else registry
 * defaults (mobile always defaults to false because the mobile app is not
 * shipped — even if a default were ever added to the registry).
 */
function getEffective(prefsByType: PrefsByType, type: string): ChannelState {
  const stored = prefsByType[type]
  if (stored !== undefined) return stored
  const meta = NOTIFICATION_TYPES[type as keyof typeof NOTIFICATION_TYPES]
  return {
    in_app: meta.defaultChannels.in_app,
    email: meta.defaultChannels.email,
    mobile: false,
  }
}

// ---------------------------------------------------------------------------
// Inner toggle switch
// ---------------------------------------------------------------------------

/**
 * Pill-shaped toggle button (role="switch"). No external switch component
 * exists in this project — hand-rolled for visual consistency with the
 * Pathway design system.
 */
function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
  "aria-label"?: string
  "data-testid"?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={disabled ? undefined : onChange}
      data-testid={testId}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200",
        "focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 focus:outline-none",
        checked ? "bg-[var(--color-primary)]" : "bg-[var(--color-muted)]",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Row key helper (stable identifier for data-testid)
// ---------------------------------------------------------------------------

function rowKey(row: SettingsRow): string {
  return row.types[0] ?? row.label.toLowerCase().replace(/\s+/g, "-")
}

// ---------------------------------------------------------------------------
// NotificationSettingsPanel
// ---------------------------------------------------------------------------

export interface NotificationSettingsPanelProps {
  /** Sparse: only types that differ from the registry default have a row. */
  prefs: NotificationPreference[]
}

/**
 * Client component that renders the full notification settings panel.
 *
 * Sections come from NOTIFICATION_SETTINGS_CATALOG in order. Each row
 * shows 3 toggle columns: Bell (in_app), Email, Mobile.
 *
 * Mobile is always disabled — the mobile app is not shipped. The column
 * renders with a tooltip ("Mobile app coming soon") and is never persisted.
 *
 * Grouped rows (e.g. "Email delivery problems" governs 3 types) are
 * all-or-nothing: the row shows ON only if ALL its types are ON for that
 * channel. Toggling issues one updateNotificationPreference call per
 * governed type in parallel (N calls for V1; a future batch action could
 * consolidate this).
 *
 * When types in a grouped row disagree (mixed state), rowIsOn returns
 * false, so the row shows OFF. Toggling ON sets ALL types to ON, which
 * resolves any ambiguity deterministically.
 */
export function NotificationSettingsPanel({ prefs }: NotificationSettingsPanelProps) {
  const [optimisticPrefs, setOptimisticPrefs] = useState<PrefsByType>(() => buildPrefsByType(prefs))
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function handleToggle(row: SettingsRow, channel: "in_app" | "email") {
    const currentlyOn = rowIsOn(optimisticPrefs, row, channel)
    const newValue = !currentlyOn

    // Snapshot for rollback
    const prevPrefs = optimisticPrefs

    // Optimistic update — set the channel for every type in the row
    const next: PrefsByType = { ...optimisticPrefs }
    for (const type of row.types) {
      const cur = getEffective(optimisticPrefs, type)
      next[type] = { ...cur, [channel]: newValue }
    }
    setOptimisticPrefs(next)
    setError(null)

    startTransition(() => {
      void Promise.all(
        row.types.map((type) => {
          const cur = getEffective(prevPrefs, type)
          return updateNotificationPreference({
            type,
            inApp: channel === "in_app" ? newValue : cur.in_app,
            email: channel === "email" ? newValue : cur.email,
            // Mobile is never toggled from the UI — preserve stored value
            mobile: cur.mobile,
          })
        }),
      )
        .then((results) => {
          const hasError = results.some((r) => r.serverError)
          if (hasError) {
            setOptimisticPrefs(prevPrefs)
            setError("Failed to save preferences. Please try again.")
          }
        })
        .catch(() => {
          // A thrown rejection (not a returned serverError) must still roll
          // the optimistic UI back and surface the failure.
          setOptimisticPrefs(prevPrefs)
          setError("Failed to save preferences. Please try again.")
        })
    })
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 p-3 text-sm text-[var(--color-destructive)]">
          {error}
        </div>
      )}

      {NOTIFICATION_SETTINGS_CATALOG.map((section) => (
        <section key={section.key} data-testid={`section-${section.key}`}>
          {/* Section header row — labels float right over the 3 columns */}
          <div className="mb-1 flex items-end justify-between">
            <h2 className="text-xs font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">
              {section.label}
            </h2>
            <div className="text-3xs flex items-center gap-6 pr-1 font-medium tracking-wide text-[var(--color-muted-foreground)] uppercase">
              <span className="w-9 text-center">Bell</span>
              <span className="w-9 text-center">Email</span>
              <span className="w-9 text-center">Mobile</span>
            </div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
            {section.rows.map((row) => {
              const key = rowKey(row)
              const bellOn = rowIsOn(optimisticPrefs, row, "in_app")
              const emailOn = rowIsOn(optimisticPrefs, row, "email")
              const isEmailOpened = row.types.length === 1 && row.types[0] === "email.opened"
              const isSmsReceived = row.types.length === 1 && row.types[0] === "sms.received"

              return (
                <div
                  key={key}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                  data-testid={`row-${key}`}
                >
                  {/* Row label + optional hint */}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium">{row.label}</span>
                    {isEmailOpened && (
                      <span
                        className="mt-0.5 text-xs text-[var(--color-muted-foreground)]"
                        data-testid="email-opened-timeline-note"
                      >
                        Tracked on the timeline only
                      </span>
                    )}
                    {isSmsReceived && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-[var(--color-muted-foreground)]">
                        <span
                          aria-label="Info"
                          className="text-4xs flex size-3.5 items-center justify-center rounded-full border border-current leading-none"
                        >
                          i
                        </span>
                        Starts when SMS is set up
                      </span>
                    )}
                  </div>

                  {/* Toggle columns */}
                  <div className="flex items-center gap-6">
                    {/* Bell (in_app) */}
                    <ToggleSwitch
                      checked={bellOn}
                      onChange={() => {
                        handleToggle(row, "in_app")
                      }}
                      aria-label={`${row.label} bell notifications`}
                      data-testid={`toggle-bell-${key}`}
                    />

                    {/* Email */}
                    <ToggleSwitch
                      checked={emailOn}
                      onChange={() => {
                        handleToggle(row, "email")
                      }}
                      aria-label={`${row.label} email notifications`}
                      data-testid={`toggle-email-${key}`}
                    />

                    {/* Mobile — always disabled, tooltip on wrapper */}
                    <Tooltip label="Mobile app coming soon">
                      <ToggleSwitch
                        checked={false}
                        onChange={() => {
                          /* intentionally no-op: mobile disabled */
                        }}
                        disabled
                        aria-label={`${row.label} mobile notifications (coming soon)`}
                        data-testid={`toggle-mobile-${key}`}
                      />
                    </Tooltip>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
