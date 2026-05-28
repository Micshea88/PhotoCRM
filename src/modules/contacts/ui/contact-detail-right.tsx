"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Push 3 (C6c) — right sidebar with 4 collapsible sections.
 *
 * Per autonomous default G, Financials + Files render "Coming soon"
 * placeholders (no data fetch in V1). Associations (companies) +
 * Events sections render real content.
 *
 * Each section header toggles a chevron + collapses the body. Initial
 * state: all expanded so the user sees what's available on first
 * load.
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
          <EmptyHint>No linked companies yet.</EmptyHint>
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
          <ComingSoon label="Events module ships in Push 6 — bookings + inquiries land here." />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Financials">
        <ComingSoon label="Invoices and payments coming in Phase 11." withAddButton />
      </CollapsibleSection>

      <CollapsibleSection title="Files">
        <ComingSoon label="File uploads coming soon." withAddButton />
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
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        className="flex w-full items-center gap-1 rounded-t-lg px-3 py-2 text-left text-sm font-medium hover:bg-[var(--color-accent)]/20"
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
      {open && <div className="border-t border-[var(--color-border)] px-3 py-3">{children}</div>}
    </section>
  )
}

function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-[var(--color-muted-foreground)]">{children}</p>
}

function ComingSoon({ label, withAddButton = false }: { label: string; withAddButton?: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--color-muted-foreground)]">{label}</p>
      {withAddButton && (
        <button
          type="button"
          disabled
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
