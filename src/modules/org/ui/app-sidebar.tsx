import "server-only"
import { ROUTE_CATALOG, type CatalogRoute } from "@/modules/ai-assistant/route-catalog"
import { hasPermission } from "@/modules/rbac/queries"
import type { ExtendedRole, PermissionKey } from "@/modules/rbac/types"
import type { AppSidebarItem, SidebarIconKey } from "./app-sidebar-nav"

/**
 * V1 sidebar leaf ids. Each MUST exist in ROUTE_CATALOG — leaves are
 * anchored to the catalog so the AI's NAVIGATE capability and the
 * human sidebar stay in sync (single source of truth).
 */
type SidebarLeafId =
  | "dashboard"
  | "contacts_list"
  | "events_list"
  | "opportunities_list"
  | "tasks_list"
  | "settings_account"
  | "settings_custom_fields"

/**
 * Icon-key map. Strings only — actual Lucide components are imported
 * by AppSidebarNav on the client side. Server-to-client prop boundary
 * can't carry forwardRef function references.
 */
const ICON_KEYS: Record<SidebarLeafId, SidebarIconKey> = {
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
 * `pathway-build-roadmap.md` decisions. A nav leaf id appears for a
 * role only if that role is in the matrix entry; otherwise hidden.
 *
 * Items NOT in this map are visible to no one (defensive). To open
 * a new entry to a role, add it explicitly.
 */
const NAV_ROLE_VISIBILITY: Record<SidebarLeafId, ReadonlySet<ExtendedRole>> = {
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
 * Push 3 post-C2 nav hotfix — sidebar items are a 2-level tree.
 * Top-level leaves render directly; top-level parents render their
 * children indented (HubSpot pattern). Tree order is the render order.
 *
 * Locked rule (see pathway-build-roadmap.md → "Settings always last"):
 * the Settings parent group MUST stay last in this tree. The runtime
 * assert below catches a future edit that violates this.
 *
 * The parent grouping is UI-only — parents have NO ROUTE_CATALOG
 * entry, so the AI assistant's `navigate` capability is unchanged
 * (it still routes to settings_account / settings_custom_fields by
 * leaf id directly).
 */
interface SidebarLeafSpec {
  kind: "leaf"
  id: SidebarLeafId
}
interface SidebarParentSpec {
  kind: "parent"
  id: string
  label: string
  icon: SidebarIconKey
  childRoutePrefix: string
  children: readonly SidebarLeafSpec[]
}
type SidebarTreeEntry = SidebarLeafSpec | SidebarParentSpec

const SIDEBAR_TREE: readonly SidebarTreeEntry[] = [
  { kind: "leaf", id: "dashboard" },
  { kind: "leaf", id: "contacts_list" },
  { kind: "leaf", id: "events_list" },
  { kind: "leaf", id: "opportunities_list" },
  { kind: "leaf", id: "tasks_list" },
  {
    kind: "parent",
    id: "settings",
    label: "Settings",
    icon: "settings",
    childRoutePrefix: "/settings",
    children: [
      { kind: "leaf", id: "settings_account" },
      { kind: "leaf", id: "settings_custom_fields" },
    ],
  },
] as const

// Settings-always-last invariant: the last entry of SIDEBAR_TREE must
// be the Settings parent. A future edit that adds a new top-level
// entry after Settings will trip this in dev. Cheap to keep.
if (
  SIDEBAR_TREE[SIDEBAR_TREE.length - 1]?.kind !== "parent" ||
  (SIDEBAR_TREE[SIDEBAR_TREE.length - 1] as SidebarParentSpec).id !== "settings"
) {
  throw new Error(
    "sidebar invariant: 'settings' parent MUST be the last entry in SIDEBAR_TREE (see pathway-build-roadmap.md → 'Settings always last')",
  )
}

async function resolveLeaf(
  id: SidebarLeafId,
  userId: string,
  extendedRole: ExtendedRole,
): Promise<AppSidebarItem | null> {
  if (!NAV_ROLE_VISIBILITY[id].has(extendedRole)) return null
  const route = ROUTE_CATALOG.find((r): r is CatalogRoute => r.id === id)
  if (!route) return null
  if (route.requiresPermission) {
    const granted = await hasPermission(userId, route.requiresPermission as PermissionKey)
    if (!granted) return null
  }
  return { href: route.path, label: route.title, icon: ICON_KEYS[id] }
}

/**
 * Resolve the visible sidebar items for a user. MUST be called from
 * inside a `runWithOrgContext` scope (the layout sets this up).
 * Returns a nested array of items ready to render.
 *
 * Parent groups whose children all filter out are themselves dropped
 * — no empty parent rows in the UI.
 */
export async function resolveSidebarItems(
  userId: string,
  extendedRole: ExtendedRole,
): Promise<AppSidebarItem[]> {
  const items: AppSidebarItem[] = []
  for (const entry of SIDEBAR_TREE) {
    if (entry.kind === "leaf") {
      const leaf = await resolveLeaf(entry.id, userId, extendedRole)
      if (leaf) items.push(leaf)
    } else {
      const children: AppSidebarItem[] = []
      for (const child of entry.children) {
        const leaf = await resolveLeaf(child.id, userId, extendedRole)
        if (leaf) children.push(leaf)
      }
      if (children.length > 0) {
        items.push({
          href: null,
          label: entry.label,
          icon: entry.icon,
          childRoutePrefix: entry.childRoutePrefix,
          children,
        })
      }
    }
  }
  return items
}
