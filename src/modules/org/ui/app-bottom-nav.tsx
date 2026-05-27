"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CheckSquare, Home, LayoutDashboard, Search, Users, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Push 3 (C2) — mobile bottom nav at viewport widths below `lg`
 * (1024px). 5 items per the locked roadmap: Home / Contacts /
 * Tasks / Dashboards / Search.
 *
 * Tasks + Dashboards + Search routes don't exist yet — Tasks ships
 * in P7, Dashboards later, Search either as a route or a global
 * search modal. The placeholder hrefs will 404 until those routes
 * land; that's OK for now (per the C2 spec). The nav structure
 * ships now so future modules just fill in the destinations.
 *
 * Visibility (host responsibility): the caller adds
 * `className="lg:hidden"` so the bar is hidden on desktop. On
 * mobile, the bar is fixed at the bottom of the viewport; the host
 * also adds `pb-20 lg:pb-6` (or similar) to main content so it
 * doesn't sit under the bar.
 *
 * Bottom-nav items are NOT RBAC-gated in V1 — the bar is universal
 * across the 6 roles (the most-trafficked surfaces). Per-role
 * filtering can be added the same way the side nav does it
 * (NAV_ROLE_VISIBILITY in app-sidebar.tsx) when client/accountant
 * use cases need it.
 */

interface BottomNavItem {
  href: string
  label: string
  Icon: LucideIcon
}

const BOTTOM_NAV_ITEMS: BottomNavItem[] = [
  { href: "/dashboard", label: "Home", Icon: Home },
  { href: "/contacts", label: "Contacts", Icon: Users },
  // Tasks (P7), Dashboards (later), Search (later) — 404 until then
  // by design.
  { href: "/tasks", label: "Tasks", Icon: CheckSquare },
  { href: "/dashboards", label: "Dashboards", Icon: LayoutDashboard },
  { href: "/search", label: "Search", Icon: Search },
]

export function AppBottomNav({ className }: { className?: string }) {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Mobile navigation"
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[var(--color-border)] bg-[var(--color-background)] pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      {BOTTOM_NAV_ITEMS.map((item) => {
        const isActive =
          pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
        const Icon = item.Icon
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 py-2 text-xs transition-colors",
              isActive
                ? "font-medium text-[var(--color-accent-foreground)]"
                : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
            )}
          >
            <Icon className={cn("size-5", isActive && "stroke-2")} />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
