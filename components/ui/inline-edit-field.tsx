"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Push 3 (C6c polish) — inline edit primitive, autosave variant.
 *
 * Click the value to enter edit mode → input shows beneath a thin
 * underline (HubSpot pattern). On blur OR Enter the value is saved
 * automatically; Esc reverts. There are NO Save / Cancel buttons —
 * the lifecycle is purely keyboard + focus driven, which feels
 * faster + closer to the surfaces Mike's users are coming from.
 *
 * Display / edit / save can each carry a different shape — useful
 * for phone fields where:
 *   - the stored canonical value is digits-only ("5551234567")
 *   - the display is formatted "(555) 123-4567"
 *   - the user can type any variant ("(555) 123-4567", "555-123-4567",
 *     "5551234567"), and `normalizeOnSave` collapses it back to digits
 *     before the action call.
 *
 * Validation: `validateBeforeSave` runs after `normalizeOnSave`. Any
 * non-null return is rendered as an inline error and the field stays
 * in edit mode. The action layer is the final gate (dedup conflict
 * surfaces via the onSave promise's resolved `{ error }`).
 *
 * Error path: when onSave returns `{ error }` OR throws, the error is
 * rendered inline and the field stays in edit mode so the user can
 * retry without re-clicking. Successful save closes edit mode.
 */
export interface InlineEditFieldProps {
  /** Canonical stored value (e.g. raw digits for phone). */
  value: string | null
  /** Formatted display text. Defaults to `value`. */
  displayValue?: string | null
  /** Optional override for the initial edit-mode value. Defaults to
   *  `displayValue ?? value`. */
  editValue?: string | null
  /** Server-action wrapper. Resolve = success. `{ error }` = display
   *  inline + stay in edit mode. Throwing also stays in edit mode. */
  onSave: (next: string) => Promise<{ error?: string } | undefined>
  /** Optional pre-save normalizer (e.g. parsePhoneInput → digits-only).
   *  Runs on the raw input before validateBeforeSave / onSave. */
  normalizeOnSave?: (raw: string) => string
  /** Optional pre-save validator. Return a message string to reject,
   *  null/undefined to pass. */
  validateBeforeSave?: (normalized: string) => string | null | undefined
  placeholder?: string
  type?: "text" | "email" | "tel"
  ariaLabel?: string
  disabled?: boolean
  className?: string
}

export function InlineEditField({
  value,
  displayValue,
  editValue,
  onSave,
  normalizeOnSave,
  validateBeforeSave,
  placeholder = "—",
  type = "text",
  ariaLabel,
  disabled = false,
  className,
}: InlineEditFieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>(editValue ?? displayValue ?? value ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Tracks whether a commit is in flight from blur OR Enter — guards
  // against the blur handler double-firing after Enter already triggered
  // the save (Enter blurs the input via .blur() to dismiss the keyboard
  // on mobile).
  const commitInFlightRef = useRef(false)

  const displayText = displayValue ?? value ?? ""

  // Sync prevValue / prevEditing during render to seed the draft when
  // re-entering edit mode OR when the host swaps the value out from
  // under us (e.g. router.refresh after a sibling save).
  const [prevValue, setPrevValue] = useState(value)
  const [prevEditing, setPrevEditing] = useState(editing)
  if (prevValue !== value || prevEditing !== editing) {
    setPrevValue(value)
    setPrevEditing(editing)
    if (!editing) setDraft(editValue ?? displayValue ?? value ?? "")
  }

  useEffect(() => {
    if (editing) queueMicrotask(() => inputRef.current?.focus())
  }, [editing])

  async function commit() {
    if (saving || commitInFlightRef.current) return
    const raw = draft
    const normalized = normalizeOnSave ? normalizeOnSave(raw) : raw.trim()
    // No-op when the user didn't change anything meaningful.
    if (normalized === (value ?? "")) {
      setEditing(false)
      setError(null)
      return
    }
    if (validateBeforeSave) {
      const v = validateBeforeSave(normalized)
      if (typeof v === "string" && v) {
        setError(v)
        return
      }
    }
    commitInFlightRef.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await onSave(normalized)
      if (result && typeof result === "object" && "error" in result && result.error) {
        setError(result.error)
        setSaving(false)
        commitInFlightRef.current = false
        return
      }
      setSaving(false)
      commitInFlightRef.current = false
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
      setSaving(false)
      commitInFlightRef.current = false
    }
  }

  function revert() {
    if (saving) return
    setDraft(editValue ?? displayValue ?? value ?? "")
    setError(null)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          if (!disabled) setEditing(true)
        }}
        disabled={disabled}
        aria-label={ariaLabel ?? "Edit field"}
        className={cn(
          "group flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left text-sm",
          !disabled && "hover:bg-[var(--color-accent)]/30",
          disabled && "cursor-default",
          className,
        )}
      >
        <span
          className={cn("flex-1 truncate", !displayText && "text-[var(--color-muted-foreground)]")}
        >
          {displayText || placeholder}
        </span>
      </button>
    )
  }

  return (
    <div className={cn("space-y-0.5", className)}>
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          if (error) setError(null)
        }}
        onBlur={() => {
          // Autosave on blur. Esc handler sets commitInFlightRef so
          // the Esc-induced blur doesn't trigger a stale save.
          void commit()
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            // Blur to dismiss soft keyboard; the blur handler runs commit.
            // Guard via commitInFlightRef so commit only fires once.
            void commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            // Mark commit in-flight so the impending blur doesn't double
            // up — but immediately release after the synchronous revert
            // (revert is sync — the input gets unmounted on setEditing(false)).
            commitInFlightRef.current = true
            revert()
            // Schedule the release after the blur microtask.
            queueMicrotask(() => {
              commitInFlightRef.current = false
            })
          }
        }}
        type={type}
        disabled={saving}
        aria-label={ariaLabel ?? "Edit field"}
        className={cn(
          "block w-full bg-transparent text-sm focus:outline-none",
          "border-0 border-b border-[var(--color-primary)] px-0 py-0.5",
        )}
      />
      {saving && <p className="text-3xs text-[var(--color-muted-foreground)]">Saving…</p>}
      {error && <p className="text-2xs text-[var(--color-destructive)]">{error}</p>}
    </div>
  )
}
