"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { SearchableSelect, type SearchableSelectItem } from "./searchable-select"

/**
 * Push 3 (C6c polish) — inline edit primitive for select fields.
 *
 * Same lifecycle contract as InlineEditField (click to enter edit
 * mode, autosave on selection or blur, Esc reverts, NO Save/Cancel
 * buttons). The edit-mode UI uses the existing C3 SearchableSelect
 * for the common case; for fields that need a different picker
 * (Owner → UserRefPicker, Company → CompanyPicker) use the
 * `renderPicker` slot — it receives the same lifecycle helpers and
 * the host renders whichever picker is appropriate.
 *
 * Discipline:
 *   - selection → autosave + close
 *   - click outside / blur → autosave the current selection (if any)
 *     + close
 *   - Esc → revert + close (no save)
 *
 * Host owns the canonical display formatting via `displayLabel`. The
 * select primitive doesn't know how to format an Owner id back to a
 * name — the loader provides it.
 */
export interface InlineEditSelectProps {
  /** Canonical stored value (e.g. enum value, FK id). */
  value: string | null
  /** Pre-formatted label for read mode. When null/empty, renders the
   *  placeholder. */
  displayLabel: string | null
  /** Items for the default SearchableSelect picker. Ignored when
   *  `renderPicker` is supplied. */
  items?: SearchableSelectItem[]
  /** Server-action wrapper. Resolve = success. `{ error }` = display
   *  inline + stay in edit mode. */
  onSave: (next: string | null) => Promise<{ error?: string } | undefined>
  /** Optional custom picker — used when the default SearchableSelect
   *  isn't the right primitive (Owner / Company / etc.). The host
   *  renders any picker and calls `commit(nextValue)` to save +
   *  close, or `cancel()` to revert. */
  renderPicker?: (api: {
    commit: (nextValue: string | null) => Promise<void>
    cancel: () => void
    error: string | null
  }) => ReactNode
  placeholder?: string
  /** Allow selecting "no value" via SearchableSelect's clear button. */
  allowClear?: boolean
  ariaLabel?: string
  disabled?: boolean
  className?: string
}

export function InlineEditSelect({
  value,
  displayLabel,
  items,
  onSave,
  renderPicker,
  placeholder = "—",
  allowClear = false,
  ariaLabel,
  disabled = false,
  className,
}: InlineEditSelectProps) {
  const [editing, setEditing] = useState(false)
  // Draft mirrors the canonical value; selection in the picker writes
  // through here so the blur-commit path knows what to save.
  const [draft, setDraft] = useState<string | null>(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Sync draft when the external value or edit state changes.
  const [prevValue, setPrevValue] = useState<string | null>(value)
  const [prevEditing, setPrevEditing] = useState(editing)
  if (prevValue !== value || prevEditing !== editing) {
    setPrevValue(value)
    setPrevEditing(editing)
    if (!editing) {
      setDraft(value)
      setError(null)
    }
  }

  // Click-outside + Esc handlers for the wrapping edit container.
  useEffect(() => {
    if (!editing) return
    function onPointer(e: MouseEvent) {
      const t = e.target as Node | null
      if (!t) return
      if (wrapperRef.current?.contains(t)) return
      // Blur → autosave whatever's in draft.
      void commit(draft)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        cancel()
      }
    }
    document.addEventListener("mousedown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
    // draft + cancel/commit included via closures; rebinding on draft
    // change is fine — the listeners are cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft])

  async function commit(nextValue: string | null) {
    if (saving) return
    if (nextValue === value) {
      setEditing(false)
      setError(null)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await onSave(nextValue)
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
    setDraft(value)
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
          className={cn("flex-1 truncate", !displayLabel && "text-[var(--color-muted-foreground)]")}
        >
          {displayLabel ?? placeholder}
        </span>
      </button>
    )
  }

  return (
    <div ref={wrapperRef} className={cn("space-y-0.5", className)}>
      {renderPicker ? (
        renderPicker({
          commit: (nextValue) => commit(nextValue),
          cancel,
          error,
        })
      ) : (
        <SearchableSelect
          items={items ?? []}
          value={draft}
          onChange={(next) => {
            setDraft(next)
            // Autosave on selection. SearchableSelect closes its own
            // panel after onChange, and we close edit mode here.
            void commit(next)
          }}
          aria-label={ariaLabel ?? "Edit field"}
          allowClear={allowClear}
        />
      )}
      {saving && <p className="text-[10px] text-[var(--color-muted-foreground)]">Saving…</p>}
      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
