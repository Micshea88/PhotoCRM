"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Minimal headless popover. Two responsibilities:
 *
 *   1. Render the trigger and the content
 *   2. Manage open/close state with the three V1-roadmap-locked
 *      dismissal triggers:
 *
 *        - Click outside the trigger AND content
 *        - Escape key
 *        - Click the trigger again (toggle)
 *
 * Positioning: the content renders inline as an absolute-positioned
 * child of the trigger's wrapper. Good enough for left-aligned chip
 * popovers on /contacts; if a future module needs collision detection
 * or right-anchored content, upgrade to @radix-ui/react-popover.
 *
 * Not a portal — content lives inside the trigger's stacking context.
 * For our chip bar that's the right call (filter panels naturally
 * scroll with the table when the viewport is short). Modal-style
 * dialogs should use `<Modal>` instead.
 */
export function Popover({
  trigger,
  children,
  align = "start",
  className,
  wrapperClassName,
}: {
  /** Function invoked with the current open state + a toggle callback.
   * Use to render any kind of trigger element (chip, button, icon). */
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode
  /** Panel content. Either a static node, or a render-prop receiving a
   *  `close` callback so the content can dismiss itself (e.g. a single-select
   *  menu closing after a pick). Backward-compatible: existing callers pass a
   *  plain node. */
  children: ReactNode | ((state: { close: () => void }) => ReactNode)
  align?: "start" | "end"
  className?: string
  /** Classes for the outer wrapper (default `relative inline-block`). Pass
   *  `block w-full` for a full-width trigger (e.g. a select-style control). */
  wrapperClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node | null
      if (!target) return
      if (wrapperRef.current?.contains(target)) return
      if (contentRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDocClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const toggle = () => {
    setOpen((v) => !v)
  }
  const close = () => {
    setOpen(false)
  }

  return (
    <div ref={wrapperRef} className={cn("relative inline-block", wrapperClassName)}>
      {trigger({ open, toggle })}
      {open && (
        <div
          ref={contentRef}
          className={cn(
            "absolute top-full z-20 mt-1 min-w-[240px] rounded-lg border border-[var(--color-border)] bg-[var(--color-popover)] p-3 shadow-md",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {typeof children === "function" ? children({ close }) : children}
        </div>
      )}
    </div>
  )
}
