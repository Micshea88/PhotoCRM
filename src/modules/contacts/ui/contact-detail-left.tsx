"use client"

import { User as UserIcon } from "lucide-react"
import { InlineEditField } from "@/components/ui/inline-edit-field"
import { InlineEditSelect } from "@/components/ui/inline-edit-select"
import { CompanyPicker, type CompanyOption } from "@/modules/companies/ui/company-picker"
import { UserRefPicker, type UserOption } from "@/modules/custom-fields/ui/user-ref-picker"
import { formatPhoneDisplay, parsePhoneInput } from "@/lib/format/phone"
import { updateContact } from "@/modules/contacts/actions"
import { CONTACT_TYPES, LIFECYCLE_STATUSES } from "@/modules/contacts/types"
import { LeadSourceCombobox } from "./lead-source-combobox"
import { ActionIconRow } from "./action-icon-row"

/**
 * Push 3 (C6c polish) — unified left card on the desktop detail page.
 *
 * One box with internal border-bottom dividers between four blocks:
 *   1. Identity      — name (inline edit) + company subtext
 *   2. Action row    — 6 circular icon buttons (see ActionIconRow)
 *   3. Contact info  — email + phone (inline edit)
 *   4. About         — type / lifecycle / lead source / owner /
 *                       company (all inline-edit via InlineEditSelect)
 *
 * Architectural rule (locked in this commit): every editable field in
 * Pathway uses the inline-edit pattern. When a new field ships in any
 * future module, it ships with inline editing by default — not a
 * read-only row.
 *
 * Phone format: display via formatPhoneDisplay; the input accepts any
 * variant (parens, dashes, raw); save normalizes to digits-only via
 * parsePhoneInput. Validation rejects non-10-digit US numbers inline.
 */
export interface ContactDetailLeftProps {
  contact: {
    id: string
    firstName: string
    lastName: string
    primaryEmail: string | null
    primaryPhone: string | null
    contactType: string | null
    lifecycleStatus: string | null
    leadSource: string | null
    ownerUserId: string | null
    companyId: string | null
  }
  owner: { name: string | null; email: string } | null
  companyName: string | null
  /** P3 (C6c polish) — option lists for the About-section pickers.
   *  Server loader passes these alongside the contact. */
  ownerOptions: UserOption[]
  companyOptions: CompanyOption[]
  leadSourceValues: string[]
  hiddenLeadSources: string[]
}

export function ContactDetailLeft({
  contact,
  owner,
  companyName,
  ownerOptions,
  companyOptions,
  leadSourceValues,
  hiddenLeadSources,
}: ContactDetailLeftProps) {
  // Common dedup-conflict → inline error mapping for updateContact.
  async function callUpdate(
    patch: Parameters<typeof updateContact>[0],
  ): Promise<{ error?: string } | undefined> {
    const result = await updateContact(patch)
    if (result.serverError) return { error: result.serverError }
    const data = result.data
    if (data && "dedupConflict" in data) {
      return {
        error: "Duplicate of an existing contact — change the value or open the matched contact.",
      }
    }
    return undefined
  }

  function saveText(field: "firstName" | "lastName") {
    return async (next: string): Promise<{ error?: string } | undefined> => {
      const value = next.trim()
      if (!value) {
        return { error: `${field === "firstName" ? "First" : "Last"} name can't be empty.` }
      }
      return field === "firstName"
        ? callUpdate({ id: contact.id, firstName: value })
        : callUpdate({ id: contact.id, lastName: value })
    }
  }

  async function saveEmail(next: string): Promise<{ error?: string } | undefined> {
    const value = next.trim() === "" ? "" : next.trim()
    return callUpdate({ id: contact.id, primaryEmail: value })
  }

  async function savePhone(next: string): Promise<{ error?: string } | undefined> {
    // next is already digits-only (normalizeOnSave ran).
    return callUpdate({ id: contact.id, primaryPhone: next })
  }

  function saveSelect(
    field: "contactType" | "lifecycleStatus" | "leadSource" | "ownerUserId" | "companyId",
  ) {
    return async (next: string | null): Promise<{ error?: string } | undefined> => {
      const v = next ?? null
      switch (field) {
        case "contactType":
          return callUpdate({
            id: contact.id,
            contactType: (v ?? undefined) as Parameters<typeof updateContact>[0]["contactType"],
          })
        case "lifecycleStatus":
          return callUpdate({
            id: contact.id,
            lifecycleStatus: (v ?? undefined) as Parameters<
              typeof updateContact
            >[0]["lifecycleStatus"],
          })
        case "leadSource":
          return callUpdate({ id: contact.id, leadSource: v ?? undefined })
        case "ownerUserId":
          return callUpdate({ id: contact.id, ownerUserId: v })
        case "companyId":
          return callUpdate({ id: contact.id, companyId: v })
      }
    }
  }

  return (
    <aside className="space-y-4">
      <section
        className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]"
        data-testid="contact-detail-left-card"
      >
        {/* 1. Identity */}
        <div className="space-y-2 p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
              <UserIcon className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex gap-1">
                <InlineEditField
                  value={contact.firstName}
                  onSave={saveText("firstName")}
                  ariaLabel="First name"
                  className="font-semibold"
                />
                <InlineEditField
                  value={contact.lastName}
                  onSave={saveText("lastName")}
                  ariaLabel="Last name"
                  className="font-semibold"
                />
              </div>
              {companyName && (
                <p className="text-xs text-[var(--color-muted-foreground)]">{companyName}</p>
              )}
            </div>
          </div>
        </div>

        {/* 2. Action icon row */}
        <div className="border-t border-[var(--color-border)] px-2 py-3">
          <ActionIconRow
            contactId={contact.id}
            primaryEmail={contact.primaryEmail}
            primaryPhone={contact.primaryPhone}
          />
        </div>

        {/* 3. Contact info */}
        <div className="space-y-2 border-t border-[var(--color-border)] p-4 text-sm">
          <FieldLabel>Email</FieldLabel>
          <InlineEditField
            value={contact.primaryEmail}
            onSave={saveEmail}
            type="email"
            ariaLabel="Primary email"
          />
          <FieldLabel>Phone</FieldLabel>
          <InlineEditField
            value={contact.primaryPhone}
            displayValue={formatPhoneDisplay(contact.primaryPhone)}
            editValue={formatPhoneDisplay(contact.primaryPhone)}
            onSave={savePhone}
            normalizeOnSave={(raw) => parsePhoneInput(raw) ?? ""}
            validateBeforeSave={(normalized) => {
              if (normalized === "") return null
              return normalized.length === 10
                ? null
                : "Enter a 10-digit US phone (e.g. (555) 123-4567)."
            }}
            type="tel"
            placeholder="No phone"
            ariaLabel="Primary phone"
          />
        </div>

        {/* 4. About */}
        <div
          className="space-y-2 border-t border-[var(--color-border)] p-4 text-sm"
          data-testid="contact-detail-left-about"
        >
          <h2 className="text-xs font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">
            About
          </h2>
          <AboutRow label="Type">
            <InlineEditSelect
              value={contact.contactType}
              displayLabel={contact.contactType}
              items={CONTACT_TYPES.map((t) => ({ value: t, label: t }))}
              onSave={saveSelect("contactType")}
              ariaLabel="Contact type"
              allowClear
            />
          </AboutRow>
          <AboutRow label="Lifecycle">
            <InlineEditSelect
              value={contact.lifecycleStatus}
              displayLabel={contact.lifecycleStatus}
              items={LIFECYCLE_STATUSES.map((s) => ({ value: s, label: s }))}
              onSave={saveSelect("lifecycleStatus")}
              ariaLabel="Lifecycle status"
              allowClear
            />
          </AboutRow>
          <AboutRow label="Lead source">
            <InlineEditSelect
              value={contact.leadSource}
              displayLabel={contact.leadSource}
              onSave={saveSelect("leadSource")}
              ariaLabel="Lead source"
              renderPicker={({ commit }) => (
                <LeadSourceCombobox
                  value={contact.leadSource ?? ""}
                  onChange={(v) => {
                    void commit(v === "" ? null : v)
                  }}
                  existingValues={leadSourceValues}
                  hiddenSources={hiddenLeadSources}
                />
              )}
            />
          </AboutRow>
          <AboutRow label="Owner">
            <InlineEditSelect
              value={contact.ownerUserId}
              displayLabel={owner?.name ?? owner?.email ?? null}
              onSave={saveSelect("ownerUserId")}
              ariaLabel="Owner"
              renderPicker={({ commit }) => (
                <UserRefPicker
                  options={ownerOptions}
                  value={contact.ownerUserId}
                  onChange={(v) => {
                    void commit(v)
                  }}
                />
              )}
            />
          </AboutRow>
          <AboutRow label="Company">
            <InlineEditSelect
              value={contact.companyId}
              displayLabel={companyName}
              onSave={saveSelect("companyId")}
              ariaLabel="Primary company"
              renderPicker={({ commit }) => (
                <CompanyPicker
                  options={companyOptions}
                  value={contact.companyId}
                  onChange={(v) => {
                    void commit(v)
                  }}
                />
              )}
            />
          </AboutRow>
        </div>
      </section>
    </aside>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-medium text-[var(--color-muted-foreground)]">{children}</p>
}

function AboutRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-center gap-2 text-xs">
      <span className="text-[var(--color-muted-foreground)]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
