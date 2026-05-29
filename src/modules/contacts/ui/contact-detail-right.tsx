"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Settings } from "lucide-react"
import { Popover } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * Push 3 (C6c polish) — right sidebar.
 *
 * HubSpot box pattern per section:
 *   - Header row: drag handle (visual placeholder for reorder, not
 *     interactive in V1), chevron, title, Actions dropdown, gear icon
 *   - Content area with proper padding
 *   - Empty states render intentionally (per the "Everything
 *     intentional" principle locked in docs/pathway-design-system.md)
 *
 * Sections: Associations (real data), Events (P6 placeholder),
 * Financials (P11 placeholder), Files (V1.5 placeholder).
 *
 * Drag-to-reorder lands in a polish push once we know which sections
 * end up in V1. For now the handle communicates "future affordance"
 * without being interactive — matches the spec's no-grey-empty rule.
 */
export function ContactDetailRight({
  associations,
  hasEventsModule = false,
}: {
  associations: { label: string; sub?: string | null }[]
  /** When P6 Events ships this becomes the real loader's flag. */
  hasEventsModule?: boolean
}) {
  return (
    <aside className="space-y-3" data-testid="contact-detail-right">
      <CollapsibleSection title="Associations" defaultOpen>
        {associations.length === 0 ? (
          <IntentionalEmpty
            title="No companies linked"
            body="Linking a primary or additional company keeps roles and contacts in sync."
          />
        ) : (
          <ul className="space-y-1 text-sm">
            {associations.map((a, idx) => (
              <li key={`${a.label}-${String(idx)}`}>
                <span className="font-medium">{a.label}</span>
                {a.sub && <span className="text-[var(--color-muted-foreground)]"> — {a.sub}</span>}
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Events">
        {hasEventsModule ? null : (
          <IntentionalEmpty
            title="Events arrive in Push 6"
            body="Bookings and inquiries linked to this contact land here once the Events module ships."
          />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Financials">
        <IntentionalEmpty
          title="Invoices and payments arrive in Push 11"
          body="Stripe-backed invoicing + payment tracking surface here once the Finance module ships."
          withAddButton
        />
      </CollapsibleSection>

      <CollapsibleSection title="Files">
        <IntentionalEmpty
          title="File uploads coming soon"
          body="Contracts, mood boards, and asset deliveries attach here once the Files module ships."
          withAddButton
        />
      </CollapsibleSection>
    </aside>
  )
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
      <header className="flex items-center gap-1 border-b border-[var(--color-border)] px-2 py-2">
        <GripVertical
          className="size-3.5 shrink-0 text-[var(--color-muted-foreground)]/50"
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o)
          }}
          aria-expanded={open}
          className="flex flex-1 items-center gap-1 rounded-sm py-0.5 text-left text-sm font-medium hover:bg-[var(--color-accent)]/20"
        >
          {open ? (
            <ChevronDown
              className="size-3.5 text-[var(--color-muted-foreground)]"
              aria-hidden="true"
            />
          ) : (
            <ChevronRight
              className="size-3.5 text-[var(--color-muted-foreground)]"
              aria-hidden="true"
            />
          )}
          <span>{title}</span>
        </button>
        <Popover
          align="end"
          trigger={({ toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-label={`${title} actions`}
              className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/30"
            >
              <MoreHorizontal className="size-3.5" aria-hidden="true" />
            </button>
          )}
        >
          <ul className="min-w-[160px] space-y-0.5 text-sm" role="menu">
            <li className="px-2 py-1 text-xs text-[var(--color-muted-foreground)]">
              Section actions arrive with the linked module.
            </li>
          </ul>
        </Popover>
        <button
          type="button"
          aria-label={`${title} settings`}
          className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/30"
          title={`${title} settings — ships with the linked module.`}
        >
          <Settings className="size-3.5" aria-hidden="true" />
        </button>
      </header>
      {open && <div className="px-3 py-3">{children}</div>}
    </section>
  )
}

/**
 * "Everything intentional" empty state.
 *
 * Every right-sidebar empty state ships polished: a short title, a
 * one-sentence body, and an optional disabled "+ Add" button. Never
 * a barren box with a stale paragraph.
 */
function IntentionalEmpty({
  title,
  body,
  withAddButton = false,
}: {
  title: string
  body: string
  withAddButton?: boolean
}) {
  return (
    <div className="space-y-2 text-xs">
      <p className="font-medium text-[var(--color-foreground)]">{title}</p>
      <p className="text-[var(--color-muted-foreground)]">{body}</p>
      {withAddButton && (
        <button
          type="button"
          disabled
          title="Ships with the linked module."
          className={cn(
            "inline-flex h-7 cursor-not-allowed items-center gap-1 rounded-md border border-[var(--color-border)] px-2 text-xs",
            "text-[var(--color-muted-foreground)] opacity-50",
          )}
        >
          + Add
        </button>
      )}
    </div>
  )
}
