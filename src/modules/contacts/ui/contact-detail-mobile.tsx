"use client"

import { useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Push 3 (C6d) — mobile contact detail shell.
 *
 * Single-column tabbed layout per docs/pathway-build-roadmap.md.
 * Mobile (<lg) shape:
 *
 *   header (page header — back link + Actions dropdown + H1 + AI badge)
 *   ─────────────────────────────────────
 *   ActionIconRow (6 icons)
 *   ─────────────────────────────────────
 *   [About | Activity | Tasks | Associations]
 *     [active tab content]
 *
 * Tabs (default landing tab is Activity, not the first tab):
 *   - About      → ContactDetailLeft panes=["info","about"]
 *   - Activity   → AI Summary card + AI Insights card + activity feed
 *   - Tasks      → ContactTasksPane (Contact Tasks build, Mike 2026-06-16)
 *   - Associations → ContactDetailRight content (sections stack as cards)
 */
type MobileTabKey = "activity" | "tasks" | "associations" | "about"
// Order: About | Activity | Tasks | Associations (Mike, 2026-06-19). The
// default landing tab stays Activity (useState below), not the first tab.
const TAB_ORDER: MobileTabKey[] = ["about", "activity", "tasks", "associations"]
const TAB_LABEL: Record<MobileTabKey, string> = {
  activity: "Activity",
  tasks: "Tasks",
  associations: "Associations",
  about: "About",
}

export function ContactDetailMobile({
  activity,
  tasks,
  associations,
  about,
}: {
  activity: ReactNode
  tasks: ReactNode
  associations: ReactNode
  about: ReactNode
}) {
  const [active, setActive] = useState<MobileTabKey>("activity")

  function onTabKey(e: React.KeyboardEvent<HTMLButtonElement>, current: MobileTabKey) {
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
    <section className="space-y-4" data-testid="contact-detail-mobile">
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
              id={`contact-mobile-tab-${tab}`}
              aria-controls={`contact-mobile-tabpanel-${tab}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => {
                setActive(tab)
              }}
              onKeyDown={(e) => {
                onTabKey(e, tab)
              }}
              className={cn(
                "flex-1 border-b-2 px-3 py-2 text-sm transition-colors",
                isActive
                  ? "border-[var(--color-primary)] font-medium text-[var(--color-primary)]"
                  : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
              )}
              data-testid={`contact-detail-mobile-tab-${tab}`}
            >
              {TAB_LABEL[tab]}
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        id={`contact-mobile-tabpanel-${active}`}
        aria-labelledby={`contact-mobile-tab-${active}`}
      >
        {active === "activity" && activity}
        {active === "tasks" && tasks}
        {active === "associations" && associations}
        {active === "about" && about}
      </div>
    </section>
  )
}
