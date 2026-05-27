import "server-only"
import { ROUTE_CATALOG, type CatalogRoute } from "@/modules/ai-assistant/route-catalog"
import { hasPermission } from "@/modules/rbac/queries"
import type { ExtendedRole, PermissionKey } from "@/modules/rbac/types"
import type { AppSidebarItem, SidebarIconKey } from "./app-sidebar-nav"

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

type SidebarItemId = (typeof SIDEBAR_ITEM_IDS)[number]

/**
 * Icon-key map. Strings only — actual Lucide components are imported
 * by AppSidebarNav on the client side. Server-to-client prop boundary
 * can't carry forwardRef function references.
 */
const ICON_KEYS: Record<SidebarItemId, SidebarIconKey> = {
  dashboard: "dashboard",
  contacts_list: "contacts",
  events_list: "events",
  opportunities_list: "opportunities",
  tasks_list: "tasks",
  settings_account: "settings",
  settings_custom_fields: "customFields",
}

/**
 * Push 3 (C2) — full 6-role visibility matrix per the locked
 * `pathway-build-roadmap.md` decisions. A nav id appears for a role
 * only if that role is in the matrix entry; otherwise the entry is
 * hidden.
 *
 * Note on the codebase having 6 EXTENDED_ROLES vs the locked 4-role
 * spec: the audit (push-3-audit.md §13) surfaced the gap. C2
 * resolves accountant + client per the audit recommendation —
 * accountant gets a stripped nav matching their financial-tables-
 * only scope; client gets dashboard-only (V2 portal placeholder).
 *
 * Items NOT in this map are visible to no one (defensive). To open
 * a new entry to a role, add it explicitly.
 */
const NAV_ROLE_VISIBILITY: Record<SidebarItemId, ReadonlySet<ExtendedRole>> = {
  dashboard: new Set(["owner", "admin", "manager", "user", "accountant", "client"]),
  contacts_list: new Set(["owner", "admin", "manager", "user", "accountant"]),
  events_list: new Set(["owner", "admin", "manager", "user"]),
  opportunities_list: new Set(["owner", "admin", "manager", "user"]),
  tasks_list: new Set(["owner", "admin", "manager", "user"]),
  // The Account settings page is each user's own profile/password page —
  // surface to everyone (except client, who has no V1 nav past dashboard).
  settings_account: new Set(["owner", "admin", "manager", "user", "accountant"]),
  // Custom fields admin: Owner + Admin only. Manager has manage_settings
  // permission but must NOT reshape the per-org schema; same gate as
  // /settings/organization/members in the existing codebase pattern.
  settings_custom_fields: new Set(["owner", "admin"]),
}

/**
 * Resolve the visible sidebar items for a user. Calls hasPermission
 * for each entry that requires one. MUST be called from inside a
 * `runWithOrgContext` scope (the layout sets this up). Returns a
 * plain array of items ready to render.
 *
 * `extendedRole` is the resolved 6-role for this org. Two-layer
 * gating: (a) per-role visibility from NAV_ROLE_VISIBILITY,
 * (b) per-entry hasPermission for the catalog's requiresPermission
 * field. Both must pass.
 *
 * Reason this is a separate function rather than inline in the
 * sidebar component: in Next.js production RSC, the layout's
 * runWithOrgContext scope does NOT propagate into async child
 * server components — those render outside the layout's ALS frame.
 * Resolve permissions inside the layout's await chain, then pass
 * a plain array to the client renderer.
 */
export async function resolveSidebarItems(
  userId: string,
  extendedRole: ExtendedRole,
): Promise<AppSidebarItem[]> {
  const items: AppSidebarItem[] = []
  for (const id of SIDEBAR_ITEM_IDS) {
    const allowed = NAV_ROLE_VISIBILITY[id].has(extendedRole)
    if (!allowed) continue
    const route = ROUTE_CATALOG.find((r): r is CatalogRoute => r.id === id)
    if (!route) continue
    if (route.requiresPermission) {
      const granted = await hasPermission(userId, route.requiresPermission as PermissionKey)
      if (!granted) continue
    }
    items.push({ href: route.path, label: route.title, icon: ICON_KEYS[id] })
  }
  return items
}
