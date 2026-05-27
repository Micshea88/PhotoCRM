/**
 * Push 3 (C2) — collapse state + toggle button + `[` keyboard
 * shortcut behavior on the desktop sidebar.
 *
 * Server-side role visibility filtering is covered by the existing
 * `app-sidebar.test.tsx` + integration tests against the full
 * runWithOrgContext stack. This file is purely about the client
 * interactions Push 3 C2 adds.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AppSidebarNav, type AppSidebarItem } from "@/modules/org/ui/app-sidebar-nav"

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}))

const ITEMS: AppSidebarItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/contacts", label: "Contacts", icon: "contacts" },
]

describe("AppSidebarNav — collapse state", () => {
  it("renders labels when expanded", () => {
    render(<AppSidebarNav items={ITEMS} collapsed={false} onToggle={vi.fn()} />)
    expect(screen.getByText("Dashboard")).toBeInTheDocument()
    expect(screen.getByText("Contacts")).toBeInTheDocument()
  })

  it("hides labels when collapsed (icons-only)", () => {
    render(<AppSidebarNav items={ITEMS} collapsed={true} onToggle={vi.fn()} />)
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument()
    expect(screen.queryByText("Contacts")).not.toBeInTheDocument()
    // Links still rendered, accessible via title attribute (hover tooltip).
    const dashboardLink = screen.getByRole("link", { name: /Dashboard/ })
    expect(dashboardLink).toHaveAttribute("title", "Dashboard")
  })

  it("toggle button calls onToggle", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<AppSidebarNav items={ITEMS} collapsed={false} onToggle={onToggle} />)
    const button = screen.getByRole("button", { name: /Collapse navigation/ })
    await user.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("toggle button aria-label flips with state", () => {
    const { rerender } = render(
      <AppSidebarNav items={ITEMS} collapsed={false} onToggle={vi.fn()} />,
    )
    expect(screen.getByRole("button", { name: /Collapse navigation/ })).toBeInTheDocument()
    rerender(<AppSidebarNav items={ITEMS} collapsed={true} onToggle={vi.fn()} />)
    expect(screen.getByRole("button", { name: /Expand navigation/ })).toBeInTheDocument()
  })
})

describe("AppSidebarNav — `[` keyboard shortcut", () => {
  it("toggles when pressed with no input focused", () => {
    const onToggle = vi.fn()
    render(<AppSidebarNav items={ITEMS} collapsed={false} onToggle={onToggle} />)
    fireEvent.keyDown(document, { key: "[" })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("does NOT toggle when pressed while an input is focused", () => {
    const onToggle = vi.fn()
    render(
      <>
        <input data-testid="text-input" />
        <AppSidebarNav items={ITEMS} collapsed={false} onToggle={onToggle} />
      </>,
    )
    const input = screen.getByTestId("text-input")
    input.focus()
    fireEvent.keyDown(input, { key: "[" })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it("does NOT toggle when pressed while a textarea is focused", () => {
    const onToggle = vi.fn()
    render(
      <>
        <textarea data-testid="textarea" />
        <AppSidebarNav items={ITEMS} collapsed={false} onToggle={onToggle} />
      </>,
    )
    const textarea = screen.getByTestId("textarea")
    textarea.focus()
    fireEvent.keyDown(textarea, { key: "[" })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it("does NOT toggle when Cmd/Ctrl+[ is pressed (browser back shortcut)", () => {
    const onToggle = vi.fn()
    render(<AppSidebarNav items={ITEMS} collapsed={false} onToggle={onToggle} />)
    fireEvent.keyDown(document, { key: "[", metaKey: true })
    expect(onToggle).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: "[", ctrlKey: true })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it("does NOT fire for other keys", () => {
    const onToggle = vi.fn()
    render(<AppSidebarNav items={ITEMS} collapsed={false} onToggle={onToggle} />)
    fireEvent.keyDown(document, { key: "]" })
    fireEvent.keyDown(document, { key: "Enter" })
    fireEvent.keyDown(document, { key: " " })
    expect(onToggle).not.toHaveBeenCalled()
  })
})
