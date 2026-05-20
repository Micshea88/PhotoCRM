"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

export interface AppSidebarItem {
  href: string
  label: string
  icon: LucideIcon
}

/**
 * Client child of the server-rendered AppSidebar. The server component
 * resolves which items the team member is allowed to see (via
 * hasPermission); this component only handles the `usePathname`-driven
 * active-state highlighting. Splitting the responsibilities lets the
 * permission check stay server-side (no client round-trip) while
 * keeping active-state interactive.
 */
export function AppSidebarNav({ items }: { items: AppSidebarItem[] }) {
  const pathname = usePathname()
  return (
    <nav className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const isActive =
          pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
        const Icon = item.icon
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
