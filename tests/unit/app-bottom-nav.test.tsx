/**
 * Push 3 (C2) — mobile bottom nav.
 *
 * The component is universal across the 6 roles (no RBAC filtering
 * in V1); per-role filtering can be layered later the same way the
 * side nav does it. These tests pin the 5-item structure + active-
 * state highlight.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { AppBottomNav } from "@/modules/org/ui/app-bottom-nav"

vi.mock("next/navigation", () => ({
  usePathname: () => "/contacts",
}))

describe("AppBottomNav", () => {
  it("renders all 5 locked nav items", () => {
    render(<AppBottomNav />)
    expect(screen.getByRole("link", { name: /Home/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Contacts/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Tasks/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Dashboards/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Search/ })).toBeInTheDocument()
  })

  it("marks the contacts link as aria-current when on /contacts", () => {
    render(<AppBottomNav />)
    const contacts = screen.getByRole("link", { name: /Contacts/ })
    expect(contacts).toHaveAttribute("aria-current", "page")
  })

  it("non-active links have no aria-current", () => {
    render(<AppBottomNav />)
    const tasks = screen.getByRole("link", { name: /Tasks/ })
    expect(tasks).not.toHaveAttribute("aria-current")
  })

  it("Tasks routes to /tasks placeholder (will 404 until P7)", () => {
    render(<AppBottomNav />)
    expect(screen.getByRole("link", { name: /Tasks/ })).toHaveAttribute("href", "/tasks")
  })

  it("Dashboards routes to /dashboards placeholder", () => {
    render(<AppBottomNav />)
    expect(screen.getByRole("link", { name: /Dashboards/ })).toHaveAttribute("href", "/dashboards")
  })

  it("Search routes to /search placeholder", () => {
    render(<AppBottomNav />)
    expect(screen.getByRole("link", { name: /Search/ })).toHaveAttribute("href", "/search")
  })
})
