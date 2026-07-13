"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Settings } from "lucide-react"
import { Modal } from "@/components/ui/modal"
import { Popover } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * Push 3 (C6c polish #5 Fix 4a) — right sidebar.
 *
 * Polish #5 unified the 4 sections into ONE outer bordered card with
 * `divide-y` between sections. Each section header now ships a count
 * and a real "+ Add" button (real or placeholder, per the section's
 * V1 backing).
 *
 * Sections, in order:
 *   - Associations (real — live count from association loader)
 *   - Events (P6 placeholder)
 *   - Financials (P11 placeholder)
 *   - Files (P11 placeholder)
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
    <aside
      className="divide-y divide-[var(--color-border)] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] lg:h-full"
      data-testid="contact-detail-right"
    >
      <CollapsibleSection
        title="Associations"
        count={associations.length}
        defaultOpen
        addModal={{
          title: "Add association",
          body: "Association management ships with the Companies module in Push 9. Until then, link companies to contacts via the contact edit form.",
        }}
      >
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

      <CollapsibleSection
        title="Events"
        count={0}
        addModal={{
          title: "Add event",
          body: "Events ship in Push 6. Bookings and inquiries linked to this contact land here once the Events module ships.",
        }}
      >
        {hasEventsModule ? null : (
          <IntentionalEmpty
            title="Events arrive in Push 6"
            body="Bookings and inquiries linked to this contact land here once the Events module ships."
          />
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Financials"
        count={0}
        addModal={{
          title: "Add financial record",
          body: "Stripe-backed invoicing + payment tracking ship in Push 11. Adding charges, refunds, and credits from this surface lands then.",
        }}
      >
        <IntentionalEmpty
          title="Invoices and payments arrive in Push 11"
          body="Stripe-backed invoicing + payment tracking surface here once the Finance module ships."
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="Files"
        count={0}
        addModal={{
          title: "Add file",
          body: "Files attach to a contact in Push 11 (Finance + Files surface). The blob upload pipeline already exists — once the file → contact join lands, uploads land here.",
        }}
      >
        <IntentionalEmpty
          title="File uploads coming soon"
          body="Contracts, mood boards, and asset deliveries attach here once the Files module ships."
        />
      </CollapsibleSection>
    </aside>
  )
}

function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  addModal,
  children,
}: {
  title: string
  /** V1 visible count next to the title. Zero shows muted "(0)". */
  count: number
  defaultOpen?: boolean
  /** "+ Add" click opens a placeholder modal with this title + body.
   *  Real wiring (e.g. company association picker for Associations)
   *  lands when the relevant module ships. */
  addModal: { title: string; body: string }
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [addOpen, setAddOpen] = useState(false)
  return (
    <section data-testid={`contact-detail-right-section-${title.toLowerCase()}`}>
      <header className="flex items-center gap-1 px-2 py-2">
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
          className="flex flex-1 items-center gap-1 rounded-sm py-0.5 text-left text-sm font-medium hover:bg-[var(--state-hover)]"
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
          <span className="text-xs text-[var(--color-muted-foreground)]">({count})</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setAddOpen(true)
          }}
          className="px-1 text-xs font-medium text-[var(--color-primary)] hover:underline"
          data-testid={`add-${title.toLowerCase()}`}
        >
          + Add
        </button>
        <Popover
          align="end"
          trigger={({ toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-label={`${title} actions`}
              className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--state-hover)]"
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
          className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--state-hover)]"
          title={`${title} settings — ships with the linked module.`}
        >
          <Settings className="size-3.5" aria-hidden="true" />
        </button>
      </header>
      {open && <div className="px-3 py-3">{children}</div>}

      <Modal
        open={addOpen}
        onClose={() => {
          setAddOpen(false)
        }}
        title={addModal.title}
      >
        <p className="text-sm text-[var(--color-muted-foreground)]">{addModal.body}</p>
      </Modal>
    </section>
  )
}

/**
 * "Everything intentional" empty state. Polish #5 dropped the
 * `withAddButton` variant — the section header now owns the "+ Add"
 * affordance, so the body just renders the title + explanatory
 * sentence.
 */
function IntentionalEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className={cn("space-y-2 text-xs")}>
      <p className="font-medium text-[var(--color-foreground)]">{title}</p>
      <p className="text-[var(--color-muted-foreground)]">{body}</p>
    </div>
  )
}
