"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import {
  CheckSquare,
  ChevronDown,
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
import { setUserPreference } from "@/modules/user-preferences/actions"

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

/**
 * Sidebar item. Leaves have `href`; parent groups have `href: null`
 * and a non-empty `children` array. Parent grouping is UI-only — the
 * AI assistant routes by leaf id, not by sidebar tree shape.
 */
export interface AppSidebarItem {
  href: string | null
  label: string
  icon: SidebarIconKey
  children?: AppSidebarItem[]
  /** Pathname prefix used to auto-expand a parent when an active sub-route lives under it (e.g. "/settings"). */
  childRoutePrefix?: string
}

/**
 * Push 3 (C2) — desktop sidebar with collapsible state.
 *
 * Expanded: 240px, icon + label. Collapsed: 64px, icons only.
 *
 * Push 3 post-C2 nav hotfix — parent grouping. The Settings group
 * renders inline (chevron-expand) when the sidebar is expanded, and
 * as a popout panel when the sidebar is collapsed.
 *
 * Effective expanded state for the parent =
 *   (any of its child routes is currently active) OR (user's persisted toggle pref).
 * Active-sub-route auto-expand never persists; only the user's
 * chevron click writes to `user_preferences.nav_settings_expanded`.
 *
 * Keyboard shortcut `[` toggles the WHOLE sidebar collapse from
 * anywhere on the page when no input/textarea/select is focused —
 * mirrors HubSpot's behavior.
 */
export function AppSidebarNav({
  items,
  collapsed,
  onToggle,
  initialSettingsExpanded,
}: {
  items: AppSidebarItem[]
  collapsed: boolean
  onToggle: () => void
  initialSettingsExpanded: boolean
}) {
  const pathname = usePathname()
  const [settingsExpanded, setSettingsExpanded] = useState(initialSettingsExpanded)

  function toggleSettingsExpanded() {
    const next = !settingsExpanded
    setSettingsExpanded(next)
    // Persist so the user's pref carries across page loads. We don't
    // await — the UI is optimistic; failures will be reconciled on
    // the next SSR pass (matches the nav_collapsed flow).
    void setUserPreference({
      key: "nav_settings_expanded",
      value: next,
      organizationId: null,
    })
  }

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
          if (item.children && item.children.length > 0) {
            const hasActiveChild =
              !!item.childRoutePrefix && pathname.startsWith(item.childRoutePrefix)
            const effectiveExpanded = hasActiveChild || settingsExpanded
            return (
              <SidebarParentRow
                key={item.label}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
                expanded={effectiveExpanded}
                hasActiveChild={hasActiveChild}
                onToggleExpanded={toggleSettingsExpanded}
              />
            )
          }
          // Leaf item — defensive: skip if no href somehow.
          if (!item.href) return null
          return (
            <SidebarLeafRow key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
          )
        })}
      </div>
    </nav>
  )
}

function SidebarLeafRow({
  item,
  pathname,
  collapsed,
}: {
  item: AppSidebarItem
  pathname: string
  collapsed: boolean
}) {
  if (!item.href) return null
  const isActive =
    pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
  const Icon = ICONS[item.icon]
  return (
    <Link
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
}

/**
 * Parent row — renders inline-expand (chevron) when the sidebar is
 * expanded, and a popout panel when the sidebar is collapsed.
 *
 * Popout dismiss: click outside or Esc. Clicking a child link also
 * closes the popout (the host navigates and the new path's active
 * state replaces the popout focus).
 *
 * When the sidebar transitions from collapsed → expanded while a
 * popout is open, close it (the expanded view shows the children
 * inline; a floating popout in front of inline children would be
 * visually confusing).
 */
function SidebarParentRow({
  item,
  pathname,
  collapsed,
  expanded,
  hasActiveChild,
  onToggleExpanded,
}: {
  item: AppSidebarItem
  pathname: string
  collapsed: boolean
  expanded: boolean
  hasActiveChild: boolean
  onToggleExpanded: () => void
}) {
  const [popoutOpen, setPopoutOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const popoutRef = useRef<HTMLDivElement>(null)

  // Reset popout when the sidebar transitions collapsed → expanded.
  // Uses React's recommended "compare-with-previous-state-during-
  // render" pattern (see "You Might Not Need an Effect" → "Adjusting
  // state when a prop changes"). Cheaper than a useEffect because the
  // adjustment happens during the same render pass, not on the next.
  const [prevCollapsed, setPrevCollapsed] = useState(collapsed)
  if (prevCollapsed !== collapsed) {
    setPrevCollapsed(collapsed)
    if (!collapsed && popoutOpen) {
      setPopoutOpen(false)
    }
  }

  useEffect(() => {
    if (!popoutOpen) return
    function onPointer(e: MouseEvent) {
      const t = e.target as Node | null
      if (!t) return
      if (popoutRef.current?.contains(t)) return
      if (anchorRef.current?.contains(t)) return
      setPopoutOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPopoutOpen(false)
    }
    document.addEventListener("mousedown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [popoutOpen])

  const Icon = ICONS[item.icon]
  const children = item.children ?? []

  if (collapsed) {
    return (
      <div className="relative">
        <button
          ref={anchorRef}
          type="button"
          onClick={() => {
            setPopoutOpen((o) => !o)
          }}
          aria-haspopup="menu"
          aria-expanded={popoutOpen}
          aria-label={item.label}
          title={item.label}
          data-testid={`sidebar-parent-${item.label.toLowerCase()}`}
          className={cn(
            "flex size-10 items-center justify-center rounded-md text-sm transition-colors",
            hasActiveChild || popoutOpen
              ? "bg-[var(--color-accent)] font-medium text-[var(--color-accent-foreground)]"
              : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-foreground)]",
          )}
        >
          <Icon className="size-4 shrink-0" />
        </button>
        {popoutOpen && (
          <div
            ref={popoutRef}
            role="menu"
            aria-label={item.label}
            data-testid={`sidebar-popout-${item.label.toLowerCase()}`}
            className="absolute top-0 left-full z-50 ml-2 min-w-[200px] rounded-md border border-[var(--color-border)] bg-[var(--color-background)] py-1 shadow-md"
          >
            <div className="border-b border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
              {item.label}
            </div>
            {children.map((child) => {
              if (!child.href) return null
              const ChildIcon = ICONS[child.icon]
              const childActive = pathname.startsWith(child.href)
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  role="menuitem"
                  onClick={() => {
                    setPopoutOpen(false)
                  }}
                  aria-current={childActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 text-sm",
                    childActive
                      ? "bg-[var(--color-accent)] font-medium text-[var(--color-accent-foreground)]"
                      : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-foreground)]",
                  )}
                >
                  <ChildIcon className="size-4 shrink-0" />
                  <span className="truncate">{child.label}</span>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // Expanded sidebar — inline chevron-expand view.
  return (
    <div>
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        data-testid={`sidebar-parent-${item.label.toLowerCase()}`}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
          hasActiveChild
            ? "bg-[var(--color-accent)] font-medium text-[var(--color-accent-foreground)]"
            : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-foreground)]",
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">{item.label}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 transition-transform duration-150",
            expanded ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>
      {expanded && (
        <div
          className="mt-1 ml-4 flex flex-col gap-1 border-l border-[var(--color-border)] pl-2"
          data-testid={`sidebar-children-${item.label.toLowerCase()}`}
        >
          {children.map((child) => {
            if (!child.href) return null
            const ChildIcon = ICONS[child.icon]
            const childActive = pathname.startsWith(child.href)
            return (
              <Link
                key={child.href}
                href={child.href}
                aria-current={childActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  childActive
                    ? "bg-[var(--color-accent)] font-medium text-[var(--color-accent-foreground)]"
                    : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-foreground)]",
                )}
              >
                <ChildIcon className="size-4 shrink-0" />
                <span className="truncate">{child.label}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
