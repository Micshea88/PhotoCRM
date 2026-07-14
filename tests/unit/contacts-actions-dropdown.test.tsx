/**
 * Push 2c.2 — ContactsActionsDropdown component tests.
 *
 * The dropdown lives in the top-right header of /contacts. After
 * Push 2c.2 it ONLY holds org-level items (Edit columns / Export /
 * Import / Restore / Manage duplicates). The bulk-row actions moved to
 * the SelectionBanner. The editorial-table toolbar rework added the two
 * Export items (CSV + XLSX) and folded the standalone top-bar Import
 * button into this menu. These tests pin the item set so a future
 * careless change can't silently grow the menu.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ContactsActionsDropdown } from "@/modules/contacts/ui/contacts-actions-dropdown"

// Radix DropdownMenu requires pointer events to open. jsdom doesn't
// fully implement pointer-capture, which trips Radix's pointer-capture
// guard. Shim with Object.defineProperty so eslint's unbound-method
// rule doesn't flag a prototype-method assignment.
beforeEach(() => {
  if (typeof window === "undefined") return
  Object.defineProperty(Element.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  })
  Object.defineProperty(Element.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  })
  Object.defineProperty(Element.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  })
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  })
})

describe("ContactsActionsDropdown", () => {
  it("renders the Actions trigger button", () => {
    render(
      <ContactsActionsDropdown onOpenEditColumns={() => undefined} onExport={() => undefined} />,
    )
    expect(screen.getByRole("button", { name: /actions/i })).toBeInTheDocument()
  })

  it("opens to exactly the 6 top-level items in order (Export is a submenu)", async () => {
    const user = userEvent.setup()
    render(
      <ContactsActionsDropdown onOpenEditColumns={() => undefined} onExport={() => undefined} />,
    )
    await user.click(screen.getByRole("button", { name: /actions/i }))
    const items = screen.getAllByRole("menuitem")
    expect(items.map((el) => el.textContent.trim())).toEqual([
      "Edit columns",
      "Export",
      "Import contacts",
      "Restore records",
      "View archived",
      "Manage duplicates",
    ])
  })

  it("Edit columns triggers the host callback", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<ContactsActionsDropdown onOpenEditColumns={onOpen} onExport={() => undefined} />)
    await user.click(screen.getByRole("button", { name: /actions/i }))
    await user.click(screen.getByRole("menuitem", { name: "Edit columns" }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("Export submenu → CSV / Excel trigger the host callback with the format", async () => {
    const user = userEvent.setup()
    const onExport = vi.fn()
    render(<ContactsActionsDropdown onOpenEditColumns={() => undefined} onExport={onExport} />)
    await user.click(screen.getByRole("button", { name: /actions/i }))
    // Open the Export submenu (SubTrigger opens on ArrowRight / Enter).
    const exportTrigger = screen.getByRole("menuitem", { name: "Export" })
    exportTrigger.focus()
    await user.keyboard("{ArrowRight}")
    await user.click(screen.getByRole("menuitem", { name: "CSV (.csv)" }))
    expect(onExport).toHaveBeenCalledWith("csv")

    await user.click(screen.getByRole("button", { name: /actions/i }))
    const exportTrigger2 = screen.getByRole("menuitem", { name: "Export" })
    exportTrigger2.focus()
    await user.keyboard("{ArrowRight}")
    await user.click(screen.getByRole("menuitem", { name: "Excel (.xlsx)" }))
    expect(onExport).toHaveBeenCalledWith("xlsx")
  })

  it("Manage duplicates links to /contacts/duplicates (Push 4 B1 — live route)", async () => {
    const user = userEvent.setup()
    render(
      <ContactsActionsDropdown onOpenEditColumns={() => undefined} onExport={() => undefined} />,
    )
    await user.click(screen.getByRole("button", { name: /actions/i }))
    const link = screen.getByRole("menuitem", { name: "Manage duplicates" })
    expect(link.getAttribute("href")).toBe("/contacts/duplicates")
    expect(link.getAttribute("aria-disabled")).not.toBe("true")
  })

  it("Import contacts and Restore records link to the right paths", async () => {
    const user = userEvent.setup()
    render(
      <ContactsActionsDropdown onOpenEditColumns={() => undefined} onExport={() => undefined} />,
    )
    await user.click(screen.getByRole("button", { name: /actions/i }))
    // DropdownMenuItem asChild causes the Link's <a> to receive the
    // menuitem role directly — the role lookup finds the anchor itself.
    const importItem = screen.getByRole("menuitem", { name: "Import contacts" })
    const restoreItem = screen.getByRole("menuitem", { name: "Restore records" })
    expect(importItem.getAttribute("href")).toBe("/contacts/import")
    expect(restoreItem.getAttribute("href")).toBe("/contacts/deleted")
  })
})
