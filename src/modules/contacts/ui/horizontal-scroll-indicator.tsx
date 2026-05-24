"use client"

import { useEffect, useRef, useState, type RefObject } from "react"

/**
 * Push 2c.4 — JS-driven always-visible horizontal scroll indicator.
 *
 * macOS Sonoma+ aggressively hides styled scrollbars on inner overflow
 * containers even when the page explicitly styles them. The
 * .contacts-table-scroll CSS rules in globals.css try every CSS-only
 * workaround (scrollbar-gutter, -webkit-appearance: none, explicit
 * height + thumb), but the OS can still suppress the bar. This
 * component renders a custom thumb + track that is ALWAYS painted
 * when the target overflows — independent of OS settings.
 *
 * Behavior:
 *   - Hidden when target's scrollWidth ≤ clientWidth + 1 (no overflow).
 *   - Thumb width = (clientWidth / scrollWidth) × trackWidth.
 *   - Thumb left = (scrollLeft / scrollWidth) × trackWidth.
 *   - Mousedown on thumb → drag updates target.scrollLeft.
 *   - Listens to target scroll + ResizeObserver so the thumb follows
 *     the native scroll AND reacts to column-width changes.
 *
 * Sits BELOW the table wrapper as a sibling so it doesn't interfere
 * with the wrapper's own overflow rules.
 */
export function HorizontalScrollIndicator({
  targetRef,
}: {
  targetRef: RefObject<HTMLElement | null>
}) {
  const [overflow, setOverflow] = useState(false)
  const [thumbPct, setThumbPct] = useState({ leftPct: 0, widthPct: 100 })
  const dragRef = useRef<{
    startX: number
    startScrollLeft: number
    trackWidth: number
  } | null>(null)
  const trackEl = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = targetRef.current
    if (!el) return

    function update() {
      const node = targetRef.current
      if (!node) return
      const hasOverflow = node.scrollWidth > node.clientWidth + 1
      setOverflow(hasOverflow)
      if (!hasOverflow) return
      const ratio = node.clientWidth / node.scrollWidth
      const leftRatio = node.scrollLeft / node.scrollWidth
      setThumbPct({
        leftPct: leftRatio * 100,
        widthPct: Math.max(8, ratio * 100),
      })
    }
    update()
    el.addEventListener("scroll", update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // Also re-measure on window resize — column-width drag doesn't
    // necessarily fire ResizeObserver if the table width sums change.
    window.addEventListener("resize", update)
    return () => {
      el.removeEventListener("scroll", update)
      ro.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [targetRef])

  function onThumbMouseDown(e: React.MouseEvent) {
    const target = targetRef.current
    const track = trackEl.current
    if (!target || !track) return
    e.preventDefault()
    dragRef.current = {
      startX: e.clientX,
      startScrollLeft: target.scrollLeft,
      trackWidth: track.getBoundingClientRect().width,
    }
    function onMove(ev: MouseEvent) {
      const d = dragRef.current
      if (!d || !target) return
      const dx = ev.clientX - d.startX
      // dx in px on track → scrollLeft delta proportional to
      // (scrollWidth / trackWidth).
      const ratio = target.scrollWidth / d.trackWidth
      target.scrollLeft = d.startScrollLeft + dx * ratio
    }
    function onUp() {
      dragRef.current = null
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  function onTrackMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    // Click on the track (not on the thumb) → jump scrollLeft to
    // approximately the clicked position. Useful for quick navigation.
    if (e.target !== e.currentTarget) return
    const target = targetRef.current
    if (!target) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickRatio = (e.clientX - rect.left) / rect.width
    target.scrollLeft = clickRatio * target.scrollWidth - target.clientWidth / 2
  }

  if (!overflow) return null

  return (
    <div
      ref={trackEl}
      role="scrollbar"
      aria-controls={undefined}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(thumbPct.leftPct)}
      onMouseDown={onTrackMouseDown}
      className="relative mt-1 h-2.5 cursor-pointer rounded-full bg-[var(--color-muted)]/60"
    >
      <div
        role="presentation"
        onMouseDown={onThumbMouseDown}
        className="absolute top-0 h-full cursor-grab rounded-full bg-[var(--color-muted-foreground)]/50 transition-colors hover:bg-[var(--color-muted-foreground)] active:cursor-grabbing"
        style={{ left: `${String(thumbPct.leftPct)}%`, width: `${String(thumbPct.widthPct)}%` }}
      />
    </div>
  )
}
