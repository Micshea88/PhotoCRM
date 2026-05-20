/**
 * Component test for the sidebar's client child — the active-state
 * highlighter. The role-gated visibility decision is made in the
 * SERVER component (app-sidebar.tsx), so this test focuses on what
 * the client component does: render a passed list of items and apply
 * `aria-current` to the active one based on usePathname.
 *
 * The owner / user / client visibility shapes are verified indirectly:
 *   - The server component (server-side, with hasPermission) is
 *     responsible for filtering. Its behavior is integration-test
 *     territory (RLS + permission map); we don't render it in jsdom
 *     because hasPermission requires a real DB tx.
 *   - This test confirms the renderer respects whatever items the
 *     server feeds it — which means "owner gets six entries" is a
 *     six-prop list to this component, "client gets two" is a two-
 *     prop list, etc.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { AppSidebarNav, type AppSidebarItem } from "@/modules/org/ui/app-sidebar-nav"

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}))

const OWNER_ITEMS: AppSidebarItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/contacts", label: "Contacts", icon: "contacts" },
  { href: "/events", label: "Events", icon: "events" },
  { href: "/opportunities", label: "Pipeline", icon: "opportunities" },
  { href: "/tasks", label: "Tasks", icon: "tasks" },
  { href: "/settings/account", label: "Settings", icon: "settings" },
]

const USER_ITEMS: AppSidebarItem[] = [
  // The standard team-member tier (`user`) gets view_contacts +
  // view_events. They see the same six entries; the Settings sub-pages
  // (Members, Pipelines, etc.) are gated at the Settings landing page,
  // not in the sidebar.
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/contacts", label: "Contacts", icon: "contacts" },
  { href: "/events", label: "Events", icon: "events" },
  { href: "/opportunities", label: "Pipeline", icon: "opportunities" },
  { href: "/tasks", label: "Tasks", icon: "tasks" },
  { href: "/settings/account", label: "Settings", icon: "settings" },
]

const CLIENT_ITEMS: AppSidebarItem[] = [
  // Client has no permissions in V1, so view_contacts / view_events
  // gate out. Only Dashboard + Settings (account) remain.
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/settings/account", label: "Settings", icon: "settings" },
]

describe("AppSidebarNav — renders the items the server passes in", () => {
  it("owner sees all six entries", () => {
    render(<AppSidebarNav items={OWNER_ITEMS} />)
    for (const item of OWNER_ITEMS) {
      expect(screen.getByText(item.label)).toBeInTheDocument()
    }
  })

  it("user (standard team-member tier) sees the same six entries", () => {
    render(<AppSidebarNav items={USER_ITEMS} />)
    for (const item of USER_ITEMS) {
      expect(screen.getByText(item.label)).toBeInTheDocument()
    }
  })

  it("client sees only Dashboard + Settings", () => {
    render(<AppSidebarNav items={CLIENT_ITEMS} />)
    expect(screen.getByText("Dashboard")).toBeInTheDocument()
    expect(screen.getByText("Settings")).toBeInTheDocument()
    expect(screen.queryByText("Contacts")).not.toBeInTheDocument()
    expect(screen.queryByText("Pipeline")).not.toBeInTheDocument()
    expect(screen.queryByText("Tasks")).not.toBeInTheDocument()
  })
})

describe("AppSidebarNav — active-state highlighting", () => {
  it("marks the dashboard link as aria-current when on /dashboard", () => {
    render(<AppSidebarNav items={OWNER_ITEMS} />)
    const dashboard = screen.getByRole("link", { name: /Dashboard/ })
    expect(dashboard).toHaveAttribute("aria-current", "page")
  })

  it("non-active links have no aria-current", () => {
    render(<AppSidebarNav items={OWNER_ITEMS} />)
    const contacts = screen.getByRole("link", { name: /Contacts/ })
    expect(contacts).not.toHaveAttribute("aria-current")
  })
})
