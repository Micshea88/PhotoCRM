"use client"

import { useMemo, useRef, useState } from "react"
import { Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { PickerPortal } from "./picker-portal"

/**
 * Push 3 (C6c polish #5 Fix 5b) — multi-record associations picker.
 *
 * HubSpot pattern: left-rail categories + right pane (search input +
 * checkbox list). Used by every activity logging modal's
 * `AssociationsSection`. The picker portals via PickerPortal so it
 * can escape the modal's overflow.
 *
 * V1 functional scope:
 *   - **Contacts tab** — primary contact persists (single-contact
 *     schemas). Picking ADDITIONAL contacts stages them in the modal
 *     draft state for the future schema migration; a warning surfaces
 *     in the picker footer when more than one contact is picked.
 *   - **Companies tab** — searchable list of org companies. UI shows
 *     chips but does NOT persist (no `*_companies` join exists for
 *     contact_notes / call_log yet).
 *   - **Events tab** — placeholder ("ships in Push 6").
 *   - **Selected tab** — lists the current draft selection across
 *     categories.
 *
 * Wiring contract: the host modal owns the AssociationsDraft state.
 * Picker takes the current draft + an onChange callback. The modal's
 * Create button is what saves; closing the picker doesn't save.
 */

export interface AssociationsDraft {
  contactIds: string[]
  companyIds: string[]
  eventIds: string[]
}

export interface AssociationOption {
  id: string
  label: string
  /** Optional secondary line (email for contacts, role for companies). */
  sub?: string | null
}

type Category = "selected" | "contacts" | "companies" | "events"

export function AssociationsPicker({
  open,
  onOpenChange,
  draft,
  onChange,
  contactOptions,
  companyOptions,
  /** Primary contact id — locked as always-selected in V1 (single-
   *  contact schemas). Renders with a disabled checkbox. */
  primaryContactId,
  triggerRef,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: AssociationsDraft
  onChange: (next: AssociationsDraft) => void
  contactOptions: AssociationOption[]
  companyOptions: AssociationOption[]
  primaryContactId: string
  triggerRef: React.RefObject<HTMLElement | null>
}) {
  const [category, setCategory] = useState<Category>("contacts")
  const [query, setQuery] = useState("")
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Selected counts for the rail.
  const selectedCount = draft.contactIds.length + draft.companyIds.length + draft.eventIds.length

  // Filtered options for the active category.
  const filteredContacts = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return contactOptions
    return contactOptions.filter((o) => o.label.toLowerCase().includes(q))
  }, [contactOptions, query])

  const filteredCompanies = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return companyOptions
    return companyOptions.filter((o) => o.label.toLowerCase().includes(q))
  }, [companyOptions, query])

  function toggleContact(id: string) {
    if (id === primaryContactId) return // locked
    const present = draft.contactIds.includes(id)
    onChange({
      ...draft,
      contactIds: present ? draft.contactIds.filter((x) => x !== id) : [...draft.contactIds, id],
    })
  }
  function toggleCompany(id: string) {
    const present = draft.companyIds.includes(id)
    onChange({
      ...draft,
      companyIds: present ? draft.companyIds.filter((x) => x !== id) : [...draft.companyIds, id],
    })
  }

  const extraContacts = draft.contactIds.filter((id) => id !== primaryContactId).length
  const showMultiContactWarn = extraContacts > 0
  const showCompanyWarn = draft.companyIds.length > 0

  return (
    <PickerPortal triggerRef={triggerRef} open={open} panelRef={panelRef} minWidth={560}>
      <div className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-background)] shadow-xl">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
          <h3 className="text-sm font-semibold">Manage associations</h3>
          <button
            type="button"
            aria-label="Close picker"
            onClick={() => {
              onOpenChange(false)
            }}
            className="rounded p-0.5 text-[var(--color-muted-foreground)] hover:bg-[var(--state-hover)]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex max-h-[400px]">
          {/* Left rail */}
          <ul
            role="tablist"
            aria-label="Association categories"
            className="w-32 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-muted)]/30 py-2 text-sm"
          >
            <CategoryTab
              category="selected"
              label="Selected"
              count={selectedCount}
              active={category === "selected"}
              onClick={() => {
                setCategory("selected")
              }}
            />
            <CategoryTab
              category="contacts"
              label="Contacts"
              count={contactOptions.length}
              active={category === "contacts"}
              onClick={() => {
                setCategory("contacts")
              }}
            />
            <CategoryTab
              category="companies"
              label="Companies"
              count={companyOptions.length}
              active={category === "companies"}
              onClick={() => {
                setCategory("companies")
              }}
            />
            <CategoryTab
              category="events"
              label="Events"
              count={0}
              active={category === "events"}
              onClick={() => {
                setCategory("events")
              }}
            />
          </ul>

          {/* Right pane */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {category !== "events" && category !== "selected" && (
              <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
                <Search
                  className="size-3.5 shrink-0 text-[var(--color-muted-foreground)]"
                  aria-hidden="true"
                />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                  }}
                  placeholder={`Search ${category}…`}
                  aria-label={`Search ${category}`}
                  className="h-7 w-full border-0 bg-transparent text-sm outline-none"
                />
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-1 py-1">
              {category === "selected" && (
                <SelectedList
                  draft={draft}
                  contactOptions={contactOptions}
                  companyOptions={companyOptions}
                  primaryContactId={primaryContactId}
                  onToggleContact={toggleContact}
                  onToggleCompany={toggleCompany}
                />
              )}
              {category === "contacts" && (
                <CheckboxList
                  options={filteredContacts}
                  selected={new Set(draft.contactIds)}
                  primaryId={primaryContactId}
                  onToggle={toggleContact}
                  emptyMessage="No contacts match"
                  testIdPrefix="contact"
                />
              )}
              {category === "companies" && (
                <CheckboxList
                  options={filteredCompanies}
                  selected={new Set(draft.companyIds)}
                  onToggle={toggleCompany}
                  emptyMessage="No companies match"
                  testIdPrefix="company"
                />
              )}
              {category === "events" && (
                <p className="px-3 py-6 text-center text-xs text-[var(--color-muted-foreground)]">
                  Events ship in Push 6. Once the Events module lands, you&apos;ll be able to
                  associate an activity with one or more events here.
                </p>
              )}
            </div>
          </div>
        </div>

        <footer className="space-y-2 border-t border-[var(--color-border)] px-3 py-2">
          {(showMultiContactWarn || showCompanyWarn) && (
            <p className="text-2xs text-[var(--color-warning)]">
              Multi-record associations ship in Push 3.5+. Selections beyond the primary contact
              will not save in this version.
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false)
              }}
              data-testid="associations-picker-done"
              className="rounded-md bg-[var(--color-primary)] px-3 py-1 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90"
            >
              Done
            </button>
          </div>
        </footer>
      </div>
    </PickerPortal>
  )
}

function CategoryTab({
  category,
  label,
  count,
  active,
  onClick,
}: {
  category: Category
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onClick}
        data-testid={`associations-picker-tab-${category}`}
        className={cn(
          "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs",
          active
            ? "bg-[var(--color-background)] font-medium text-[var(--color-foreground)]"
            : "text-[var(--color-muted-foreground)] hover:bg-[var(--state-hover)]",
        )}
      >
        <span>{label}</span>
        <span className="text-3xs opacity-70">{String(count)}</span>
      </button>
    </li>
  )
}

function CheckboxList({
  options,
  selected,
  primaryId,
  onToggle,
  emptyMessage,
  testIdPrefix,
}: {
  options: AssociationOption[]
  selected: Set<string>
  primaryId?: string
  onToggle: (id: string) => void
  emptyMessage: string
  testIdPrefix: string
}) {
  if (options.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-[var(--color-muted-foreground)]">
        {emptyMessage}
      </p>
    )
  }
  return (
    <ul className="space-y-0.5">
      {options.map((o) => {
        const isPrimary = primaryId === o.id
        const isChecked = selected.has(o.id) || isPrimary
        return (
          <li key={o.id}>
            <label
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm",
                "hover:bg-[var(--state-hover)] active:bg-[var(--state-active)]",
                isPrimary && "cursor-not-allowed opacity-80",
              )}
            >
              <input
                type="checkbox"
                checked={isChecked}
                disabled={isPrimary}
                onChange={() => {
                  onToggle(o.id)
                }}
                aria-label={o.label}
                data-testid={`${testIdPrefix}-${o.id}`}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{o.label}</span>
                {o.sub && (
                  <span className="text-2xs block truncate text-[var(--color-muted-foreground)]">
                    {o.sub}
                  </span>
                )}
                {isPrimary && (
                  <span className="text-3xs block text-[var(--color-muted-foreground)]/80">
                    Primary — locked
                  </span>
                )}
              </span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

function SelectedList({
  draft,
  contactOptions,
  companyOptions,
  primaryContactId,
  onToggleContact,
  onToggleCompany,
}: {
  draft: AssociationsDraft
  contactOptions: AssociationOption[]
  companyOptions: AssociationOption[]
  primaryContactId: string
  onToggleContact: (id: string) => void
  onToggleCompany: (id: string) => void
}) {
  const selectedContacts = contactOptions.filter(
    (o) => draft.contactIds.includes(o.id) || o.id === primaryContactId,
  )
  const selectedCompanies = companyOptions.filter((o) => draft.companyIds.includes(o.id))
  const isEmpty = selectedContacts.length === 0 && selectedCompanies.length === 0
  if (isEmpty) {
    return (
      <p className="px-3 py-6 text-center text-xs text-[var(--color-muted-foreground)]">
        No selections yet — use the Contacts / Companies tabs.
      </p>
    )
  }
  return (
    <div className="space-y-2 px-1 py-1">
      {selectedContacts.length > 0 && (
        <div>
          <p className="text-3xs px-2 py-1 font-medium tracking-wide text-[var(--color-muted-foreground)] uppercase">
            Contacts
          </p>
          <CheckboxList
            options={selectedContacts}
            selected={new Set(draft.contactIds)}
            primaryId={primaryContactId}
            onToggle={onToggleContact}
            emptyMessage="—"
            testIdPrefix="selected-contact"
          />
        </div>
      )}
      {selectedCompanies.length > 0 && (
        <div>
          <p className="text-3xs px-2 py-1 font-medium tracking-wide text-[var(--color-muted-foreground)] uppercase">
            Companies
          </p>
          <CheckboxList
            options={selectedCompanies}
            selected={new Set(draft.companyIds)}
            onToggle={onToggleCompany}
            emptyMessage="—"
            testIdPrefix="selected-company"
          />
        </div>
      )}
    </div>
  )
}
