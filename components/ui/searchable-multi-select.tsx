"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "./input"
import { PickerPortal } from "./picker-portal"

/**
 * Push 3 (C3) — multi-select searchable combobox primitive with
 * optional create-new flow. Used for the Tags field on contacts.
 *
 * UX:
 *   - Selected values render as chips inside the input area.
 *   - Each chip has an X to remove (calls onChange without that value).
 *   - Type to filter the dropdown; already-selected items are hidden
 *     from suggestions to reduce clutter (re-selecting is a no-op
 *     anyway, and the chip already communicates selection).
 *   - Click a suggestion → adds it to values + clears the query.
 *   - Backspace on an EMPTY input removes the last chip (standard
 *     chip-input UX).
 *   - allowCreate=true: when the query doesn't match any existing
 *     item exactly AND is non-empty after trim, a "Create '${query}'"
 *     row appears at the bottom of the suggestions. Enter or click
 *     calls onCreate (if provided) or just adds the new value.
 *
 * Tag normalization: values are lowercased + trimmed before submit.
 * Per the P3 C3 spec (Mike-confirmed: "Option 1: lowercase new writes
 * only, no migration"). Legacy mixed-case tags already in the DB stay
 * as-is until rewritten through a normal edit. The host displays
 * existing chips as-stored — only NEW additions through this
 * component get lowercased.
 */
export interface SearchableMultiSelectItem {
  value: string
  label: string
}

export function SearchableMultiSelect({
  items,
  values,
  onChange,
  placeholder = "Add…",
  disabled = false,
  name,
  id: propId,
  "aria-label": ariaLabel,
  allowCreate = false,
  createLabel = (input: string) => `Create "${input}"`,
  onCreate,
  emptyMessage = "No results",
  normalize = (s) => s.toLowerCase().trim(),
  defaultOpen = false,
  inlineMode = false,
  onDismiss,
}: {
  items: SearchableMultiSelectItem[]
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  disabled?: boolean
  name?: string
  id?: string
  "aria-label"?: string
  allowCreate?: boolean
  createLabel?: (input: string) => string
  onCreate?: (input: string) => Promise<SearchableMultiSelectItem>
  emptyMessage?: string
  /** Hook to transform a typed/added value before storage. Defaults to
   * lowercase+trim for tag-style usage. Pass a no-op `(s) => s.trim()`
   * if you need case-preserving multi-select. */
  normalize?: (s: string) => string
  /** P3 (C6c polish #3) — start the panel open on mount. Used by
   *  InlineEditTags so the picker is immediately interactive. */
  defaultOpen?: boolean
  /** P3 (C6c polish #3) — strip the bordered chip-input container
   *  (no border, no shadow). The chip row sits over a border-b
   *  underline matching InlineEditField. */
  inlineMode?: boolean
  /** Fires when the user dismisses the panel (Esc / click outside)
   *  without selecting. The host autosaves the current values. */
  onDismiss?: () => void
}) {
  const autoId = useId()
  const id = propId ?? autoId
  const listboxId = `${id}-listbox`
  const [open, setOpen] = useState(defaultOpen)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const itemRefs = useRef<(HTMLLIElement | null)[]>([])

  const selectedSet = useMemo(() => new Set(values), [values])

  // Suggestions = items NOT already selected, filtered by query.
  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    const candidates = items.filter((i) => !selectedSet.has(i.value))
    if (!q) return candidates
    return candidates.filter((i) => i.label.toLowerCase().includes(q))
  }, [items, selectedSet, query])

  // Create-new affordance shows when allowCreate, query is non-empty,
  // and no visible suggestion's label matches the normalized query
  // exactly.
  const trimmedQuery = query.trim()
  const exactExists = useMemo(() => {
    if (!trimmedQuery) return true
    const nq = normalize(trimmedQuery)
    if (selectedSet.has(nq)) return true
    return items.some((i) => normalize(i.value) === nq)
  }, [items, trimmedQuery, normalize, selectedSet])
  const showCreate = allowCreate && trimmedQuery.length > 0 && !exactExists

  // Total navigable rows = visibleItems (+ 1 for the create row at
  // the bottom, when shown).
  const totalRows = visibleItems.length + (showCreate ? 1 : 0)
  const createRowIndex = visibleItems.length // last row when showCreate

  // Reset query + activeIndex on open transitions. See SearchableSelect
  // for the rationale (React's compare-prev-state pattern, lint-friendly).
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (!open) {
      setQuery("")
    } else {
      setActiveIndex(0)
    }
  }

  // Focus the input when opening. Side-effect only.
  useEffect(() => {
    if (!open) return
    queueMicrotask(() => inputRef.current?.focus())
  }, [open])

  // Click outside + Esc closes. P3 (C6c polish #3) — onDismiss fires
  // so InlineEditTags / InlineEditSelect can autosave the current
  // selection on blur.
  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      const t = e.target as Node | null
      if (!t) return
      if (wrapperRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      setOpen(false)
      onDismiss?.()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false)
        onDismiss?.()
      }
    }
    document.addEventListener("mousedown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, onDismiss])

  // Scroll active row into view.
  useEffect(() => {
    if (!open) return
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" })
  }, [activeIndex, open])

  function addValue(raw: string) {
    const v = normalize(raw)
    if (!v) return
    if (selectedSet.has(v)) return
    onChange([...values, v])
    setQuery("")
    setActiveIndex(0)
  }

  function removeValue(v: string) {
    onChange(values.filter((x) => x !== v))
    inputRef.current?.focus()
  }

  async function commitCreate() {
    if (!trimmedQuery) return
    if (onCreate) {
      const created = await onCreate(trimmedQuery)
      addValue(created.value)
    } else {
      addValue(trimmedQuery)
    }
  }

  function commitChoice(item: SearchableMultiSelectItem) {
    addValue(item.value)
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      if (!open) setOpen(true)
      setActiveIndex((i) => Math.min(i + 1, Math.max(totalRows - 1, 0)))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (showCreate && activeIndex === createRowIndex) {
        void commitCreate()
        return
      }
      const item = visibleItems[activeIndex]
      if (item) commitChoice(item)
    } else if (e.key === "Backspace" && query.length === 0 && values.length > 0) {
      e.preventDefault()
      const last = values[values.length - 1]
      if (last) removeValue(last)
    } else if (e.key === "," && trimmedQuery.length > 0) {
      // Comma as a tag separator — common chip-input UX.
      e.preventDefault()
      if (showCreate || !exactExists) {
        void commitCreate()
      }
    }
  }

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div
        ref={triggerRef}
        className={cn(
          "flex min-h-7 w-full flex-wrap items-center gap-1 bg-transparent text-sm",
          inlineMode
            ? "border-0 border-b border-[var(--color-primary)] px-0 py-0.5"
            : "min-h-9 rounded-sm border border-[var(--color-input)] px-2 py-1 shadow-sm focus-within:ring-1 focus-within:ring-[var(--color-ring)]",
          disabled && "cursor-not-allowed opacity-50",
        )}
        onClick={() => {
          if (!disabled) {
            setOpen(true)
            inputRef.current?.focus()
          }
        }}
      >
        {values.map((v) => {
          const item = items.find((i) => i.value === v)
          const label = item?.label ?? v
          return (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary)]/15 px-2 py-0.5 text-xs text-[var(--color-primary)]"
            >
              {label}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  removeValue(v)
                }}
                aria-label={`Remove ${label}`}
                className="inline-flex size-4 items-center justify-center rounded-full hover:bg-[var(--color-primary)]/25 focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none"
                disabled={disabled}
              >
                <X className="size-3" />
              </button>
            </span>
          )
        })}
        <Input
          ref={inputRef}
          id={id}
          name={name}
          disabled={disabled}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveIndex(0)
            if (!open) setOpen(true)
          }}
          onFocus={() => {
            if (!disabled) setOpen(true)
          }}
          onKeyDown={onInputKeyDown}
          placeholder={values.length === 0 ? placeholder : ""}
          aria-label={ariaLabel}
          aria-controls={open ? listboxId : undefined}
          aria-expanded={open}
          aria-haspopup="listbox"
          role="combobox"
          className="h-7 min-w-[120px] flex-1 border-0 px-1 text-xs shadow-none focus-visible:ring-0"
        />
      </div>

      <PickerPortal triggerRef={triggerRef} open={open} panelRef={panelRef}>
        <div className="max-h-72 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] shadow-md">
          {visibleItems.length === 0 && !showCreate ? (
            <div className="p-3 text-center text-xs text-[var(--color-muted-foreground)]">
              {emptyMessage}
            </div>
          ) : (
            <ul
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel ?? placeholder}
              className="max-h-56 overflow-y-auto py-1"
            >
              {visibleItems.map((item, idx) => {
                const isActive = idx === activeIndex
                return (
                  <li
                    key={item.value}
                    ref={(el) => {
                      itemRefs.current[idx] = el
                    }}
                    id={`${id}-opt-${item.value}`}
                    role="option"
                    aria-selected={false}
                    onMouseEnter={() => {
                      setActiveIndex(idx)
                    }}
                    onClick={() => {
                      commitChoice(item)
                    }}
                    className={cn(
                      "cursor-pointer truncate px-3 py-1.5 text-sm",
                      isActive && "bg-[var(--state-hover)] text-[var(--color-accent-foreground)]",
                    )}
                  >
                    {item.label}
                  </li>
                )
              })}
              {showCreate && (
                <li
                  ref={(el) => {
                    itemRefs.current[createRowIndex] = el
                  }}
                  role="option"
                  aria-selected={false}
                  onMouseEnter={() => {
                    setActiveIndex(createRowIndex)
                  }}
                  onClick={() => {
                    void commitCreate()
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 border-t border-[var(--color-border)] px-3 py-1.5 text-sm",
                    activeIndex === createRowIndex &&
                      "bg-[var(--state-hover)] text-[var(--color-accent-foreground)]",
                  )}
                >
                  <Plus className="size-3.5 shrink-0" />
                  <span className="truncate">{createLabel(trimmedQuery)}</span>
                </li>
              )}
            </ul>
          )}
        </div>
      </PickerPortal>
    </div>
  )
}
