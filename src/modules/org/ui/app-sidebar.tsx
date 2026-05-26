import { ROUTE_CATALOG, type CatalogRoute } from "@/modules/ai-assistant/route-catalog"
import { hasPermission } from "@/modules/rbac/queries"
import { cn } from "@/lib/utils"
import type { ExtendedRole, PermissionKey } from "@/modules/rbac/types"
import { AppSidebarNav, type AppSidebarItem, type SidebarIconKey } from "./app-sidebar-nav"

/**
 * V1 sidebar entry order. Each id MUST exist in ROUTE_CATALOG — the
 * sidebar is anchored to the catalog so the AI's NAVIGATE capability
 * and the human sidebar stay in sync (single source of truth).
 */
const SIDEBAR_ITEM_IDS = [
  "dashboard",
  "contacts_list",
  "events_list",
  "opportunities_list",
  "tasks_list",
  "settings_account",
  "settings_custom_fields",
] as const

/**
 * Icon-key map. Strings only — actual Lucide components are imported
 * by AppSidebarNav on the client side. Server-to-client prop boundary
 * can't carry forwardRef function references.
 */
const ICON_KEYS: Record<(typeof SIDEBAR_ITEM_IDS)[number], SidebarIconKey> = {
  dashboard: "dashboard",
  contacts_list: "contacts",
  events_list: "events",
  opportunities_list: "opportunities",
  tasks_list: "tasks",
  settings_account: "settings",
  settings_custom_fields: "customFields",
}

/**
 * Sidebar items that, in addition to the catalog's `requiresPermission`,
 * are restricted to Owner + Admin only. Manager / Team member /
 * Accountant don't see them. Spec language for /settings/custom-fields:
 * "match the Members pattern exactly".
 */
const OWNER_ADMIN_ONLY_SIDEBAR: ReadonlySet<string> = new Set(["settings_custom_fields"])

/**
 * Resolve the visible sidebar items for a user. Calls hasPermission
 * for each entry that requires one. MUST be called from inside a
 * `runWithOrgContext` scope (the layout sets this up). Returns a
 * plain array of items ready to render.
 *
 * `extendedRole` is the resolved 6-role for this org. Some sidebar
 * entries are Owner + Admin only (see OWNER_ADMIN_ONLY_SIDEBAR) — the
 * permission-only gate isn't enough because Manager has
 * manage_settings but must not see the custom-fields manager.
 *
 * Reason this is a separate function rather than inline in the sidebar
 * component: in Next.js production RSC, the layout's runWithOrgContext
 * scope does NOT propagate into async child server components — those
 * render outside the layout's ALS frame. So we resolve permissions
 * inside the layout's await chain and pass the resolved list to a
 * SYNC sidebar component below.
 */
export async function resolveSidebarItems(
  userId: string,
  extendedRole: ExtendedRole,
): Promise<AppSidebarItem[]> {
  const items: AppSidebarItem[] = []
  for (const id of SIDEBAR_ITEM_IDS) {
    const route = ROUTE_CATALOG.find((r): r is CatalogRoute => r.id === id)
    if (!route) continue
    if (OWNER_ADMIN_ONLY_SIDEBAR.has(id) && extendedRole !== "owner" && extendedRole !== "admin") {
      continue
    }
    if (route.requiresPermission) {
      const allowed = await hasPermission(userId, route.requiresPermission as PermissionKey)
      if (!allowed) continue
    }
    items.push({ href: route.path, label: route.title, icon: ICON_KEYS[id] })
  }
  return items
}

/**
 * Sync sidebar renderer. Takes pre-resolved items as a prop. The
 * permission-gating work happens in `resolveSidebarItems` (above),
 * called from the layout. This component just renders.
 */
export function AppSidebar({ items, className }: { items: AppSidebarItem[]; className?: string }) {
  return (
    <div className={cn(className)}>
      <AppSidebarNav items={items} />
    </div>
  )
}
