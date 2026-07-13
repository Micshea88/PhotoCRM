"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

/**
 * Minimal headless popover. Two responsibilities:
 *
 *   1. Render the trigger and the panel
 *   2. Manage open/close state with the three V1-roadmap-locked
 *      dismissal triggers:
 *
 *        - Click outside the trigger AND panel
 *        - Escape key
 *        - Click the trigger again (toggle)
 *
 * Positioning: the panel is PORTALED to `document.body` and `fixed`-positioned
 * at the trigger's rect (re-measured on open + on scroll/resize). This escapes
 * ancestor `overflow` clipping and stacking contexts — the panel used to render
 * inline as an absolute child, which meant a scroll/overflow ancestor (e.g. the
 * contacts toolbar's `overflow-x-auto`, whose `overflow-y` computes to `auto`,
 * or the list card's `overflow-hidden`) clipped it. No collision flipping yet;
 * if a module needs it, upgrade to @radix-ui/react-popover.
 *
 * Modal-style dialogs should use `<Modal>` instead.
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
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)

  const reposition = useCallback(() => {
    const el = wrapperRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (align === "end") {
      setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
    } else {
      setPos({ top: r.bottom + 4, left: r.left })
    }
  }, [align])

  useEffect(() => {
    if (!open) return
    reposition()
    // `capture` catches scrolls in ANY ancestor (incl. the overflow-x-auto
    // toolbar + the page scroll) so the fixed panel tracks the trigger.
    window.addEventListener("scroll", reposition, true)
    window.addEventListener("resize", reposition)
    return () => {
      window.removeEventListener("scroll", reposition, true)
      window.removeEventListener("resize", reposition)
    }
  }, [open, reposition])

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
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={contentRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, right: pos.right }}
            className={cn(
              "z-50 min-w-[240px] rounded-lg border border-[var(--color-border)] bg-[var(--color-popover)] p-3 shadow-md",
              className,
            )}
          >
            {typeof children === "function" ? children({ close }) : children}
          </div>,
          document.body,
        )}
    </div>
  )
}
