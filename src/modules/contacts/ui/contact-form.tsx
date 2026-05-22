"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { US_STATE_CODES, US_STATE_LABELS } from "@/lib/format/us-states"
import { parsePhoneInput } from "@/lib/format/phone"
import { normalizeUrl } from "@/lib/format/url"
import { CompanyPicker, type CompanyOption } from "@/modules/companies/ui/company-picker"
import { CustomFieldsRenderer } from "@/modules/custom-fields/ui/custom-fields-renderer"
import type { CustomFieldDefinition } from "@/modules/custom-fields/schema"
import { CONTACT_TYPES, LIFECYCLE_STATUSES } from "../types"
import { createContact, addContactCompanyAssociation } from "../actions"
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
 * New-contact form. Single long form per the LOC1 directive (all
 * intrinsic fields visible at once, no progressive disclosure). The
 * Primary Company is one CompanyPicker; "+ Add another company" rows
 * each get their own CompanyPicker + free-form role. Submit creates
 * the contact, then sequentially inserts the additional associations,
 * then redirects to the detail page.
 *
 * Phone fields are normalized to 10-digit storage form on submit via
 * parsePhoneInput. Empty mailing-address fields are stripped so the
 * Zod strict refine doesn't choke on blank state/zip strings.
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
  currentUserId,
}: {
  companies: CompanyOption[]
  referrals: ReferralOption[]
  owners: OwnerOption[]
  customFieldDefinitions: CustomFieldDefinition[]
  /** Custom lead-source values currently in use by other contacts.
   * Merged with the seeded defaults inside LeadSourceCombobox. */
  leadSourceValues: string[]
  currentUserId: string
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>(companies)

  // Form state
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [primaryCompanyId, setPrimaryCompanyId] = useState<string | null>(null)
  const [primaryEmail, setPrimaryEmail] = useState("")
  const [secondaryEmail, setSecondaryEmail] = useState("")
  const [primaryPhone, setPrimaryPhone] = useState("")
  const [secondaryPhone, setSecondaryPhone] = useState("")
  const [street1, setStreet1] = useState("")
  const [street2, setStreet2] = useState("")
  const [city, setCity] = useState("")
  const [stateCode, setStateCode] = useState("")
  const [zip, setZip] = useState("")
  const [dob, setDob] = useState("")
  const [anniversaryDate, setAnniversaryDate] = useState("")
  const [instagramHandle, setInstagramHandle] = useState("")
  const [facebookUrl, setFacebookUrl] = useState("")
  const [website, setWebsite] = useState("")
  const [leadSource, setLeadSource] = useState("")
  const [referredByContactId, setReferredByContactId] = useState("")
  const [contactType, setContactType] = useState<string>("")
  const [lifecycleStatus, setLifecycleStatus] = useState<string>("")
  const [tagsRaw, setTagsRaw] = useState("")
  const [ownerUserId, setOwnerUserId] = useState<string>(currentUserId)
  const [notes, setNotes] = useState("")
  const [internalNotes, setInternalNotes] = useState("")
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({})
  const [extraCompanies, setExtraCompanies] = useState<ExtraCompanyRow[]>([])

  function addExtraCompanyRow() {
    setExtraCompanies((prev) => [...prev, { key: crypto.randomUUID(), companyId: null, role: "" }])
  }

  function removeExtraCompanyRow(key: string) {
    setExtraCompanies((prev) => prev.filter((r) => r.key !== key))
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

    // Sequentially attach additional company associations. Surface the
    // first failure inline; the contact is already created so the user
    // can navigate to the detail page and finish manually.
    for (const row of extraCompanies) {
      if (!row.companyId) continue
      if (row.companyId === primaryCompanyId && !row.role.trim()) {
        setError(
          "Additional company matches the primary with no role — add a role label or remove the row.",
        )
        setSubmitting(false)
        return
      }
      const assocResult = await addContactCompanyAssociation({
        contactId: newId,
        companyId: row.companyId,
        role: row.role.trim() || undefined,
      })
      if (assocResult.serverError) {
        setError(`Contact created, but one association failed: ${assocResult.serverError}`)
        setSubmitting(false)
        return
      }
    }

    router.push(`/contacts/${newId}`)
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
          <Button type="button" variant="outline" size="sm" onClick={addExtraCompanyRow}>
            + Add another company
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
          {submitting ? "Creating…" : "Create contact"}
        </Button>
      </div>
    </form>
  )
}
