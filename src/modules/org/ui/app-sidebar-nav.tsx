"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  CheckSquare,
  LayoutDashboard,
  ListChecks,
  Settings,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Sidebar icons keyed by short string. The server-side AppSidebar
 * resolves items with these string keys; this client component maps
 * the key to the actual Lucide component. We can't pass the Lucide
 * components themselves across the server→client boundary because
 * React Server Components serializes props and function references
 * (forwardRef components) aren't serializable.
 */
export type SidebarIconKey =
  | "dashboard"
  | "contacts"
  | "events"
  | "opportunities"
  | "tasks"
  | "settings"

const ICONS: Record<SidebarIconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  contacts: Users,
  events: ListChecks,
  opportunities: TrendingUp,
  tasks: CheckSquare,
  settings: Settings,
}

export interface AppSidebarItem {
  href: string
  label: string
  icon: SidebarIconKey
}

/**
 * Client child of the server-rendered AppSidebar. The server component
 * resolves which items the team member is allowed to see (via
 * hasPermission); this component handles the `usePathname`-driven
 * active-state highlighting AND maps icon keys to Lucide components
 * (which must live on the client side of the boundary because forwardRef
 * function references aren't serializable).
 */
export function AppSidebarNav({ items }: { items: AppSidebarItem[] }) {
  const pathname = usePathname()
  return (
    <nav className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const isActive =
          pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
        const Icon = ICONS[item.icon]
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-[var(--color-accent)] font-medium text-[var(--color-accent-foreground)]"
                : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-foreground)]",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
