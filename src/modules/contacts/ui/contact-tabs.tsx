"use client"

import { useState, type ReactNode } from "react"

export type ContactTabKey = "overview" | "companies" | "events" | "tasks" | "activity"

interface TabDef {
  key: ContactTabKey
  label: string
}

const TABS: TabDef[] = [
  { key: "overview", label: "Overview" },
  { key: "companies", label: "Companies" },
  { key: "events", label: "Events" },
  { key: "tasks", label: "Tasks" },
  { key: "activity", label: "Activity" },
]

/**
 * Client-side tab switcher for the contact detail page. State lives in
 * component memory only (no URL persistence in 2a) — the user lands on
 * Overview by default and can switch between the 5 panes. PUSH 3 will
 * fill Activity/Tasks/etc. with real content; for now they render
 * empty-state placeholders supplied as `children` by the server page.
 */
export function ContactTabs({
  overview,
  companies,
  events,
  tasks,
  activity,
}: {
  overview: ReactNode
  companies: ReactNode
  events: ReactNode
  tasks: ReactNode
  activity: ReactNode
}) {
  const [active, setActive] = useState<ContactTabKey>("overview")
  const panes: Record<ContactTabKey, ReactNode> = {
    overview,
    companies,
    events,
    tasks,
    activity,
  }
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setActive(t.key)
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none active:bg-[var(--state-active)] ${
              active === t.key
                ? "border-[var(--state-selected)] font-medium"
                : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>{panes[active]}</div>
    </div>
  )
}
