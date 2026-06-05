/**
 * Hand-maintained route catalog for the AI Assistant's NAVIGATE
 * capability (Module 17a). ~20 entries; only routes that EXIST in
 * `app/(app)/` are listed — the AI cannot navigate to 404s.
 *
 * Per the AI layer principle (AI1, docs/PIVOTS_LEDGER.md): the AI
 * cannot invent routes. When asked about a screen that isn't in this
 * catalog, the assistant returns a refusal listing the available
 * routes.
 *
 * V1 posture is hand-maintained (~20 entries). Codegen from the
 * filesystem is a deferred future change — see module README "What's
 * deferred."
 *
 * If `requiresPermission` is set, the renderer is expected to gate
 * the link via `hasPermission()` before showing it to the user. The
 * assistant returns the route metadata; the UI decides whether to
 * link to it.
 */
export interface CatalogRoute {
  id: string
  path: string
  title: string
  description: string
  requiresPermission?: string
}

export const ROUTE_CATALOG: readonly CatalogRoute[] = [
  {
    id: "dashboard",
    path: "/dashboard",
    title: "Dashboard",
    description: "Home — at-a-glance summary of your active work.",
  },
  {
    id: "events_list",
    path: "/events",
    title: "Events",
    description: "List of all events (projects) in this organization.",
    requiresPermission: "view_events",
  },
  {
    id: "items_list",
    path: "/items",
    title: "Items",
    description: "List of items (worked-example module).",
  },
  {
    id: "items_new",
    path: "/items/new",
    title: "Create item",
    description: "Form to create a new item.",
  },
  {
    id: "settings_account",
    path: "/settings/account",
    title: "Account settings",
    description: "Manage your profile + password.",
  },
  {
    id: "settings_organization",
    path: "/settings/organization",
    title: "Organization settings",
    description: "Workspace name and basic config.",
    requiresPermission: "manage_settings",
  },
  {
    id: "settings_organization_members",
    path: "/settings/organization/members",
    title: "Team members",
    description: "Invite or manage members of this organization.",
    requiresPermission: "manage_settings",
  },
  {
    id: "settings_organization_danger",
    path: "/settings/organization/danger",
    title: "Danger zone",
    description: "Workspace deletion. Owner only.",
  },
  {
    id: "onboarding_create_organization",
    path: "/onboarding/create-organization",
    title: "Create organization",
    description: "Onboarding step to create your first organization.",
  },
  // P4-prep additions (additive only — no edits to entries above).
  // These three routes 404 until the corresponding Phase 4 list pages
  // (P4.2 / P4.3 / P4.4 / P4.5) ship. The catalog entries land now so
  // the sidebar in P4.1 has a single source of truth from day one.
  {
    id: "contacts_list",
    path: "/contacts",
    title: "Contacts",
    description: "List of all contacts in this organization.",
    requiresPermission: "view_contacts",
  },
  {
    id: "opportunities_list",
    path: "/opportunities",
    title: "Pipeline",
    description: "Sales-pipeline kanban — opportunities by stage.",
    requiresPermission: "view_events",
  },
  {
    id: "tasks_list",
    path: "/tasks",
    title: "Tasks",
    description: "List of tasks across your events.",
    requiresPermission: "view_events",
  },
  {
    // Push 4 (A2) — Custom fields manager. Owner + Admin only; the
    // sidebar gate in resolveSidebarItems additionally hides this
    // for Manager / Team member / Accountant. The `manage_settings`
    // permission listed here is the right wire-level gate, but the
    // sidebar resolver also checks the extended role since Manager
    // has manage_settings yet must NOT see this surface (matches
    // the spec: "match the Members pattern exactly").
    id: "settings_custom_fields",
    path: "/settings/custom-fields",
    title: "Custom fields",
    description: "Per-record-type custom field definitions for this studio.",
    requiresPermission: "manage_settings",
  },
  {
    id: "settings_integrations",
    path: "/settings/integrations",
    title: "Integrations",
    description: "Connect phone, calendar, email, and payment providers.",
    requiresPermission: "manage_settings",
  },
] as const

const ROUTE_BY_ID = new Map(ROUTE_CATALOG.map((r) => [r.id, r]))

export function findRouteById(id: string): CatalogRoute | null {
  return ROUTE_BY_ID.get(id) ?? null
}

export const ROUTE_IDS: readonly string[] = ROUTE_CATALOG.map((r) => r.id)
