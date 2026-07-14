"use client"

import { useEffect, useState } from "react"

/**
 * Live masthead date, top-right of the dashboard header. Computed CLIENT-side
 * after mount (not SSR) so it shows the USER's current local date — and to avoid
 * an SSR-timezone / browser-timezone hydration mismatch — and rolls over daily.
 * Uses the app's `Intl` en-US locale pattern; no new date lib, no hardcoded string.
 *
 * DAY mirrors the greeting's serif weight/size (masthead, not a label); DATE is
 * the uppercase-tracked micro-label in Pathway green.
 */
export function MastheadDate() {
  const [now, setNow] = useState<Date | null>(null)
  // Deferred microtask (the repo's set-state-in-effect-lint pattern) so the date
  // is computed on the client after mount, never during SSR.
  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (active) setNow(new Date())
    })
    return () => {
      active = false
    }
  }, [])

  const weekday = now ? now.toLocaleDateString("en-US", { weekday: "long" }) : ""
  const longDate = now
    ? now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : ""

  return (
    <div
      className="pr-[var(--space-masthead-inset)] text-right"
      aria-hidden={now ? undefined : true}
    >
      {/* nbsp placeholders reserve the line height before the client date lands. */}
      <div className="font-serif text-2xl leading-tight font-semibold">{weekday || " "}</div>
      <div className="text-2xs tracking-wide text-[var(--color-brand-accent)] uppercase tabular-nums">
        {longDate || " "}
      </div>
    </div>
  )
}
