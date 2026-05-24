"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { US_STATE_CODES, US_STATE_LABELS } from "@/lib/format/us-states"
import { formatPhoneDisplay, parsePhoneInput } from "@/lib/format/phone"
import { normalizeUrl } from "@/lib/format/url"
import { CompanyPicker, type CompanyOption } from "@/modules/companies/ui/company-picker"
import { CustomFieldsRenderer } from "@/modules/custom-fields/ui/custom-fields-renderer"
import type { CustomFieldDefinition } from "@/modules/custom-fields/schema"
import type { Contact } from "../schema"
import { CONTACT_TYPES, LIFECYCLE_STATUSES } from "../types"
import {
  addContactCompanyAssociation,
  createContact,
  removeContactCompanyAssociation,
  updateContact,
  updateContactCompanyAssociation,
} from "../actions"
import { LeadSourceCombobox } from "./lead-source-combobox"

interface ReferralOption {
  id: string
  firstName: string
  lastName: string
}

interface OwnerOption {
  id: string
  name: string | null
  email: string
}

interface ExtraCompanyRow {
  key: string
  companyId: string | null
  role: string
  /** Present when the row was hydrated from an existing association.
   * Drives the reconcile path on submit (compare vs. current value;
   * call update if role changed, remove if the row is gone). */
  existingAssocId?: string
  existingRole?: string | null
}

interface InitialAssociation {
  id: string
  companyId: string
  role: string | null
}

interface MailingAddressShape {
  street1?: string
  street2?: string
  city?: string
  state?: string
  zip?: string
}

function formatValidationErrors(errors: unknown): string {
  if (!errors || typeof errors !== "object") return "Validation failed."
  const messages: string[] = []
  for (const [field, errs] of Object.entries(errors)) {
    if (field === "_errors") continue
    if (errs && typeof errs === "object" && "_errors" in errs) {
      const arr = (errs as { _errors: unknown })._errors
      if (Array.isArray(arr)) {
        for (const m of arr) {
          if (typeof m === "string") messages.push(`${field}: ${m}`)
        }
      }
    }
  }
  return messages.length > 0 ? messages.join(" · ") : "Validation failed."
}

/**
 * Contact form for BOTH create and edit. Pass `initialContact` (+
 * optional `initialAssociations`) to put the form in edit mode —
 * state hydrates from those values, submit calls `updateContact`
 * + reconciles association add/update/remove, redirects to the
 * detail page on success.
 *
 * Phone fields format on blur via formatPhoneDisplay; storage form
 * is normalized to 10 raw digits via parsePhoneInput. Mailing
 * address jsonb fields are stripped if blank. URL fields run
 * through normalizeUrl (auto-prepends https://).
 *
 * Errors mid-association (e.g., a duplicate role attempt) surface
 * inline; the contact itself is already created at that point. The
 * user can re-try association from the detail page after PUSH 3.
 */
export function ContactForm({
  companies,
  referrals,
  owners,
  customFieldDefinitions,
  leadSourceValues,
  hiddenLeadSources,
  currentUserId,
  initialContact,
  initialAssociations,
}: {
  companies: CompanyOption[]
  referrals: ReferralOption[]
  owners: OwnerOption[]
  customFieldDefinitions: CustomFieldDefinition[]
  /** Custom lead-source values currently in use by other contacts.
   * Merged with the seeded defaults inside LeadSourceCombobox. */
  leadSourceValues: string[]
  /** Org-level hidden sources (from org_lead_source_overrides). The
   * combobox filters these out. */
  hiddenLeadSources: string[]
  currentUserId: string
  /** Edit mode. When present, the form pre-fills from this contact
   * and submits via `updateContact`. */
  initialContact?: Contact
  /** Existing contact-company associations to hydrate (edit mode
   * only). New rows the user adds go through `addContactCompanyAssociation`;
   * rows the user removes go through `removeContactCompanyAssociation`;
   * rows whose role changed go through `updateContactCompanyAssociation`. */
  initialAssociations?: InitialAssociation[]
}) {
  const router = useRouter()
  const isEdit = !!initialContact
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>(companies)

  const initialAddress = (initialContact?.mailingAddress ?? {}) as MailingAddressShape

  // Form state
  const [firstName, setFirstName] = useState(initialContact?.firstName ?? "")
  const [lastName, setLastName] = useState(initialContact?.lastName ?? "")
  const [primaryCompanyId, setPrimaryCompanyId] = useState<string | null>(
    initialContact?.companyId ?? null,
  )
  const [primaryEmail, setPrimaryEmail] = useState(initialContact?.primaryEmail ?? "")
  const [secondaryEmail, setSecondaryEmail] = useState(initialContact?.secondaryEmail ?? "")
  const [primaryPhone, setPrimaryPhone] = useState(
    formatPhoneDisplay(initialContact?.primaryPhone ?? ""),
  )
  const [secondaryPhone, setSecondaryPhone] = useState(
    formatPhoneDisplay(initialContact?.secondaryPhone ?? ""),
  )
  const [street1, setStreet1] = useState(initialAddress.street1 ?? "")
  const [street2, setStreet2] = useState(initialAddress.street2 ?? "")
  const [city, setCity] = useState(initialAddress.city ?? "")
  const [stateCode, setStateCode] = useState(initialAddress.state ?? "")
  const [zip, setZip] = useState(initialAddress.zip ?? "")
  const [dob, setDob] = useState(initialContact?.dob ?? "")
  const [anniversaryDate, setAnniversaryDate] = useState(initialContact?.anniversaryDate ?? "")
  const [instagramHandle, setInstagramHandle] = useState(initialContact?.instagramHandle ?? "")
  const [facebookUrl, setFacebookUrl] = useState(initialContact?.facebookUrl ?? "")
  const [website, setWebsite] = useState(initialContact?.website ?? "")
  const [leadSource, setLeadSource] = useState(initialContact?.leadSource ?? "")
  const [referredByContactId, setReferredByContactId] = useState(
    initialContact?.referredByContactId ?? "",
  )
  const [contactType, setContactType] = useState<string>(initialContact?.contactType ?? "")
  const [lifecycleStatus, setLifecycleStatus] = useState<string>(
    initialContact?.lifecycleStatus ?? "",
  )
  const [tagsRaw, setTagsRaw] = useState((initialContact?.tags ?? []).join(", "))
  const [ownerUserId, setOwnerUserId] = useState<string>(
    initialContact?.ownerUserId ?? currentUserId,
  )
  const [notes, setNotes] = useState(initialContact?.notes ?? "")
  const [internalNotes, setInternalNotes] = useState(initialContact?.internalNotes ?? "")
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>(
    initialContact?.customFields ?? {},
  )
  const [extraCompanies, setExtraCompanies] = useState<ExtraCompanyRow[]>(
    (initialAssociations ?? []).map((a) => ({
      key: a.id,
      companyId: a.companyId,
      role: a.role ?? "",
      existingAssocId: a.id,
      existingRole: a.role,
    })),
  )
  const [removedAssocIds, setRemovedAssocIds] = useState<string[]>([])

  function addExtraCompanyRow() {
    setExtraCompanies((prev) => [...prev, { key: crypto.randomUUID(), companyId: null, role: "" }])
  }

  function removeExtraCompanyRow(key: string) {
    setExtraCompanies((prev) => {
      const target = prev.find((r) => r.key === key)
      const existingId = target?.existingAssocId
      if (existingId) {
        setRemovedAssocIds((ids) => [...ids, existingId])
      }
      return prev.filter((r) => r.key !== key)
    })
  }

  function updateExtraCompanyRow(key: string, patch: Partial<ExtraCompanyRow>) {
    setExtraCompanies((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function buildMailingAddress(): Record<string, string> | null {
    const addr: Record<string, string> = {}
    if (street1.trim()) addr.street1 = street1.trim()
    if (street2.trim()) addr.street2 = street2.trim()
    if (city.trim()) addr.city = city.trim()
    if (stateCode.trim()) addr.state = stateCode.trim().toUpperCase()
    if (zip.trim()) addr.zip = zip.trim()
    return Object.keys(addr).length > 0 ? addr : null
  }

  function buildTags(): string[] | undefined {
    const parts = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
    return parts.length > 0 ? parts : undefined
  }

  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    if (!firstName.trim()) {
      setError("First name is required.")
      return
    }
    if (!lastName.trim()) {
      setError("Last name is required.")
      return
    }
    setSubmitting(true)
    setError(null)

    const payload = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      companyId: primaryCompanyId,
      primaryEmail: primaryEmail.trim() || "",
      secondaryEmail: secondaryEmail.trim() || "",
      primaryPhone:
        parsePhoneInput(primaryPhone) ?? (primaryPhone.trim() ? primaryPhone.trim() : ""),
      secondaryPhone:
        parsePhoneInput(secondaryPhone) ?? (secondaryPhone.trim() ? secondaryPhone.trim() : ""),
      mailingAddress: buildMailingAddress(),
      dob: dob || "",
      anniversaryDate: anniversaryDate || "",
      instagramHandle: instagramHandle.trim() || "",
      facebookUrl: normalizeUrl(facebookUrl),
      website: normalizeUrl(website),
      leadSource: leadSource.trim() || "",
      referredByContactId: referredByContactId || null,
      contactType: contactType ? (contactType as (typeof CONTACT_TYPES)[number]) : undefined,
      lifecycleStatus: lifecycleStatus
        ? (lifecycleStatus as (typeof LIFECYCLE_STATUSES)[number])
        : undefined,
      tags: buildTags(),
      ownerUserId: ownerUserId || null,
      notes: notes.trim() || "",
      internalNotes: internalNotes.trim() || "",
      customFields: Object.keys(customFieldValues).length > 0 ? customFieldValues : null,
    }

    let contactId: string

    if (initialContact) {
      const result = await updateContact({ id: initialContact.id, ...payload })
      if (result.serverError) {
        setError(result.serverError)
        setSubmitting(false)
        return
      }
      if (result.validationErrors) {
        setError(formatValidationErrors(result.validationErrors))
        setSubmitting(false)
        return
      }
      contactId = initialContact.id
    } else {
      const result = await createContact(payload)
      if (result.serverError) {
        setError(result.serverError)
        setSubmitting(false)
        return
      }
      if (result.validationErrors) {
        setError(formatValidationErrors(result.validationErrors))
        setSubmitting(false)
        return
      }
      const newId = result.data?.id
      if (!newId) {
        setError("Unknown error creating contact.")
        setSubmitting(false)
        return
      }
      contactId = newId
    }

    // Reconcile additional company associations. Three buckets:
    //   1. Rows the user removed (existingAssocId in removedAssocIds)
    //      → removeContactCompanyAssociation
    //   2. Existing rows whose role changed (existingAssocId present
    //      AND role differs from existingRole) → updateContactCompanyAssociation
    //   3. New rows (no existingAssocId) → addContactCompanyAssociation
    //
    // The contact itself is already saved at this point. The first
    // failure surfaces inline; the user can re-try associations from
    // the detail page.

    for (const removedId of removedAssocIds) {
      const removeResult = await removeContactCompanyAssociation({ id: removedId })
      if (removeResult.serverError) {
        setError(`Saved, but removing an association failed: ${removeResult.serverError}`)
        setSubmitting(false)
        return
      }
    }

    for (const row of extraCompanies) {
      if (!row.companyId) continue
      const newRole = row.role.trim() || null

      if (row.existingAssocId) {
        if (newRole !== (row.existingRole ?? null)) {
          const upd = await updateContactCompanyAssociation({
            id: row.existingAssocId,
            role: newRole ?? undefined,
          })
          if (upd.serverError) {
            setError(`Saved, but updating a role failed: ${upd.serverError}`)
            setSubmitting(false)
            return
          }
        }
        continue
      }

      if (row.companyId === primaryCompanyId && !row.role.trim()) {
        setError(
          "Additional company matches the primary with no role — add a role label or remove the row.",
        )
        setSubmitting(false)
        return
      }
      const assocResult = await addContactCompanyAssociation({
        contactId,
        companyId: row.companyId,
        role: row.role.trim() || undefined,
      })
      if (assocResult.serverError) {
        setError(`Saved, but one association failed: ${assocResult.serverError}`)
        setSubmitting(false)
        return
      }
    }

    router.push(`/contacts/${contactId}`)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {/* Identity */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Identity</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName">
              First name <span className="text-red-600">*</span>
            </Label>
            <Input
              id="firstName"
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value)
              }}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">
              Last name <span className="text-red-600">*</span>
            </Label>
            <Input
              id="lastName"
              value={lastName}
              onChange={(e) => {
                setLastName(e.target.value)
              }}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dob">Date of birth</Label>
            <Input
              id="dob"
              type="date"
              value={dob}
              onChange={(e) => {
                setDob(e.target.value)
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="anniversaryDate">Anniversary</Label>
            <Input
              id="anniversaryDate"
              type="date"
              value={anniversaryDate}
              onChange={(e) => {
                setAnniversaryDate(e.target.value)
              }}
            />
          </div>
        </div>
      </section>

      {/* Companies */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Companies</h2>
        <div className="space-y-2">
          <Label htmlFor="primaryCompanyId">Primary company</Label>
          <CompanyPicker
            id="primaryCompanyId"
            options={companyOptions}
            value={primaryCompanyId}
            onChange={setPrimaryCompanyId}
            onCompanyCreated={(c) => {
              setCompanyOptions((prev) => [...prev, c])
            }}
          />
          <p className="text-xs text-[var(--color-muted-foreground)]">
            The primary company is what shows in lists and pickers. Additional roles below add to
            the Companies tab on the detail page.
          </p>
        </div>
        <div className="space-y-3">
          {extraCompanies.map((row) => (
            <div
              key={row.key}
              className="grid grid-cols-1 gap-2 rounded-md border border-[var(--color-border)] p-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
            >
              <div className="space-y-2">
                <Label htmlFor={`extra-co-${row.key}`}>Additional company</Label>
                <CompanyPicker
                  id={`extra-co-${row.key}`}
                  options={companyOptions}
                  value={row.companyId}
                  onChange={(id) => {
                    updateExtraCompanyRow(row.key, { companyId: id })
                  }}
                  onCompanyCreated={(c) => {
                    setCompanyOptions((prev) => [...prev, c])
                    updateExtraCompanyRow(row.key, { companyId: c.id })
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`extra-role-${row.key}`}>Role (optional)</Label>
                <Input
                  id={`extra-role-${row.key}`}
                  value={row.role}
                  onChange={(e) => {
                    updateExtraCompanyRow(row.key, { role: e.target.value })
                  }}
                  placeholder="e.g., Billing Contact"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  removeExtraCompanyRow(row.key)
                }}
              >
                Remove
              </Button>
            </div>
          ))}
          {/*
           * Push 2c.5 — single "+ Add company" button. Was previously
           * "+ Add another company", which read as the second button
           * alongside CompanyPicker's inline "+ Add company"
           * affordance (which still exists, but it CREATES a new
           * Company entity rather than linking an existing one to
           * this contact). Same affordance regardless of whether the
           * user is adding their 1st, 2nd, or Nth additional company.
           */}
          <Button type="button" variant="outline" size="sm" onClick={addExtraCompanyRow}>
            + Add company
          </Button>
        </div>
      </section>

      {/* Communication */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Communication</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="primaryEmail">Primary email</Label>
            <Input
              id="primaryEmail"
              type="email"
              value={primaryEmail}
              onChange={(e) => {
                setPrimaryEmail(e.target.value)
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="secondaryEmail">Secondary email</Label>
            <Input
              id="secondaryEmail"
              type="email"
              value={secondaryEmail}
              onChange={(e) => {
                setSecondaryEmail(e.target.value)
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="primaryPhone">Primary phone</Label>
            <Input
              id="primaryPhone"
              type="tel"
              placeholder="(555) 123-4567"
              value={primaryPhone}
              onChange={(e) => {
                setPrimaryPhone(e.target.value)
              }}
              onBlur={() => {
                setPrimaryPhone(formatPhoneDisplay(primaryPhone))
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="secondaryPhone">Secondary phone</Label>
            <Input
              id="secondaryPhone"
              type="tel"
              placeholder="(555) 123-4567"
              value={secondaryPhone}
              onChange={(e) => {
                setSecondaryPhone(e.target.value)
              }}
              onBlur={() => {
                setSecondaryPhone(formatPhoneDisplay(secondaryPhone))
              }}
            />
          </div>
        </div>
      </section>

      {/* Address */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Address</h2>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="street1">Street</Label>
            <Input
              id="street1"
              value={street1}
              onChange={(e) => {
                setStreet1(e.target.value)
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="street2">Apt / suite (optional)</Label>
            <Input
              id="street2"
              value={street2}
              onChange={(e) => {
                setStreet2(e.target.value)
              }}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={city}
                onChange={(e) => {
                  setCity(e.target.value)
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stateCode">State</Label>
              <select
                id="stateCode"
                className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm shadow-sm"
                value={stateCode}
                onChange={(e) => {
                  setStateCode(e.target.value)
                }}
              >
                <option value="">—</option>
                {US_STATE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code} — {US_STATE_LABELS[code]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="zip">ZIP</Label>
              <Input
                id="zip"
                value={zip}
                placeholder="12345 or 12345-6789"
                onChange={(e) => {
                  setZip(e.target.value)
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Social profiles */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Social profiles</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="instagramHandle">Instagram handle</Label>
            <Input
              id="instagramHandle"
              value={instagramHandle}
              placeholder="@studio"
              onChange={(e) => {
                setInstagramHandle(e.target.value)
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="facebookUrl">Facebook URL</Label>
            <Input
              id="facebookUrl"
              value={facebookUrl}
              placeholder="facebook.com/yourstudio"
              onChange={(e) => {
                setFacebookUrl(e.target.value)
              }}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              value={website}
              placeholder="yourstudio.com"
              onChange={(e) => {
                setWebsite(e.target.value)
              }}
            />
          </div>
        </div>
      </section>

      {/* Lead generation */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Lead generation</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="leadSource">Lead source</Label>
            <LeadSourceCombobox
              id="leadSource"
              value={leadSource}
              onChange={setLeadSource}
              existingValues={leadSourceValues}
              hiddenSources={hiddenLeadSources}
              allowAnyOption
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="referredByContactId">Referred by</Label>
            <select
              id="referredByContactId"
              className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm shadow-sm"
              value={referredByContactId}
              onChange={(e) => {
                setReferredByContactId(e.target.value)
              }}
            >
              <option value="">— None —</option>
              {referrals.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.firstName} {r.lastName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contactType">Contact type</Label>
            <select
              id="contactType"
              className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm shadow-sm"
              value={contactType}
              onChange={(e) => {
                setContactType(e.target.value)
              }}
            >
              <option value="">— None —</option>
              {CONTACT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="lifecycleStatus">Lifecycle status</Label>
            <select
              id="lifecycleStatus"
              className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm shadow-sm"
              value={lifecycleStatus}
              onChange={(e) => {
                setLifecycleStatus(e.target.value)
              }}
            >
              <option value="">— None —</option>
              {LIFECYCLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="tagsRaw">Tags</Label>
            <Input
              id="tagsRaw"
              value={tagsRaw}
              placeholder="vip, studio-friend, wedding"
              onChange={(e) => {
                setTagsRaw(e.target.value)
              }}
            />
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Comma-separated. Free-form — used in filters and reports.
            </p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="ownerUserId">Owner</Label>
            <select
              id="ownerUserId"
              className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm shadow-sm"
              value={ownerUserId}
              onChange={(e) => {
                setOwnerUserId(e.target.value)
              }}
            >
              <option value="">— Unassigned —</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name ?? o.email}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Notes */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Notes</h2>
        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            rows={4}
            className="block w-full rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value)
            }}
          />
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Shown on the contact detail. Visible to anyone with access.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="internalNotes">Internal notes</Label>
          <textarea
            id="internalNotes"
            rows={4}
            className="block w-full rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none"
            value={internalNotes}
            onChange={(e) => {
              setInternalNotes(e.target.value)
            }}
          />
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Honest take, quirks. Shown only on detail view, never in lists or pickers.
          </p>
        </div>
      </section>

      {/* Custom fields */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Custom fields</h2>
        <CustomFieldsRenderer
          definitions={customFieldDefinitions}
          values={customFieldValues}
          onChange={setCustomFieldValues}
        />
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            router.back()
          }}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting
            ? isEdit
              ? "Saving…"
              : "Creating…"
            : isEdit
              ? "Save changes"
              : "Create contact"}
        </Button>
      </div>
    </form>
  )
}
