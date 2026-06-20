"use client"

import { useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  MOBILE_TABS,
  MOBILE_DEFAULT_TAB,
  type MobileTab,
} from "@/modules/contacts/ui/contact-detail-tabs"

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
 *
 * FIX 1 (Mike, 2026-06-19): the active tab is mirrored to the URL (`?tab=`)
 * via router.replace so it survives the router.refresh that follows a server
 * action. `initialTab` comes from the server (normalized from the URL).
 */
const TAB_LABEL: Record<MobileTab, string> = {
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
  initialTab = MOBILE_DEFAULT_TAB,
}: {
  activity: ReactNode
  tasks: ReactNode
  associations: ReactNode
  about: ReactNode
  initialTab?: MobileTab
}) {
  const router = useRouter()
  const [active, setActive] = useState<MobileTab>(initialTab)

  function select(tab: MobileTab) {
    setActive(tab)
    // Relative query — preserves the pathname, replaces the search. replace
    // (not push) so the back button isn't polluted by tab switches.
    router.replace(`?tab=${tab}`, { scroll: false })
  }

  function onTabKey(e: React.KeyboardEvent<HTMLButtonElement>, current: MobileTab) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
    e.preventDefault()
    const idx = MOBILE_TABS.indexOf(current)
    const next =
      e.key === "ArrowRight"
        ? MOBILE_TABS[(idx + 1) % MOBILE_TABS.length]
        : MOBILE_TABS[(idx - 1 + MOBILE_TABS.length) % MOBILE_TABS.length]
    if (next) select(next)
  }

  return (
    <section className="space-y-4" data-testid="contact-detail-mobile">
      <div
        role="tablist"
        aria-label="Contact detail tabs"
        className="flex gap-1 border-b border-[var(--color-border)]"
      >
        {MOBILE_TABS.map((tab) => {
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
                select(tab)
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
