"use client"

import { useEffect, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Right-side slideout drawer. Companion to Modal — same dismissal model
 * (Esc + backdrop click) but anchored to the right edge with full
 * viewport height. Used by the "More filters" and "Edit columns"
 * panels on /contacts.
 *
 * Width tunable via `widthClass` (default 400px). No focus trap —
 * matches the Modal contract; if a future panel needs strict trap
 * (e.g., a deep form), upgrade to a radix-based Dialog.
 *
 * The host controls visibility via `open`. Animation: a CSS transition
 * on `transform translate-x` so the panel slides in/out smoothly.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  widthClass = "w-[400px]",
  footer,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  widthClass?: string
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
    }
  }, [open, onClose])

  // The DOM is conditionally rendered (matching Modal) so we don't
  // leave the panel in the tree when closed — keeps the component
  // tree small and lets children unmount when the drawer hides.
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <aside
        className={cn(
          "flex h-full flex-col border-l border-[var(--color-border)] bg-[var(--color-background)] shadow-xl",
          widthClass,
        )}
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        {title && (
          <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="rounded-md p-1 text-base hover:bg-[var(--state-hover)]"
            >
              ✕
            </button>
          </header>
        )}
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && (
          <footer className="border-t border-[var(--color-border)] px-4 py-3">{footer}</footer>
        )}
      </aside>
    </div>
  )
}
