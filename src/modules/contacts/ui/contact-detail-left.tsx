"use client"

import { useEffect, useRef, useState } from "react"
import { User as UserIcon } from "lucide-react"
import { InlineEditField } from "@/components/ui/inline-edit-field"
import { InlineEditSelect } from "@/components/ui/inline-edit-select"
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select"
import { CompanyPicker, type CompanyOption } from "@/modules/companies/ui/company-picker"
import { ContactRefPicker, type ContactOption } from "@/modules/custom-fields/ui/contact-ref-picker"
import { UserRefPicker, type UserOption } from "@/modules/custom-fields/ui/user-ref-picker"
import { US_STATE_CODES } from "@/lib/format/us-states"
import { formatPhoneDisplay, parsePhoneInput } from "@/lib/format/phone"
import { updateContact } from "@/modules/contacts/actions"
import { CONTACT_TYPES, LIFECYCLE_STATUSES } from "@/modules/contacts/types"
import { cn } from "@/lib/utils"
import { LeadSourceCombobox } from "./lead-source-combobox"
import { ActionIconRow } from "./action-icon-row"

/**
 * Push 3 (C6c polish #2) — unified left card.
 *
 * Single box with internal border-bottom dividers between four blocks:
 *   1. Identity      — name (inline edit) + company subtext
 *   2. Action row    — 6 circular icon buttons
 *   3. Contact info  — email + phone (inline edit; phone uses
 *                       display/edit/normalize triple)
 *   4. About         — Type / Lifecycle / Lead source / Owner /
 *                       Company / Tags / Address / Referred by
 *
 * Every About row is inline-editable per the design system rule —
 * a new module that ships a new editable field ships with inline
 * editing by default, never as a read-only row.
 */
export interface ContactMailingAddress {
  street1?: string
  street2?: string
  city?: string
  state?: string
  zip?: string
}

export type ContactDetailPane = "identity" | "actions" | "info" | "about"
const DEFAULT_PANES: ContactDetailPane[] = ["identity", "actions", "info", "about"]

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
    tags: string[]
    mailingAddress: Record<string, unknown> | null
    referredByContactId: string | null
  }
  owner: { name: string | null; email: string } | null
  companyName: string | null
  ownerOptions: UserOption[]
  companyOptions: CompanyOption[]
  leadSourceValues: string[]
  hiddenLeadSources: string[]
  referralOptions: ContactOption[]
  /** Display name of the referred-by contact. Null when none. */
  referredByDisplayName: string | null
  tagOptions: string[]
  /** P3 (C6d) — which blocks to render. Default = all 4 (desktop).
   *  Mobile About tab passes `["info","about"]` so the action row +
   *  identity card don't duplicate the top-of-page header. */
  panes?: ContactDetailPane[]
}

export function ContactDetailLeft({
  contact,
  owner,
  companyName,
  ownerOptions,
  companyOptions,
  leadSourceValues,
  hiddenLeadSources,
  referralOptions,
  referredByDisplayName,
  tagOptions,
  panes = DEFAULT_PANES,
}: ContactDetailLeftProps) {
  const showIdentity = panes.includes("identity")
  const showActions = panes.includes("actions")
  const showInfo = panes.includes("info")
  const showAbout = panes.includes("about")
  // Pre-compute which panes get the top-border divider. The first
  // rendered pane never gets one; subsequent panes always do.
  const order: ("identity" | "actions" | "info" | "about")[] = [
    ...(showIdentity ? (["identity"] as const) : []),
    ...(showActions ? (["actions"] as const) : []),
    ...(showInfo ? (["info"] as const) : []),
    ...(showAbout ? (["about"] as const) : []),
  ]
  const TOP_BORDER = "border-t border-[var(--color-border)]"
  const dividerFor = (key: (typeof order)[number]) => (order.indexOf(key) > 0 ? TOP_BORDER : "")
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
    return callUpdate({ id: contact.id, primaryEmail: next.trim() })
  }

  async function savePhone(next: string): Promise<{ error?: string } | undefined> {
    return callUpdate({ id: contact.id, primaryPhone: next })
  }

  function saveSelect(
    field: "contactType" | "lifecycleStatus" | "leadSource" | "ownerUserId" | "companyId",
  ) {
    return async (next: string | null): Promise<{ error?: string } | undefined> => {
      switch (field) {
        case "contactType":
          return callUpdate({
            id: contact.id,
            contactType: (next ?? undefined) as Parameters<typeof updateContact>[0]["contactType"],
          })
        case "lifecycleStatus":
          return callUpdate({
            id: contact.id,
            lifecycleStatus: (next ?? undefined) as Parameters<
              typeof updateContact
            >[0]["lifecycleStatus"],
          })
        case "leadSource":
          return callUpdate({ id: contact.id, leadSource: next ?? undefined })
        case "ownerUserId":
          return callUpdate({ id: contact.id, ownerUserId: next })
        case "companyId":
          return callUpdate({ id: contact.id, companyId: next })
      }
    }
  }

  async function saveReferredBy(next: string | null): Promise<{ error?: string } | undefined> {
    return callUpdate({ id: contact.id, referredByContactId: next })
  }

  async function saveTags(next: string[]): Promise<{ error?: string } | undefined> {
    return callUpdate({ id: contact.id, tags: next })
  }

  // P3 (C6c polish #3) — Address is rendered as 3 stacked inline-edit
  // lines (Street / City + State / Zip). Each line is its own
  // independent primitive sharing this merge helper, which writes the
  // full mailingAddress jsonb on every save.
  function buildAddressPatch(
    field: keyof ContactMailingAddress,
    value: string | null,
  ): ContactMailingAddress {
    const next: ContactMailingAddress = { ...address }
    const v = (value ?? "").trim()
    switch (field) {
      case "street1":
        if (v) next.street1 = v
        else next.street1 = undefined
        break
      case "street2":
        if (v) next.street2 = v
        else next.street2 = undefined
        break
      case "city":
        if (v) next.city = v
        else next.city = undefined
        break
      case "state":
        if (v) next.state = v.toUpperCase()
        else next.state = undefined
        break
      case "zip":
        if (v) next.zip = v
        else next.zip = undefined
        break
    }
    // Drop undefined keys so the jsonb stays clean.
    const cleaned: ContactMailingAddress = {}
    if (next.street1) cleaned.street1 = next.street1
    if (next.street2) cleaned.street2 = next.street2
    if (next.city) cleaned.city = next.city
    if (next.state) cleaned.state = next.state
    if (next.zip) cleaned.zip = next.zip
    return cleaned
  }
  function saveAddressField(field: keyof ContactMailingAddress) {
    return async (raw: string): Promise<{ error?: string } | undefined> => {
      return callUpdate({
        id: contact.id,
        mailingAddress: buildAddressPatch(field, raw),
      })
    }
  }
  async function saveAddressState(value: string | null): Promise<{ error?: string } | undefined> {
    return callUpdate({
      id: contact.id,
      mailingAddress: buildAddressPatch("state", value),
    })
  }

  const address = (contact.mailingAddress ?? {}) as ContactMailingAddress
  const tagsDisplay = contact.tags.length > 0 ? contact.tags.join(", ") : null

  return (
    <aside className="space-y-4">
      <section
        className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]"
        data-testid="contact-detail-left-card"
      >
        {/* 1. Identity */}
        {showIdentity && (
          <div className={cn("space-y-2 p-4", dividerFor("identity"))}>
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
        )}

        {/* 2. Action icon row */}
        {showActions && (
          <div className={cn("px-2 py-3", dividerFor("actions"))}>
            <ActionIconRow
              contactId={contact.id}
              contactLabel={`${contact.firstName} ${contact.lastName}`.trim() || "Contact"}
              primaryEmail={contact.primaryEmail}
              primaryPhone={contact.primaryPhone}
            />
          </div>
        )}

        {/* 3. Contact info */}
        {showInfo && (
          <div className={cn("space-y-2 p-4 text-sm", dividerFor("info"))}>
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
                  : "Enter a 10-digit US phone (e.g. (555) 739-9897)."
              }}
              type="tel"
              placeholder="No phone"
              ariaLabel="Primary phone"
            />
          </div>
        )}

        {/* 4. About */}
        {showAbout && (
          <div
            className={cn("space-y-2 p-4 text-sm", dividerFor("about"))}
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
                    inlineMode
                    onDismiss={() => {
                      void commit(contact.leadSource)
                    }}
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
                    inlineMode
                    onDismiss={() => {
                      void commit(contact.ownerUserId)
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
                    inlineMode
                    onDismiss={() => {
                      void commit(contact.companyId)
                    }}
                  />
                )}
              />
            </AboutRow>
            <AboutRow label="Tags">
              <InlineEditTags
                value={contact.tags}
                displayLabel={tagsDisplay}
                tagOptions={tagOptions}
                onSave={saveTags}
              />
            </AboutRow>
            <AboutRow label="Address">
              <div className="space-y-1">
                <InlineEditField
                  value={address.street1 ?? null}
                  onSave={saveAddressField("street1")}
                  placeholder="Street"
                  ariaLabel="Street"
                />
                <div className="grid grid-cols-[1fr_80px] gap-2">
                  <InlineEditField
                    value={address.city ?? null}
                    onSave={saveAddressField("city")}
                    placeholder="City"
                    ariaLabel="City"
                  />
                  <InlineEditSelect
                    value={address.state ?? null}
                    displayLabel={address.state ?? null}
                    items={US_STATE_CODES.map((s) => ({ value: s, label: s }))}
                    onSave={saveAddressState}
                    ariaLabel="State"
                    allowClear
                    placeholder="State"
                  />
                </div>
                <div className="w-[120px]">
                  <InlineEditField
                    value={address.zip ?? null}
                    onSave={saveAddressField("zip")}
                    placeholder="Zip"
                    ariaLabel="Zip"
                    validateBeforeSave={(v) =>
                      v === "" || /^\d{5}(-\d{4})?$/.test(v)
                        ? null
                        : "Zip must be 5 digits or 5+4 (e.g. 94102 or 94102-1234)."
                    }
                  />
                </div>
              </div>
            </AboutRow>
            <AboutRow label="Referred by">
              <InlineEditSelect
                value={contact.referredByContactId}
                displayLabel={referredByDisplayName}
                onSave={saveReferredBy}
                ariaLabel="Referred by"
                renderPicker={({ commit }) => (
                  <ContactRefPicker
                    options={referralOptions}
                    value={contact.referredByContactId}
                    onChange={(v) => {
                      void commit(v)
                    }}
                    inlineMode
                    onDismiss={() => {
                      void commit(contact.referredByContactId)
                    }}
                  />
                )}
              />
            </AboutRow>
          </div>
        )}
      </section>
    </aside>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-medium text-[var(--color-muted-foreground)]">{children}</p>
}

function AboutRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-start gap-2 text-xs">
      <span className="pt-1 text-[var(--color-muted-foreground)]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/**
 * P3 (C6c polish #2) — inline edit for the Tags field.
 *
 * Same lifecycle as InlineEditField / InlineEditSelect (click →
 * editing, autosave on click-outside, Esc reverts, no buttons). The
 * SearchableMultiSelect from C3 handles the multi-select + create-new
 * UX; this wrapper owns the lifecycle.
 */
function InlineEditTags({
  value,
  displayLabel,
  tagOptions,
  onSave,
}: {
  value: string[]
  displayLabel: string | null
  tagOptions: string[]
  onSave: (next: string[]) => Promise<{ error?: string } | undefined>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string[]>(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const [prevValue, setPrevValue] = useState<string[]>(value)
  const [prevEditing, setPrevEditing] = useState(editing)
  if (prevValue !== value || prevEditing !== editing) {
    setPrevValue(value)
    setPrevEditing(editing)
    if (!editing) {
      setDraft(value)
      setError(null)
    }
  }

  async function commit(next: string[]) {
    if (saving) return
    if (arraysEqual(next, value)) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await onSave(next)
      if (result && typeof result === "object" && "error" in result && result.error) {
        setError(result.error)
        setSaving(false)
        return
      }
      setSaving(false)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
      setSaving(false)
    }
  }

  function cancel() {
    if (saving) return
    setDraft(value)
    setError(null)
    setEditing(false)
  }

  useEffect(() => {
    if (!editing) return
    function onPointer(e: MouseEvent) {
      const t = e.target as Node | null
      if (!t) return
      if (wrapperRef.current?.contains(t)) return
      void commit(draft)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        cancel()
      }
    }
    document.addEventListener("mousedown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft])

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(true)
        }}
        aria-label="Edit tags"
        className={cn(
          "group flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left text-xs",
          "hover:bg-[var(--color-accent)]/30",
        )}
      >
        <span
          className={cn("flex-1 truncate", !displayLabel && "text-[var(--color-muted-foreground)]")}
        >
          {displayLabel ?? "—"}
        </span>
      </button>
    )
  }

  return (
    <div ref={wrapperRef} className="space-y-0.5">
      <SearchableMultiSelect
        items={tagOptions.map((t) => ({ value: t, label: t }))}
        values={draft}
        onChange={(next) => {
          setDraft(next)
        }}
        placeholder="Add a tag…"
        allowCreate
        aria-label="Tags"
        defaultOpen
        inlineMode
        onDismiss={() => {
          void commit(draft)
        }}
      />
      {saving && <p className="text-[10px] text-[var(--color-muted-foreground)]">Saving…</p>}
      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
