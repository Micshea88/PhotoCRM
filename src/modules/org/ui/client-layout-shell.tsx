"use client"

import { useState, type CSSProperties, type ReactNode } from "react"
import { setUserPreference } from "@/modules/user-preferences/actions"
import { AppBottomNav } from "./app-bottom-nav"
import { AppSidebarNav, type AppSidebarItem } from "./app-sidebar-nav"

/**
 * Push 3 (C2) — client wrapper around the app shell's responsive
 * nav surfaces.
 *
 * Owns the desktop sidebar collapse state. Initial value comes from
 * the server (via `getUserPreference("nav_collapsed", null)` in the
 * layout) so the first render matches the user's saved preference —
 * no expanded → collapsed flicker on hydration.
 *
 * Why a client wrapper instead of doing everything in the server
 * layout: the collapse state lives in the URL of "client component
 * state we need to mutate from a button click". The simpler
 * alternatives (CSS-only via the [open] data attribute, or a
 * standalone subscriber that writes the CSS variable on
 * documentElement) trade clarity for less code.
 *
 * Layout shape:
 *   - Below `lg` (< 1024px): main content full-width, AppBottomNav
 *     fixed at the bottom of the viewport, side nav hidden.
 *   - At/above `lg`: side nav at left, width driven by the
 *     `--sidebar-w` CSS variable so the grid template responds to
 *     the collapsed state via a CSS transition.
 *
 * Toggle behavior: state updates locally (optimistic) then the
 * server action persists to user_preferences. If the action fails,
 * we don't revert the UI — the next page render will re-pull the
 * server value and reconcile. Toast on failure can come later.
 */
export function ClientLayoutShell({
  sidebarItems,
  initialCollapsed,
  children,
}: {
  sidebarItems: AppSidebarItem[]
  initialCollapsed: boolean
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    void setUserPreference({ key: "nav_collapsed", value: next, organizationId: null })
  }

  const sidebarStyle: CSSProperties = {
    width: "var(--sidebar-w)",
    transition: "width 200ms ease-in-out",
  }

  return (
    <div
      className="flex min-h-0 flex-1"
      style={
        {
          "--sidebar-w": collapsed ? "64px" : "240px",
        } as CSSProperties
      }
    >
      <aside className="hidden shrink-0 overflow-hidden lg:block" style={sidebarStyle}>
        <AppSidebarNav items={sidebarItems} collapsed={collapsed} onToggle={toggle} />
      </aside>
      <main className="flex-1 overflow-y-auto p-6 pb-20 lg:pb-6">{children}</main>
      <AppBottomNav className="lg:hidden" />
    </div>
  )
}
