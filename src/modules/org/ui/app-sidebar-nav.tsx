"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect } from "react"
import {
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ListChecks,
  Settings,
  SlidersHorizontal,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Sidebar icons keyed by short string. The server-side resolver
 * (`resolveSidebarItems`) returns these string keys; this client
 * component maps the key to the actual Lucide component. Can't pass
 * Lucide components across the server→client boundary because
 * forwardRef function references aren't serializable.
 */
export type SidebarIconKey =
  | "dashboard"
  | "contacts"
  | "events"
  | "opportunities"
  | "tasks"
  | "settings"
  | "customFields"

const ICONS: Record<SidebarIconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  contacts: Users,
  events: ListChecks,
  opportunities: TrendingUp,
  tasks: CheckSquare,
  settings: Settings,
  customFields: SlidersHorizontal,
}

export interface AppSidebarItem {
  href: string
  label: string
  icon: SidebarIconKey
}

/**
 * Push 3 (C2) — desktop sidebar with collapsible state.
 *
 * Expanded: 240px, icon + label. Collapsed: 64px, icons only with
 * a tooltip on hover (native `title` attribute — keeps the V1
 * surface lightweight; a styled tooltip primitive can come later
 * without changing this contract).
 *
 * Active-state highlight via `usePathname`. The toggle button at
 * the top-right of the nav fires `onToggle` (the host wires this to
 * a server action + local state). Keyboard shortcut `[` toggles
 * the nav from anywhere on the page when no input/textarea/select
 * is focused — mirrors HubSpot's behavior.
 */
export function AppSidebarNav({
  items,
  collapsed,
  onToggle,
}: {
  items: AppSidebarItem[]
  collapsed: boolean
  onToggle: () => void
}) {
  const pathname = usePathname()

  // Global keyboard shortcut: `[` toggles the nav unless an input,
  // textarea, or contenteditable is focused (so typing `[` in a form
  // field doesn't accidentally collapse the nav).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "[") return
      const target = e.target as HTMLElement | null
      if (!target) return
      const tag = target.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (target.isContentEditable) return
      // Don't fire while a modifier is held (preserve native
      // shortcuts like Cmd+[ for browser back).
      if (e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      onToggle()
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
    }
  }, [onToggle])

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "flex h-full flex-col border-r border-[var(--color-border)] bg-[var(--color-background)]",
      )}
    >
      <div className="flex items-center justify-end p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand ([)" : "Collapse ([)"}
          className="inline-flex size-7 items-center justify-center rounded-md text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-foreground)]"
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      </div>
      <div className={cn("flex flex-1 flex-col gap-1", collapsed ? "px-2" : "px-3")}>
        {items.map((item) => {
          const isActive =
            pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
          const Icon = ICONS[item.icon]
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md text-sm transition-colors",
                collapsed ? "size-10 justify-center" : "px-3 py-2",
                isActive
                  ? "bg-[var(--color-accent)] font-medium text-[var(--color-accent-foreground)]"
                  : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-foreground)]",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
