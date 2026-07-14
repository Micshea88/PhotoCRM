"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ListChecks,
  Plug,
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
  | "plug"

const ICONS: Record<SidebarIconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  contacts: Users,
  events: ListChecks,
  opportunities: TrendingUp,
  tasks: CheckSquare,
  settings: Settings,
  customFields: SlidersHorizontal,
  plug: Plug,
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
        "flex h-full flex-col border-r border-[var(--color-sidebar-foreground)]/10 bg-[var(--color-sidebar)]",
      )}
    >
      <div className="flex items-center justify-end p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand ([)" : "Collapse ([)"}
          className="inline-flex size-7 items-center justify-center rounded-md text-[var(--color-sidebar-foreground)]/70 hover:bg-[var(--color-sidebar-foreground)]/10 hover:text-[var(--color-sidebar-foreground)]"
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
          ? "bg-[var(--color-brand-accent)] font-medium text-[var(--color-sidebar-foreground)]"
          : "text-[var(--color-sidebar-foreground)]/70 hover:bg-[var(--color-sidebar-foreground)]/10 hover:text-[var(--color-sidebar-foreground)]",
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
  // Popout coordinates in viewport space (top + left in px). null
  // until measured — render branch waits on this so the popout never
  // flashes at 0,0 before the first measurement.
  const [popoutPos, setPopoutPos] = useState<{ top: number; left: number } | null>(null)
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
      setPopoutPos(null)
    }
  }

  // Closing the popout resets BOTH popoutOpen and popoutPos. Resetting
  // popoutPos here (rather than in a useLayoutEffect cleanup branch
  // that would setState-in-effect) keeps the lint rule happy and
  // prevents a stale-coords flash on the next open.
  function closePopout() {
    setPopoutOpen(false)
    setPopoutPos(null)
  }

  // Measure the anchor button when the popout opens. The popout is
  // portaled into document.body to escape the sidebar's
  // overflow-hidden clip (which exists for the C2 width-collapse
  // animation). Position: fixed coords come from getBoundingClientRect.
  //
  // useLayoutEffect to set the position BEFORE the browser paints —
  // otherwise the portal would briefly render at top:0/left:0 before
  // sliding into place.
  useLayoutEffect(() => {
    if (!popoutOpen) return
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    // 8px gap between the anchor's right edge and the popout's left
    // edge — matches the previous `ml-2` (8px) spacing.
    setPopoutPos({ top: rect.top, left: rect.right + 8 })
  }, [popoutOpen])

  useEffect(() => {
    if (!popoutOpen) return
    function onPointer(e: MouseEvent) {
      const t = e.target as Node | null
      if (!t) return
      if (popoutRef.current?.contains(t)) return
      if (anchorRef.current?.contains(t)) return
      closePopout()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePopout()
    }
    // Scroll or resize while open: just close it. Re-measuring would
    // work but the popout is ephemeral by design (HubSpot pattern),
    // and closing on layout shift is the simpler, less janky choice.
    function onLayoutShift() {
      closePopout()
    }
    document.addEventListener("mousedown", onPointer)
    document.addEventListener("keydown", onKey)
    window.addEventListener("scroll", onLayoutShift, true)
    window.addEventListener("resize", onLayoutShift)
    return () => {
      document.removeEventListener("mousedown", onPointer)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", onLayoutShift, true)
      window.removeEventListener("resize", onLayoutShift)
    }
  }, [popoutOpen])

  const Icon = ICONS[item.icon]
  const children = item.children ?? []

  if (collapsed) {
    // Portal the popout into document.body so it escapes the
    // sidebar's overflow-hidden clip. Render only after position is
    // measured (popoutPos !== null) to avoid a top:0/left:0 flash.
    // Guard `typeof document` for SSR — this component is "use client"
    // but the file gets imported by server components too.
    const popout =
      popoutOpen && popoutPos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoutRef}
              role="menu"
              aria-label={item.label}
              data-testid={`sidebar-popout-${item.label.toLowerCase()}`}
              style={{ position: "fixed", top: popoutPos.top, left: popoutPos.left }}
              className="z-50 min-w-[200px] rounded-md border border-[var(--color-border)] bg-[var(--color-popover)] py-1 shadow-md"
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
                    onClick={closePopout}
                    aria-current={childActive ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 text-sm",
                      childActive
                        ? "bg-[var(--color-accent)] font-medium text-[var(--color-accent-foreground)]"
                        : "text-[var(--color-muted-foreground)] hover:bg-[var(--state-hover)] hover:text-[var(--color-accent-foreground)]",
                    )}
                  >
                    <ChildIcon className="size-4 shrink-0" />
                    <span className="truncate">{child.label}</span>
                  </Link>
                )
              })}
            </div>,
            document.body,
          )
        : null

    return (
      <div className="relative">
        <button
          ref={anchorRef}
          type="button"
          onClick={() => {
            if (popoutOpen) {
              closePopout()
            } else {
              setPopoutOpen(true)
            }
          }}
          aria-haspopup="menu"
          aria-expanded={popoutOpen}
          aria-label={item.label}
          title={item.label}
          data-testid={`sidebar-parent-${item.label.toLowerCase()}`}
          className={cn(
            "flex size-10 items-center justify-center rounded-md text-sm transition-colors",
            hasActiveChild || popoutOpen
              ? "bg-[var(--color-sidebar-foreground)]/15 font-medium text-[var(--color-sidebar-foreground)]"
              : "text-[var(--color-sidebar-foreground)]/70 hover:bg-[var(--color-sidebar-foreground)]/10 hover:text-[var(--color-sidebar-foreground)]",
          )}
        >
          <Icon className="size-4 shrink-0" />
        </button>
        {popout}
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
            ? "bg-[var(--color-sidebar-foreground)]/15 font-medium text-[var(--color-sidebar-foreground)]"
            : "text-[var(--color-sidebar-foreground)]/70 hover:bg-[var(--color-sidebar-foreground)]/10 hover:text-[var(--color-sidebar-foreground)]",
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
          className="mt-1 ml-4 flex flex-col gap-1 border-l border-[var(--color-sidebar-foreground)]/10 pl-2"
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
                    ? "bg-[var(--color-sidebar-foreground)]/15 font-medium text-[var(--color-sidebar-foreground)]"
                    : "text-[var(--color-sidebar-foreground)]/70 hover:bg-[var(--color-sidebar-foreground)]/10 hover:text-[var(--color-sidebar-foreground)]",
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
