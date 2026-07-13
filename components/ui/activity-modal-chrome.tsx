"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronDown, ChevronUp, GripHorizontal, Maximize2, Minimize2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  AssociationsPicker,
  type AssociationOption,
  type AssociationsDraft,
} from "./associations-picker"

export type { AssociationsDraft, AssociationOption }

/**
 * Push 3 (C6c polish #4) — shared chrome for activity-logging modals.
 *
 * HubSpot pattern. Every Log X / Add Note modal renders this shell:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ [▼]  Title       [grip]     [⤢ expand]  [✕ close]        │
 *   ├──────────────────────────────────────────────────────────┤
 *   │   ... body ...                                            │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Controls (left to right):
 *   - Collapse chevron — minimizes the modal to a small bar at the
 *     bottom of the screen. Body hidden; clicking the chevron again
 *     restores. Lets a long note coexist with other navigation
 *     (HubSpot's "work continues elsewhere" pattern).
 *   - Title.
 *   - Drag grip — visual affordance only in V1. Full drag-to-move
 *     ships in V1.5 polish.
 *   - Expand / Restore — toggles a larger viewport-filling variant.
 *   - Close — fires `onClose`. The host owns the unsaved-changes
 *     confirm decision.
 *
 * Docs: pathway-design-system.md §9 "Activity logging modals".
 */
export interface ChromeState {
  collapsed: boolean
  expanded: boolean
}

export function ActivityModalChrome({
  open,
  onClose,
  title,
  children,
  footer,
  /** Optional close-guard. Return false to block close (e.g. unsaved
   *  changes confirm). Defaults to always allow. */
  onBeforeClose,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  onBeforeClose?: () => boolean
}) {
  const [state, setState] = useState<ChromeState>({ collapsed: false, expanded: false })

  // Esc dismisses (subject to onBeforeClose). Same convention as Modal.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      if (state.collapsed) return // Esc ignored while collapsed; user must restore first
      if (onBeforeClose && !onBeforeClose()) return
      onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
    }
  }, [open, state.collapsed, onBeforeClose, onClose])

  if (!open) return null

  function handleClose() {
    if (onBeforeClose && !onBeforeClose()) return
    onClose()
  }

  // Collapsed: floating pill at bottom-right. Body hidden.
  if (state.collapsed) {
    return (
      <div
        className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 shadow-lg"
        role="dialog"
        aria-label={`${title} (collapsed)`}
        data-testid="activity-modal-collapsed"
      >
        <button
          type="button"
          onClick={() => {
            setState((s) => ({ ...s, collapsed: false }))
          }}
          aria-label="Restore modal"
          className="inline-flex size-6 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40"
        >
          <ChevronUp className="size-4" aria-hidden="true" />
        </button>
        <span className="text-sm font-medium">{title}</span>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close modal"
          className="inline-flex size-6 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    )
  }

  // Full / expanded view. Expanded = wider + taller; default = ~520px wide.
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div
        className={cn(
          "flex max-h-[90vh] flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-xl",
          state.expanded ? "w-[min(960px,95vw)]" : "w-[min(560px,95vw)]",
        )}
        data-testid="activity-modal"
      >
        <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <button
            type="button"
            onClick={() => {
              setState((s) => ({ ...s, collapsed: true }))
            }}
            aria-label="Collapse modal"
            className="inline-flex size-7 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40"
            data-testid="activity-modal-collapse"
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </button>
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="flex flex-1 justify-center text-[var(--color-muted-foreground)]/40">
            <GripHorizontal className="size-4" aria-hidden="true" />
          </div>
          <button
            type="button"
            onClick={() => {
              setState((s) => ({ ...s, expanded: !s.expanded }))
            }}
            aria-label={state.expanded ? "Restore size" : "Expand modal"}
            className="inline-flex size-7 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40"
          >
            {state.expanded ? (
              <Minimize2 className="size-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="size-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close modal"
            className="inline-flex size-7 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40"
            data-testid="activity-modal-close"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && (
          <footer className="border-t border-[var(--color-border)] px-4 py-3">{footer}</footer>
        )}
      </div>
    </div>
  )
}

/**
 * Shared "For: [Contact pill]" sub-component used by every activity
 * modal. Polish #5 Fix 5a — rendered as a non-navigable chip (no
 * link, no onClick). Activity modals already live on the contact's
 * detail page; navigation would close the modal mid-edit which is
 * disorienting.
 *
 * Accepts an unused `contactId` param (still passed by every caller)
 * so the API stays consistent if multi-record associations later
 * need to render per-record links.
 */
export function ContactPill({ contactId, label }: { contactId: string; label: string }) {
  void contactId
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-muted)] px-2 py-0.5 text-xs font-medium"
      data-testid="contact-pill"
    >
      {label}
    </span>
  )
}

/**
 * Shared "Associated with N record(s)" expandable section. Polish #5
 * Fix 5b — added the "+ Add association" button that opens the
 * `AssociationsPicker` (HubSpot rail + checkbox list). Multi-record
 * persistence still depends on Push 3.5+ schema work; the picker
 * shows the warning footer when the user picks beyond primary.
 *
 * The host modal owns the draft state and passes initial pills +
 * onChange. AssociationsSection itself stays presentational.
 */
export function AssociationsSection({
  contactId,
  contactLabel,
  draft,
  onChange,
  contactOptions = [],
  companyOptions = [],
}: {
  contactId: string
  contactLabel: string
  /** Current draft state. If omitted, defaults to "primary contact
   *  only" — the section still renders the pill but the "+ Add
   *  association" button is hidden. */
  draft?: AssociationsDraft
  onChange?: (next: AssociationsDraft) => void
  contactOptions?: AssociationOption[]
  companyOptions?: AssociationOption[]
}) {
  const [open, setOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const addRef = useRef<HTMLButtonElement | null>(null)
  const labelLookup = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of contactOptions) m.set(o.id, o.label)
    for (const o of companyOptions) m.set(o.id, o.label)
    m.set(contactId, contactLabel)
    return m
  }, [contactOptions, companyOptions, contactId, contactLabel])

  const allContacts = draft?.contactIds ?? [contactId]
  const extraContacts = allContacts.filter((id) => id !== contactId)
  const companies = draft?.companyIds ?? []
  const totalCount = 1 + extraContacts.length + companies.length

  const canEdit = !!draft && !!onChange

  return (
    <section className="space-y-1.5 rounded-md border border-[var(--color-border)] p-2 text-xs">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded text-left"
      >
        <span className="font-medium">
          Associated with {totalCount} record{totalCount === 1 ? "" : "s"}
        </span>
        <span className="text-[var(--color-muted-foreground)]">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center gap-1">
            <ContactPill contactId={contactId} label={contactLabel} />
            {extraContacts.map((id) => (
              <ContactPill key={id} contactId={id} label={labelLookup.get(id) ?? id} />
            ))}
            {companies.map((id) => (
              <ContactPill key={id} contactId={id} label={labelLookup.get(id) ?? id} />
            ))}
            {canEdit && (
              <button
                ref={addRef}
                type="button"
                onClick={() => {
                  setPickerOpen(true)
                }}
                data-testid="add-association"
                className="text-2xs ml-1 rounded border border-dashed border-[var(--color-border)] px-2 py-0.5 text-[var(--color-primary)] hover:bg-[var(--color-accent)]/30"
              >
                + Add association
              </button>
            )}
          </div>
          {(extraContacts.length > 0 || companies.length > 0) && (
            <p className="text-[var(--color-muted-foreground)]">
              Multi-record associations ship in Push 3.5+. Only the primary contact persists in this
              version.
            </p>
          )}
        </div>
      )}
      {draft && onChange && (
        <AssociationsPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          draft={draft}
          onChange={onChange}
          contactOptions={contactOptions}
          companyOptions={companyOptions}
          primaryContactId={contactId}
          triggerRef={addRef}
        />
      )}
    </section>
  )
}

/**
 * Shared "Follow-up task" affordance. V1 ships disabled because
 * tasks are project-scoped today and contact-only tasks land with
 * Push 7. The UI is fully designed so future-wiring is one-line.
 */
export function FollowUpTaskAffordance() {
  return (
    <div className="space-y-1 rounded-md border border-[var(--color-border)] p-2 text-xs">
      <label
        className="flex cursor-not-allowed items-center gap-2 opacity-60"
        title="Contact-scoped tasks ship in Push 7."
      >
        <input type="checkbox" disabled />
        <span>Create a To-do task to follow up</span>
        <select
          disabled
          className="ml-auto rounded border border-[var(--color-border)] bg-transparent px-1 py-0.5 text-xs"
          aria-label="Follow-up date"
        >
          <option>In 2 business days</option>
          <option>In 3 business days</option>
          <option>In 1 week</option>
          <option>In 2 weeks</option>
          <option>In 1 month</option>
          <option>In 3 months</option>
        </select>
      </label>
      <p className="text-3xs text-[var(--color-muted-foreground)]">
        Contact-scoped follow-up tasks ship in Push 7.
      </p>
    </div>
  )
}
