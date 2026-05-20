import {
  CheckSquare,
  LayoutDashboard,
  ListChecks,
  Settings,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react"
import { ROUTE_CATALOG, type CatalogRoute } from "@/modules/ai-assistant/route-catalog"
import { hasPermission } from "@/modules/rbac/queries"
import { cn } from "@/lib/utils"
import type { PermissionKey } from "@/modules/rbac/types"
import { AppSidebarNav, type AppSidebarItem } from "./app-sidebar-nav"

/**
 * V1 sidebar entry order. Each id MUST exist in ROUTE_CATALOG — the
 * sidebar is anchored to the catalog so the AI's NAVIGATE capability
 * and the human sidebar stay in sync (single source of truth). The
 * "show in sidebar?" concern stays here, not on the catalog rows; the
 * catalog is for "the AI may navigate here," which is a superset of
 * "show in sidebar" (the catalog also includes settings sub-pages,
 * forms, onboarding, etc.).
 *
 * Settings sub-items (Members, Pipelines, Project Templates,
 * Terminology, Custom Fields) are intentionally NOT in this list. The
 * Settings landing page filters them per-permission in a later commit.
 */
const SIDEBAR_ITEM_IDS = [
  "dashboard",
  "contacts_list",
  "events_list",
  "opportunities_list",
  "tasks_list",
  "settings_account",
] as const

const ICONS: Record<(typeof SIDEBAR_ITEM_IDS)[number], LucideIcon> = {
  dashboard: LayoutDashboard,
  contacts_list: Users,
  events_list: ListChecks,
  opportunities_list: TrendingUp,
  tasks_list: CheckSquare,
  settings_account: Settings,
}

export async function AppSidebar({ userId, className }: { userId: string; className?: string }) {
  const items: AppSidebarItem[] = []
  for (const id of SIDEBAR_ITEM_IDS) {
    const route = ROUTE_CATALOG.find((r): r is CatalogRoute => r.id === id)
    if (!route) continue
    if (route.requiresPermission) {
      const allowed = await hasPermission(userId, route.requiresPermission as PermissionKey)
      if (!allowed) continue
    }
    items.push({ href: route.path, label: route.title, icon: ICONS[id] })
  }
  return (
    <div className={cn(className)}>
      <AppSidebarNav items={items} />
    </div>
  )
}
