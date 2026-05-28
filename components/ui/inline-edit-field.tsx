"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Pencil, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "./input"

/**
 * Push 3 (C6c) — inline edit primitive.
 *
 * HubSpot-style click-to-edit field. Renders a value with a subtle
 * hover affordance; clicking enters edit mode (text input + save /
 * cancel buttons + Enter/Esc keyboard handlers). The host owns the
 * server action via `onSave` — this primitive is purely UI.
 *
 * Wired conservatively for V1: a handful of representative fields on
 * the contact detail page (name, email, phone). Wider adoption lands
 * once the pattern feels right after smoke-testing.
 *
 * Behavior:
 *   - onSave returns a Promise. While pending, the input is disabled
 *     + a small "Saving…" hint shows.
 *   - onSave throws or returns a string error → primitive surfaces the
 *     error inline + stays in edit mode so the user can retry.
 *   - Successful save closes edit mode + the parent re-renders with
 *     the new value via revalidatePath / router.refresh.
 *
 * Read-only fallback: pass `disabled={true}` to render the value
 * without the click-to-edit affordance.
 */
export function InlineEditField({
  value,
  onSave,
  placeholder = "—",
  type = "text",
  ariaLabel,
  disabled = false,
  className,
}: {
  value: string | null
  /** Returns Promise. Resolve = success. Reject (or { error } payload) = display the error inline. */
  onSave: (next: string) => Promise<{ error?: string } | undefined>
  placeholder?: string
  type?: "text" | "email" | "tel"
  ariaLabel?: string
  disabled?: boolean
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Hydrate draft from value on enter-edit and on external value
  // changes (e.g., a sibling field's save triggered router.refresh).
  // Uses the React compare-prev-state-during-render pattern instead
  // of useEffect to satisfy the lint rule against setState-in-effect.
  const [prevValue, setPrevValue] = useState(value)
  const [prevEditing, setPrevEditing] = useState(editing)
  if (prevValue !== value || prevEditing !== editing) {
    setPrevValue(value)
    setPrevEditing(editing)
    if (!editing) setDraft(value ?? "")
  }

  // Focus the input on enter-edit.
  useEffect(() => {
    if (editing) queueMicrotask(() => inputRef.current?.focus())
  }, [editing])

  async function commit() {
    if (saving) return
    const next = draft.trim()
    // No-op when unchanged.
    if (next === (value ?? "")) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await onSave(next)
      if (result && typeof result === "object" && "error" in result && result.error) {
        setError(result.error)
        setSaving(false)
        return
      }
      setSaving(false)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
      setSaving(false)
    }
  }

  function cancel() {
    if (saving) return
    setDraft(value ?? "")
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
        <span className={cn("flex-1 truncate", !value && "text-[var(--color-muted-foreground)]")}>
          {value ?? placeholder}
        </span>
        {!disabled && (
          <Pencil
            className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
            aria-hidden="true"
          />
        )}
      </button>
    )
  }

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void commit()
            } else if (e.key === "Escape") {
              e.preventDefault()
              cancel()
            }
          }}
          type={type}
          disabled={saving}
          aria-label={ariaLabel ?? "Edit field"}
          className="h-7 text-sm"
        />
        <button
          type="button"
          onClick={() => {
            void commit()
          }}
          disabled={saving}
          aria-label="Save"
          className="inline-flex size-7 items-center justify-center rounded-md text-[var(--color-primary)] hover:bg-[var(--color-accent)] disabled:opacity-50"
        >
          <Check className="size-4" />
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          aria-label="Cancel"
          className="inline-flex size-7 items-center justify-center rounded-md text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] disabled:opacity-50"
        >
          <X className="size-4" />
        </button>
      </div>
      {saving && <p className="text-[10px] text-[var(--color-muted-foreground)]">Saving…</p>}
      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
