"use client"

import { useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Push 3 (C6c) — center column with the tab strip.
 *
 * Polish #5 Fix 7a — dropped the "To-Do's" tab. Tasks moved under
 * `Activities → Tasks` filter inside `ContactActivityFeed` (when
 * Push 7 lands). The strip now has TWO tabs only: Overview and
 * Activities. The wrapper is center-aligned (HubSpot pattern).
 */
type TabKey = "overview" | "activities"
const TAB_ORDER: TabKey[] = ["overview", "activities"]
const TAB_LABEL: Record<TabKey, string> = {
  overview: "Overview",
  activities: "Activities",
}

export function ContactDetailCenter({
  overview,
  activity,
}: {
  overview: ReactNode
  activity: ReactNode
}) {
  const [active, setActive] = useState<TabKey>("overview")

  function onTabKey(e: React.KeyboardEvent<HTMLButtonElement>, current: TabKey) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
    e.preventDefault()
    const idx = TAB_ORDER.indexOf(current)
    const next =
      e.key === "ArrowRight"
        ? TAB_ORDER[(idx + 1) % TAB_ORDER.length]
        : TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length]
    if (next) setActive(next)
  }

  return (
    <section className="space-y-4" data-testid="contact-detail-center">
      <div
        role="tablist"
        aria-label="Contact detail tabs"
        className="flex justify-center gap-4 border-b border-[var(--color-border)]"
      >
        {TAB_ORDER.map((tab) => {
          const isActive = active === tab
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`contact-tab-${tab}`}
              aria-controls={`contact-tabpanel-${tab}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => {
                setActive(tab)
              }}
              onKeyDown={(e) => {
                onTabKey(e, tab)
              }}
              className={cn(
                "border-b-2 px-3 py-2 text-sm transition-colors",
                isActive
                  ? "border-[var(--color-primary)] font-medium text-[var(--color-primary)]"
                  : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
              )}
              data-testid={`contact-detail-tab-${tab}`}
            >
              {TAB_LABEL[tab]}
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        id={`contact-tabpanel-${active}`}
        aria-labelledby={`contact-tab-${active}`}
      >
        {active === "overview" && overview}
        {active === "activities" && activity}
      </div>
    </section>
  )
}
