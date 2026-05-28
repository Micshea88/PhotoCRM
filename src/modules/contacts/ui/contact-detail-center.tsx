"use client"

import { useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Push 3 (C6c) — center column with the 3-tab strip.
 *
 * Tabs: Overview / Activity / To-Do's. Owns the active-tab state +
 * keyboard navigation (Arrow keys per autonomous default C — Radix-
 * style accessibility without pulling in @radix-ui/react-tabs).
 *
 * Host passes the per-tab content as `overview` / `activity` / `todos`
 * props. Only the active tab's content renders; the inactive panels
 * still mount their containers (preserving layout reservations) so
 * tab switching doesn't reflow the surrounding columns.
 */
type TabKey = "overview" | "activity" | "todos"
const TAB_ORDER: TabKey[] = ["overview", "activity", "todos"]
const TAB_LABEL: Record<TabKey, string> = {
  overview: "Overview",
  activity: "Activity",
  todos: "To-Do's",
}

export function ContactDetailCenter({
  overview,
  activity,
  todos,
}: {
  overview: ReactNode
  activity: ReactNode
  todos: ReactNode
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
        className="flex gap-1 border-b border-[var(--color-border)]"
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
        {active === "activity" && activity}
        {active === "todos" && todos}
      </div>
    </section>
  )
}
