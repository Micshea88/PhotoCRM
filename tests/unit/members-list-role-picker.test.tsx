/**
 * Push 2c.5.1 — MembersList role-picker contract.
 *
 * The dropdown surfaces the 5 INTERNAL roles only: Owner, Admin,
 * Manager, User, Accountant. "Client" stays in the EXTENDED_ROLES
 * union (forward-compat for the V2 client-portal work) but is
 * filtered out of the picker — clients are external users invited
 * via a future contact-portal flow, not org members.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MembersList } from "@/modules/org/ui/members-list"

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    refresh: () => undefined,
  }),
}))

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    organization: {
      removeMember: () => Promise.resolve({}),
    },
  },
}))

vi.mock("@/modules/rbac/actions", () => ({
  setMemberExtendedRole: () => Promise.resolve({ data: { ok: true } }),
}))

beforeEach(() => {
  if (typeof window === "undefined") return
  Object.defineProperty(Element.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  })
})

describe("MembersList role picker (Push 2c.5.1)", () => {
  it("shows the 5 internal roles, NOT 'Client'", () => {
    render(
      <MembersList
        members={[
          {
            id: "m-target",
            role: "member",
            extendedRole: "user",
            user: { id: "u-target", name: "Target User", email: "target@example.com" },
          },
        ]}
        currentUserId="u-admin"
        currentUserRole="owner"
      />,
    )
    const select = screen.getByRole("combobox", { name: /Role for Target User/i })
    const optionTexts = Array.from(select.querySelectorAll("option")).map((o) => o.textContent)
    expect(optionTexts).toEqual(["Owner", "Admin", "Manager", "User", "Accountant"])
    expect(optionTexts).not.toContain("Client")
  })

  it("does not render the picker when the current user lacks manage permission", () => {
    render(
      <MembersList
        members={[
          {
            id: "m-other",
            role: "member",
            extendedRole: "user",
            user: { id: "u-other", name: "Other User", email: "other@example.com" },
          },
        ]}
        currentUserId="u-self"
        currentUserRole="user"
      />,
    )
    // The picker is gated by canManage = owner|admin — for a "user"
    // viewing role no select renders at all.
    expect(screen.queryByRole("combobox")).toBeNull()
  })

  it("does not render the picker for the current user's own row", () => {
    render(
      <MembersList
        members={[
          {
            id: "m-self",
            role: "admin",
            extendedRole: "admin",
            user: { id: "u-self", name: "Self", email: "self@example.com" },
          },
        ]}
        currentUserId="u-self"
        currentUserRole="owner"
      />,
    )
    // Self-row guard: admins can't change their own role here.
    expect(screen.queryByRole("combobox")).toBeNull()
  })

  it("does not render the picker for an owner row (owners can't be re-roled here)", () => {
    render(
      <MembersList
        members={[
          {
            id: "m-owner",
            role: "owner",
            extendedRole: "owner",
            user: { id: "u-owner", name: "Owner Person", email: "owner@example.com" },
          },
        ]}
        currentUserId="u-self"
        currentUserRole="admin"
      />,
    )
    expect(screen.queryByRole("combobox")).toBeNull()
  })
})
