"use client"

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

/**
 * Push 3 (C6c polish #5 Fix 3a) — shared portal wrapper for the
 * inline-mode picker result panels.
 *
 * Why portal: in inline-edit mode the picker trigger sits inside the
 * contact-detail left card (or any future card that uses InlineEdit-
 * Select). The card has `overflow-hidden rounded-lg` so the section
 * dividers don't bleed past the border radius. That same overflow
 * also clips any absolutely-positioned panel that grows past the
 * card's bottom edge — long lists become invisible.
 *
 * Rendering the panel via `createPortal(..., document.body)` escapes
 * the card's overflow. The panel is positioned absolutely using
 * `getBoundingClientRect()` of the trigger. We re-measure on scroll
 * + resize so the panel stays anchored as the user scrolls the page.
 *
 * Click-outside detection is the responsibility of the host picker —
 * the host must check BOTH its trigger wrapper AND the panel ref
 * before deciding a click was "outside". Use `usePortalRef()` to get
 * the panel ref the host should also include in its outside check.
 */
export function PickerPortal({
  triggerRef,
  open,
  children,
  panelRef,
  minWidth = 200,
}: {
  /** Ref to the element the panel anchors below (the picker trigger). */
  triggerRef: React.RefObject<HTMLElement | null>
  /** Whether the panel is open. False renders nothing. */
  open: boolean
  /** Panel contents. Should already include the surrounding card
   *  chrome (rounded-md, border, bg, shadow). */
  children: ReactNode
  /** Forwarded ref to the outer panel div so the host can include
   *  it in click-outside checks. Optional. */
  panelRef?: React.RefObject<HTMLDivElement | null>
  /** Minimum panel width in px. Trigger width is used as the minimum
   *  if larger. */
  minWidth?: number
}) {
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)
  const ownRef = useRef<HTMLDivElement | null>(null)
  const usedPanelRef = panelRef ?? ownRef
  // Guard against SSR. createPortal needs document.body, which only
  // exists client-side. typeof check avoids the setState-in-effect
  // pattern lint flags.
  const canPortal = typeof document !== "undefined"

  useLayoutEffect(() => {
    if (!open) return
    const node = triggerRef.current
    if (!node) return
    function measure() {
      if (!node) return
      const rect = node.getBoundingClientRect()
      setCoords({
        top: rect.bottom + window.scrollY + 4, // small gap below trigger
        left: rect.left + window.scrollX,
        width: Math.max(rect.width, minWidth),
      })
    }
    measure()
    const onScroll = () => {
      measure()
    }
    const onResize = () => {
      measure()
    }
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onResize)
    }
  }, [open, triggerRef, minWidth])

  if (!open || !canPortal || !coords) return null

  return createPortal(
    <div
      ref={usedPanelRef}
      data-testid="picker-portal-panel"
      data-picker-portal="true"
      style={{
        position: "absolute",
        top: coords.top,
        left: coords.left,
        width: coords.width,
        zIndex: 60,
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
