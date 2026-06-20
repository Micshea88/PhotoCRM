"use client"

import { useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  DESKTOP_TABS,
  DESKTOP_DEFAULT_TAB,
  type DesktopTab,
} from "@/modules/contacts/ui/contact-detail-tabs"

/**
 * Push 3 (C6c) — center column with the tab strip.
 *
 * Polish #5 Fix 7a dropped the "To-Do's" tab. The Contact Tasks build
 * (Mike, 2026-06-16) promotes Tasks to its OWN top-level tab — design-system
 * §7 updated. The strip now has THREE tabs: Overview | Activity | Tasks.
 * Communications types stay as sub-filters under Activity. The wrapper is
 * center-aligned (HubSpot pattern).
 *
 * FIX 1 (Mike, 2026-06-19): the active tab is mirrored to the URL (`?tab=`)
 * via router.replace so it survives the router.refresh that follows a server
 * action. `initialTab` comes from the server (normalized from the URL).
 */
const TAB_LABEL: Record<DesktopTab, string> = {
  overview: "Overview",
  activity: "Activity",
  tasks: "Tasks",
}

export function ContactDetailCenter({
  overview,
  activity,
  tasks,
  initialTab = DESKTOP_DEFAULT_TAB,
}: {
  overview: ReactNode
  activity: ReactNode
  tasks: ReactNode
  initialTab?: DesktopTab
}) {
  const router = useRouter()
  const [active, setActive] = useState<DesktopTab>(initialTab)

  function select(tab: DesktopTab) {
    setActive(tab)
    // Relative query — preserves the pathname, replaces the search. replace
    // (not push) so the back button isn't polluted by tab switches.
    router.replace(`?tab=${tab}`, { scroll: false })
  }

  function onTabKey(e: React.KeyboardEvent<HTMLButtonElement>, current: DesktopTab) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
    e.preventDefault()
    const idx = DESKTOP_TABS.indexOf(current)
    const next =
      e.key === "ArrowRight"
        ? DESKTOP_TABS[(idx + 1) % DESKTOP_TABS.length]
        : DESKTOP_TABS[(idx - 1 + DESKTOP_TABS.length) % DESKTOP_TABS.length]
    if (next) select(next)
  }

  return (
    <section className="space-y-4" data-testid="contact-detail-center">
      <div
        role="tablist"
        aria-label="Contact detail tabs"
        className="flex justify-center gap-4 border-b border-[var(--color-border)]"
      >
        {DESKTOP_TABS.map((tab) => {
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
                select(tab)
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
        {active === "tasks" && tasks}
      </div>
    </section>
  )
}
