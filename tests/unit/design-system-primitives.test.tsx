/**
 * Design-system shared primitives — Badge / Skeleton / EmptyState / CommitBar.
 *
 * These pin the canonical output so the drift they retire can't creep back:
 * one badge padding/font, tint-bg + saturated-fg per variant, a content-shaped
 * skeleton, a real EmptyState CTA, and the token-driven CommitBar spacing.
 * Per AGENTS.md LAW 7 the assertions check the OBSERVABLE result (rendered
 * classes / inline style / text), not internal state.
 */

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { CommitBar } from "@/components/ui/commit-bar"

describe("Badge", () => {
  it("category variant uses a MUTED-TINT bg + the full category hue as text", () => {
    render(
      <Badge variant="category" category="lead">
        Lead
      </Badge>,
    )
    const el = screen.getByText("Lead")
    expect(el.style.backgroundColor).toBe("var(--color-cat-lead-tint)")
    expect(el.style.color).toBe("var(--color-cat-lead)")
  })

  it("category variant renders a ~3px soft-rectangle corner (not full-round)", () => {
    render(
      <Badge variant="category" category="client">
        Client
      </Badge>,
    )
    expect(screen.getByText("Client").className).toContain("rounded-[var(--radius-pill)]")
  })

  it("state variant tints the bg from the state token and keeps the fg saturated", () => {
    render(
      <Badge variant="state" state="destructive">
        Do Not Contact
      </Badge>,
    )
    const el = screen.getByText("Do Not Contact")
    expect(el.style.backgroundColor).toContain("color-mix")
    expect(el.style.backgroundColor).toContain("var(--color-destructive)")
    expect(el.style.color).toBe("var(--color-destructive)")
  })

  it("neutral variant (default) uses the muted tokens and no inline color", () => {
    render(<Badge>Vendor</Badge>)
    const el = screen.getByText("Vendor")
    expect(el.className).toContain("bg-[var(--color-muted)]")
    expect(el.className).toContain("text-[var(--color-muted-foreground)]")
    expect(el.style.backgroundColor).toBe("")
  })

  it("every variant shares the one canonical padding + font + shape", () => {
    render(<Badge>Neutral</Badge>)
    const el = screen.getByText("Neutral")
    for (const cls of [
      "rounded-[var(--radius-pill)]",
      "px-2",
      "py-0.5",
      "text-2xs",
      "font-medium",
    ]) {
      expect(el.className).toContain(cls)
    }
  })
})

describe("Skeleton", () => {
  it("is decorative and pulses only when motion is allowed", () => {
    const { container } = render(<Skeleton className="h-4 w-24" />)
    const el = container.firstElementChild as HTMLElement
    expect(el.getAttribute("aria-hidden")).toBe("true")
    expect(el.className).toContain("motion-safe:animate-pulse")
    expect(el.className).toContain("h-4")
    expect(el.className).toContain("w-24")
  })
})

describe("EmptyState", () => {
  it("renders a title, a supporting line, and a REAL action (not a text hint)", () => {
    render(
      <EmptyState
        icon={<svg data-testid="icon" />}
        title="No contacts yet"
        description="Add your first contact to get started."
        action={<button>New contact</button>}
      />,
    )
    expect(screen.getByText("No contacts yet")).toBeInTheDocument()
    expect(screen.getByText("Add your first contact to get started.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "New contact" })).toBeInTheDocument()
    expect(screen.getByTestId("icon")).toBeInTheDocument()
  })

  it("icon / description / action are optional", () => {
    render(<EmptyState title="Nothing here" />)
    expect(screen.getByText("Nothing here")).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})

describe("CommitBar", () => {
  it("renders its actions and applies the token-driven commit spacing", () => {
    const { container } = render(
      <CommitBar>
        <button>Cancel</button>
        <button>Save</button>
      </CommitBar>,
    )
    const el = container.firstElementChild as HTMLElement
    expect(el.style.marginTop).toBe("var(--space-commit-gap)")
    expect(el.style.marginBottom).toBe("var(--space-commit-bottom)")
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument()
  })
})
