"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, ListChecks, Settings } from "lucide-react"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/items", label: "Items", icon: ListChecks },
  { href: "/settings/account", label: "Settings", icon: Settings },
]

export function AppSidebar({ className }: { className?: string }) {
  const pathname = usePathname()
  return (
    <nav className={cn("flex flex-col gap-1 p-3", className)}>
      {NAV.map((item) => {
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
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
