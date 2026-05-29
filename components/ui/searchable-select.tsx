"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "./input"

/**
 * Push 3 (C3) — single-select searchable combobox primitive.
 *
 * Click the trigger to open a panel with a search input + filtered
 * list. Keyboard: ArrowDown/Up navigate, Enter selects the active
 * item, Esc closes. Click outside closes.
 *
 * Visual: HubSpot-pattern click-to-open combobox. Differs from the
 * existing UserRefPicker (which uses an always-visible search input
 * above a native select) — that one stays as-is for org-member
 * pickers per the C3 spec ("do not build a new component for
 * org-member dropdowns").
 *
 * Sizing: trigger button is w-full so it fills its form-field
 * container. Panel is positioned absolute below the trigger and
 * matches the trigger width (min-w from the parent + right-0).
 *
 * Positioning caveat: no portal, no collision detection. Consumers
 * that live inside `overflow-hidden` containers (e.g. the collapsed
 * sidebar) would need a portaled variant — none of C3's use sites
 * have that constraint (contact form scrolls naturally, Bulk Edit
 * drawer scrolls internally, filter chip popover is already a
 * Popover with overflow:visible).
 */
export interface SearchableSelectItem {
  value: string
  label: string
  /** Optional secondary line shown in smaller muted text. */
  description?: string
}

export function SearchableSelect({
  items,
  value,
  onChange,
  placeholder = "Select…",
  allowClear = false,
  disabled = false,
  name,
  id: propId,
  "aria-label": ariaLabel,
  emptyMessage = "No results",
  defaultOpen = false,
  inlineMode = false,
  onDismiss,
}: {
  items: SearchableSelectItem[]
  value: string | null
  onChange: (value: string | null) => void
  placeholder?: string
  allowClear?: boolean
  disabled?: boolean
  name?: string
  id?: string
  "aria-label"?: string
  emptyMessage?: string
  /** P3 (C6c polish #2) — start the panel open on mount. Used by
   *  InlineEditSelect so the user doesn't have to click twice to see
   *  the picker after entering edit mode. */
  defaultOpen?: boolean
  /** P3 (C6c polish #2) — render the trigger as an underlined value
   *  instead of a full bordered box. Matches the InlineEditField
   *  visual exactly when used inside InlineEditSelect. */
  inlineMode?: boolean
  /** P3 (C6c polish #2) — fires when the user dismisses the panel
   *  (Esc or click outside) without selecting. InlineEditSelect uses
   *  this to autosave-on-blur the current draft. */
  onDismiss?: () => void
}) {
  const autoId = useId()
  const id = propId ?? autoId
  const listboxId = `${id}-listbox`
  const [open, setOpen] = useState(defaultOpen)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const itemRefs = useRef<(HTMLLIElement | null)[]>([])

  const selectedItem = useMemo(() => items.find((i) => i.value === value) ?? null, [items, value])

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (i) => i.label.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q),
    )
  }, [items, query])

  // Reset query + activeIndex when `open` changes. React's "adjusting
  // state in response to a prop/state change" pattern (compare prev to
  // current during render) — keeps the lint rule against setState-in-
  // effect happy and runs in the same render pass instead of forcing
  // an extra re-render that a useEffect would.
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (!open) {
      setQuery("")
    } else {
      const idx = selectedItem ? items.findIndex((i) => i.value === selectedItem.value) : -1
      setActiveIndex(idx >= 0 ? idx : 0)
    }
  }

  // Focus the search input when opening. Side-effect only — no state
  // reset here.
  useEffect(() => {
    if (!open) return
    queueMicrotask(() => inputRef.current?.focus())
  }, [open])

  // Click outside + Esc closes. Same pattern as the C2 popout fix.
  // P3 (C6c polish #2) — onDismiss fires so InlineEditSelect can
  // autosave the current draft / close edit mode on blur or Esc.
  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      const t = e.target as Node | null
      if (!t) return
      if (wrapperRef.current?.contains(t)) return
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

  function commitChoice(item: SearchableSelectItem) {
    onChange(item.value)
    setOpen(false)
  }

  function clearChoice() {
    onChange(null)
    setOpen(false)
  }

  function onPanelKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, Math.max(visibleItems.length - 1, 0)))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const item = visibleItems[activeIndex]
      if (item) commitChoice(item)
    } else if (e.key === "Home") {
      e.preventDefault()
      setActiveIndex(0)
    } else if (e.key === "End") {
      e.preventDefault()
      setActiveIndex(Math.max(visibleItems.length - 1, 0))
    }
  }

  // Scroll the active item into view as the user navigates with
  // arrows. Otherwise long lists hide the cursor.
  useEffect(() => {
    if (!open) return
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" })
  }, [activeIndex, open])

  return (
    <div ref={wrapperRef} className="relative w-full">
      <button
        type="button"
        id={id}
        name={name}
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o)
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        role="combobox"
        className={cn(
          "flex w-full items-center justify-between gap-2 text-left text-sm",
          inlineMode
            ? "h-7 border-0 border-b border-[var(--color-primary)] bg-transparent px-0"
            : "h-9 rounded-md border border-[var(--color-input)] bg-transparent px-2 shadow-sm focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className={cn("truncate", !selectedItem && "text-[var(--color-muted-foreground)]")}>
          {selectedItem ? selectedItem.label : placeholder}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {allowClear && selectedItem && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear selection"
              onClick={(e) => {
                e.stopPropagation()
                clearChoice()
              }}
              className="inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-foreground)]"
            >
              <X className="size-3.5" />
            </span>
          )}
          <ChevronDown className="size-4 shrink-0 text-[var(--color-muted-foreground)]" />
        </span>
      </button>

      {open && (
        <div
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-background)] shadow-md"
          onKeyDown={onPanelKeyDown}
        >
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-2 py-1.5">
            <Search className="size-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActiveIndex(0)
              }}
              placeholder="Search…"
              aria-label="Filter options"
              aria-controls={listboxId}
              aria-activedescendant={
                visibleItems[activeIndex]
                  ? `${id}-opt-${visibleItems[activeIndex].value}`
                  : undefined
              }
              className="h-7 border-0 px-1 text-xs shadow-none focus-visible:ring-0"
            />
          </div>
          {visibleItems.length === 0 ? (
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
                const isSelected = item.value === value
                return (
                  <li
                    key={item.value}
                    ref={(el) => {
                      itemRefs.current[idx] = el
                    }}
                    id={`${id}-opt-${item.value}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => {
                      setActiveIndex(idx)
                    }}
                    onClick={() => {
                      commitChoice(item)
                    }}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm",
                      isActive && "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]",
                    )}
                  >
                    <span className="flex flex-1 flex-col">
                      <span className="truncate">{item.label}</span>
                      {item.description && (
                        <span className="truncate text-xs text-[var(--color-muted-foreground)]">
                          {item.description}
                        </span>
                      )}
                    </span>
                    {isSelected && (
                      <Check className="size-4 shrink-0 text-[var(--color-primary)]" />
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
