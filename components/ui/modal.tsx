"use client"

import { useEffect, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Minimal portal-less modal. Renders a fixed-position overlay + a
 * centered card. No focus-trap (kept out of scope — V1 modal usage is
 * for short, low-stakes interactions like "Add company inline").
 * Clicking the backdrop OR pressing Escape closes the modal via the
 * `onClose` callback. The host component owns visibility; this
 * component just renders when `open` is true.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
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

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={cn(
          "w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-6 shadow-lg",
          className,
        )}
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        {title && <h2 className="mb-4 text-lg font-semibold">{title}</h2>}
        {children}
      </div>
    </div>
  )
}
