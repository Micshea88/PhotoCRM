/**
 * Push 3 post-C2 nav hotfix — Settings parent grouping behavior.
 *
 * Covers what the C2 tests don't:
 *   - parent renders chevron-expand row when sidebar expanded
 *   - parent renders icon-only with popout when sidebar collapsed
 *   - active sub-route auto-expands the parent (no persist)
 *   - chevron click persists via setUserPreference (nav_settings_expanded)
 *   - popout dismiss: Esc + click-outside + child-link click
 *   - popout closes when sidebar transitions collapsed → expanded
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AppSidebarNav, type AppSidebarItem } from "@/modules/org/ui/app-sidebar-nav"

let currentPathname = "/dashboard"
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}))

const setUserPreferenceMock = vi.fn()
vi.mock("@/modules/user-preferences/actions", () => ({
  setUserPreference: (...args: unknown[]): void => {
    setUserPreferenceMock(...args)
  },
}))

function makeItems(): AppSidebarItem[] {
  return [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    {
      href: null,
      label: "Settings",
      icon: "settings",
      childRoutePrefix: "/settings",
      children: [
        { href: "/settings/account", label: "Account settings", icon: "settings" },
        { href: "/settings/custom-fields", label: "Custom fields", icon: "customFields" },
      ],
    },
  ]
}

beforeEach(() => {
  currentPathname = "/dashboard"
  setUserPreferenceMock.mockReset()
})

describe("Settings parent — inline (sidebar expanded)", () => {
  it("renders the parent label and the chevron-expand button", () => {
    render(
      <AppSidebarNav
        items={makeItems()}
        collapsed={false}
        onToggle={vi.fn()}
        initialSettingsExpanded={false}
      />,
    )
    const parentBtn = screen.getByTestId("sidebar-parent-settings")
    expect(parentBtn).toBeInTheDocument()
    expect(parentBtn).toHaveAttribute("aria-expanded", "false")
  })

  it("does NOT render children when collapsed inline and not on a settings route", () => {
    render(
      <AppSidebarNav
        items={makeItems()}
        collapsed={false}
        onToggle={vi.fn()}
        initialSettingsExpanded={false}
      />,
    )
    expect(screen.queryByText("Account settings")).not.toBeInTheDocument()
    expect(screen.queryByText("Custom fields")).not.toBeInTheDocument()
  })

  it("renders children when initialSettingsExpanded is true", () => {
    render(
      <AppSidebarNav
        items={makeItems()}
        collapsed={false}
        onToggle={vi.fn()}
        initialSettingsExpanded={true}
      />,
    )
    expect(screen.getByText("Account settings")).toBeInTheDocument()
    expect(screen.getByText("Custom fields")).toBeInTheDocument()
  })

  it("clicking the parent button toggles inline children + persists the pref", async () => {
    const user = userEvent.setup()
    render(
      <AppSidebarNav
        items={makeItems()}
        collapsed={false}
        onToggle={vi.fn()}
        initialSettingsExpanded={false}
      />,
    )
    const parentBtn = screen.getByTestId("sidebar-parent-settings")
    await user.click(parentBtn)
    expect(screen.getByText("Account settings")).toBeInTheDocument()
    expect(setUserPreferenceMock).toHaveBeenCalledWith({
      key: "nav_settings_expanded",
      value: true,
      organizationId: null,
    })
  })
})

describe("Settings parent — auto-expand on active sub-route", () => {
  it("auto-expands when pathname is under /settings, even with initialSettingsExpanded=false", () => {
    currentPathname = "/settings/custom-fields"
    render(
      <AppSidebarNav
        items={makeItems()}
        collapsed={false}
        onToggle={vi.fn()}
        initialSettingsExpanded={false}
      />,
    )
    expect(screen.getByText("Account settings")).toBeInTheDocument()
    expect(screen.getByText("Custom fields")).toBeInTheDocument()
  })

  it("auto-expand does NOT call setUserPreference (render-only override)", () => {
    currentPathname = "/settings/account"
    render(
      <AppSidebarNav
        items={makeItems()}
        collapsed={false}
        onToggle={vi.fn()}
        initialSettingsExpanded={false}
      />,
    )
    expect(setUserPreferenceMock).not.toHaveBeenCalled()
  })

  it("marks the active child link with aria-current", () => {
    currentPathname = "/settings/custom-fields"
    render(
      <AppSidebarNav
        items={makeItems()}
        collapsed={false}
        onToggle={vi.fn()}
        initialSettingsExpanded={false}
      />,
    )
    const link = screen.getByRole("link", { name: /Custom fields/ })
    expect(link).toHaveAttribute("aria-current", "page")
  })
})

describe("Settings parent — popout (sidebar collapsed)", () => {
  it("renders parent icon button but no popout by default", () => {
    render(
      <AppSidebarNav
        items={makeItems()}
        collapsed={true}
        onToggle={vi.fn()}
        initialSettingsExpanded={false}
      />,
    )
    expect(screen.getByTestId("sidebar-parent-settings")).toBeInTheDocument()
    expect(screen.queryByTestId("sidebar-popout-settings")).not.toBeInTheDocument()
  })

  it("clicking the parent icon opens the popout panel with children", async () => {
    const user = userEvent.setup()
    render(
      <AppSidebarNav
        items={makeItems()}
        collapsed={true}
        onToggle={vi.fn()}
        initialSettingsExpanded={false}
      />,
    )
    await user.click(screen.getByTestId("sidebar-parent-settings"))
    const popout = screen.getByTestId("sidebar-popout-settings")
    expect(popout).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: /Account settings/ })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: /Custom fields/ })).toBeInTheDocument()
  })

  it("clicking the parent icon does NOT persist a pref (popout is ephemeral)", async () => {
    const user = userEvent.setup()
    render(
      <AppSidebarNav
        items={makeItems()}
        collapsed={true}
        onToggle={vi.fn()}
        initialSettingsExpanded={false}
      />,
    )
    await user.click(screen.getByTestId("sidebar-parent-settings"))
    expect(setUserPreferenceMock).not.toHaveBeenCalled()
  })

  it("Escape closes the popout", async () => {
    const user = userEvent.setup()
    render(
      <AppSidebarNav
        items={makeItems()}
        collapsed={true}
        onToggle={vi.fn()}
        initialSettingsExpanded={false}
      />,
    )
    await user.click(screen.getByTestId("sidebar-parent-settings"))
    expect(screen.getByTestId("sidebar-popout-settings")).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByTestId("sidebar-popout-settings")).not.toBeInTheDocument()
  })

  it("clicking outside closes the popout", async () => {
    const user = userEvent.setup()
    render(
      <>
        <div data-testid="outside">outside</div>
        <AppSidebarNav
          items={makeItems()}
          collapsed={true}
          onToggle={vi.fn()}
          initialSettingsExpanded={false}
        />
      </>,
    )
    await user.click(screen.getByTestId("sidebar-parent-settings"))
    expect(screen.getByTestId("sidebar-popout-settings")).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByTestId("outside"))
    expect(screen.queryByTestId("sidebar-popout-settings")).not.toBeInTheDocument()
  })

  it("clicking a child link in the popout closes it", async () => {
    const user = userEvent.setup()
    render(
      <AppSidebarNav
        items={makeItems()}
        collapsed={true}
        onToggle={vi.fn()}
        initialSettingsExpanded={false}
      />,
    )
    await user.click(screen.getByTestId("sidebar-parent-settings"))
    const accountLink = screen.getByRole("menuitem", { name: /Account settings/ })
    await user.click(accountLink)
    expect(screen.queryByTestId("sidebar-popout-settings")).not.toBeInTheDocument()
  })

  it("closes the popout when sidebar transitions collapsed → expanded", async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <AppSidebarNav
        items={makeItems()}
        collapsed={true}
        onToggle={vi.fn()}
        initialSettingsExpanded={false}
      />,
    )
    await user.click(screen.getByTestId("sidebar-parent-settings"))
    expect(screen.getByTestId("sidebar-popout-settings")).toBeInTheDocument()
    rerender(
      <AppSidebarNav
        items={makeItems()}
        collapsed={false}
        onToggle={vi.fn()}
        initialSettingsExpanded={false}
      />,
    )
    expect(screen.queryByTestId("sidebar-popout-settings")).not.toBeInTheDocument()
  })
})
