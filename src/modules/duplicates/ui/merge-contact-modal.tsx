"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { formatPhoneDisplay } from "@/lib/format/phone"
import {
  formatCustomFieldCell,
  type ListCustomFieldDef,
} from "@/modules/custom-fields/ui/column-helpers"
import { mergeContacts, type ContactDuplicateGroupView } from "../actions"
import type { ContactDisplayRow } from "../queries"

/**
 * Push 4 (B2) — contact merge modal.
 *
 * Two-phase UX:
 *   1. Compare + pick: side-by-side comparison rows. Top picker
 *      selects the primary record; each conflicting field row has
 *      a per-record radio that defaults to the primary's value
 *      (auto-rescue: if primary's value is null and a loser's is
 *      not, that loser becomes the default winner for that field).
 *      Rows where all records have the same value are not shown
 *      (no conflict).
 *   2. Confirm: a destructive-action confirmation step labelled
 *      "This will permanently combine these records..." before the
 *      action fires.
 *
 * Tag merge: default mode "union"; toggle to "use [Record X]'s tags".
 * Additional companies (junction table) default to union; toggle
 * mirrors tags.
 *
 * Custom fields rendered alongside intrinsic scalar fields under a
 * single per-row comparison; archived defs are excluded by the
 * scan action so they don't appear in the picker.
 */

type FieldKey =
  | "firstName"
  | "lastName"
  | "primaryEmail"
  | "secondaryEmail"
  | "primaryPhone"
  | "secondaryPhone"
  | "contactType"
  | "lifecycleStatus"
  | "leadSource"
  | "sourceDetail"
  | "companyId"
  | "ownerUserId"
  | "instagramHandle"
  | "facebookUrl"
  | "website"
  | "notes"
  | "internalNotes"
  | "dob"
  | "anniversaryDate"
  | "referredByContactId"
  | `cf:${string}`

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  primaryEmail: "Primary email",
  secondaryEmail: "Secondary email",
  primaryPhone: "Primary phone",
  secondaryPhone: "Secondary phone",
  contactType: "Contact type",
  lifecycleStatus: "Lifecycle status",
  leadSource: "Lead source",
  sourceDetail: "Source detail",
  companyId: "Primary company",
  ownerUserId: "Owner",
  instagramHandle: "Instagram",
  facebookUrl: "Facebook",
  website: "Website",
  notes: "Notes",
  internalNotes: "Internal notes",
  dob: "Birthday",
  anniversaryDate: "Anniversary",
  referredByContactId: "Referred by",
}

function valueDisplay(
  key: FieldKey,
  row: ContactDisplayRow,
  customFieldDefs: ListCustomFieldDef[],
): string {
  if (key.startsWith("cf:")) {
    const defId = key.slice(3)
    const def = customFieldDefs.find((d) => d.id === defId)
    if (!def) return ""
    const v = row.customFields?.[defId]
    return formatCustomFieldCell(def, v) || ""
  }
  switch (key) {
    case "primaryPhone":
    case "secondaryPhone":
      return formatPhoneDisplay(row[key])
    case "companyId":
      return row.companyName ?? row.companyId ?? ""
    case "ownerUserId":
      return row.ownerUserId ?? ""
    case "referredByContactId":
      return row.referredByContactId ?? ""
    case "dob":
    case "anniversaryDate":
      return row[key] ?? ""
    default: {
      const v = row[key as keyof ContactDisplayRow] as unknown
      if (typeof v === "string") return v
      if (v === null || v === undefined) return ""
      if (typeof v === "number" || typeof v === "boolean") return String(v)
      return ""
    }
  }
}

function isEmpty(s: string): boolean {
  return s.trim().length === 0
}

interface ConflictRow {
  key: FieldKey
  label: string
  values: Record<string, string> // recordId -> display value
  /** Auto-rescue default: when primary is empty and one loser has a
   * value, that loser is the default winner. Otherwise primary wins. */
  defaultId: string
}

function computeConflicts(
  group: ContactDuplicateGroupView,
  primaryId: string,
  customFieldDefs: ListCustomFieldDef[],
): ConflictRow[] {
  const intrinsicKeys: FieldKey[] = [
    "firstName",
    "lastName",
    "primaryEmail",
    "secondaryEmail",
    "primaryPhone",
    "secondaryPhone",
    "contactType",
    "lifecycleStatus",
    "leadSource",
    "sourceDetail",
    "companyId",
    "ownerUserId",
    "instagramHandle",
    "facebookUrl",
    "website",
    "notes",
    "internalNotes",
    "dob",
    "anniversaryDate",
    "referredByContactId",
  ]
  const cfKeys: FieldKey[] = customFieldDefs.map((d): FieldKey => `cf:${d.id}`)
  const allKeys: FieldKey[] = [...intrinsicKeys, ...cfKeys]

  const conflicts: ConflictRow[] = []
  for (const key of allKeys) {
    const values: Record<string, string> = {}
    for (const r of group.records) values[r.id] = valueDisplay(key, r, customFieldDefs)
    const distinct = new Set(Object.values(values))
    if (distinct.size <= 1) continue // all same → not a conflict
    const primaryVal = values[primaryId] ?? ""
    let defaultId = primaryId
    if (isEmpty(primaryVal)) {
      const loserWithValue = group.records.find(
        (r) => r.id !== primaryId && !isEmpty(values[r.id] ?? ""),
      )
      if (loserWithValue) defaultId = loserWithValue.id
    }
    conflicts.push({
      key,
      label: key.startsWith("cf:")
        ? (customFieldDefs.find((d) => d.id === key.slice(3))?.name ?? key)
        : (FIELD_LABELS[key] ?? key),
      values,
      defaultId,
    })
  }
  return conflicts
}

export function ContactMergeModal({
  open,
  group,
  customFieldDefs,
  onClose,
  onMerged,
}: {
  open: boolean
  group: ContactDuplicateGroupView | null
  customFieldDefs: ListCustomFieldDef[]
  onClose: () => void
  onMerged: () => void
}) {
  if (!open || !group) return null
  return (
    <ContactMergeModalBody
      key={group.records.map((r) => r.id).join("|")}
      group={group}
      customFieldDefs={customFieldDefs}
      onClose={onClose}
      onMerged={onMerged}
    />
  )
}

function ContactMergeModalBody({
  group,
  customFieldDefs,
  onClose,
  onMerged,
}: {
  group: ContactDuplicateGroupView
  customFieldDefs: ListCustomFieldDef[]
  onClose: () => void
  onMerged: () => void
}) {
  const [primaryId, setPrimaryId] = useState(group.records[0]?.id ?? "")
  const [fieldChoices, setFieldChoices] = useState<Record<string, string>>({})
  const [tagsMode, setTagsMode] = useState<{ mode: "union" } | { mode: "use"; fromId: string }>({
    mode: "union",
  })
  const [companiesMode, setCompaniesMode] = useState<
    { mode: "union" } | { mode: "use"; fromId: string }
  >({ mode: "union" })
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Recompute conflicts whenever primary changes. Existing
  // user-overridden choices stay when the field is still a conflict.
  const conflicts = useMemo(
    () => computeConflicts(group, primaryId, customFieldDefs),
    [group, primaryId, customFieldDefs],
  )

  // For each conflict row not explicitly chosen, use the row's default.
  function effectiveChoice(c: ConflictRow): string {
    return fieldChoices[c.key] ?? c.defaultId
  }

  function setChoice(key: string, recordId: string) {
    setFieldChoices((prev) => ({ ...prev, [key]: recordId }))
  }

  async function submitMerge() {
    if (busy) return
    setBusy(true)
    setError(null)
    const finalChoices: Record<string, string> = {}
    for (const c of conflicts) {
      finalChoices[c.key] = effectiveChoice(c)
    }
    const result = await mergeContacts({
      winnerId: primaryId,
      loserIds: group.records.filter((r) => r.id !== primaryId).map((r) => r.id),
      fieldChoices: finalChoices,
      tagsMode,
      companiesMode,
    })
    setBusy(false)
    if (result.serverError) {
      setError(result.serverError)
      setConfirm(false)
      return
    }
    onMerged()
  }

  if (confirm) {
    return (
      <Modal
        open
        onClose={() => {
          if (!busy) setConfirm(false)
        }}
        title="Merge contacts?"
        className="max-w-md"
      >
        <p className="mb-4 text-sm">
          This will permanently combine these records. The non-primary contacts will be soft-deleted
          but recoverable from <span className="font-mono text-xs">/contacts/deleted</span>. Are you
          sure?
        </p>
        {error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setConfirm(false)
            }}
          >
            Back
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              void submitMerge()
            }}
          >
            {busy ? "Merging…" : "Yes, merge"}
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose()
      }}
      title="Merge contacts"
      className="max-w-3xl"
    >
      <p className="mb-4 text-sm text-[var(--color-muted-foreground)]">
        Pick a primary record and resolve any conflicting fields. The non-primary contacts will be
        soft-deleted; data you pick from them lives on the primary.
      </p>

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Primary picker */}
      <fieldset className="mb-5 rounded-md border border-[var(--color-border)] p-3">
        <legend className="px-2 text-xs font-semibold text-[var(--color-muted-foreground)] uppercase">
          Primary record
        </legend>
        <div className="space-y-2">
          {group.records.map((r) => (
            <label key={r.id} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="primary"
                checked={primaryId === r.id}
                onChange={() => {
                  setPrimaryId(r.id)
                }}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium">
                  {r.firstName} {r.lastName}
                </div>
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  {r.primaryEmail ?? "—"} · {formatPhoneDisplay(r.primaryPhone) || "—"} ·{" "}
                  {r.companyName ?? "—"} · created {r.createdAt.slice(0, 10)}
                </div>
              </div>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Per-field conflicts */}
      {conflicts.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-4 text-center text-sm text-[var(--color-muted-foreground)]">
          No conflicting fields between these records — merge will preserve everything from the
          primary.
        </p>
      ) : (
        <div className="mb-5 space-y-3">
          <h3 className="text-sm font-semibold">Resolve conflicts</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-[var(--color-muted-foreground)]">
              <tr>
                <th className="py-1">Field</th>
                {group.records.map((r) => (
                  <th key={r.id} className="py-1">
                    {r.firstName} {r.lastName}
                    {r.id === primaryId && (
                      <span className="ml-1 rounded-full bg-[var(--color-muted)] px-1.5 text-[10px]">
                        primary
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c) => (
                <tr key={c.key} className="border-t border-[var(--color-border)]">
                  <td className="py-2 pr-2 align-top text-xs font-medium">{c.label}</td>
                  {group.records.map((r) => {
                    const display = c.values[r.id] ?? ""
                    const picked = effectiveChoice(c) === r.id
                    return (
                      <td key={r.id} className="py-2 pr-2 align-top">
                        <label className="flex items-start gap-2 text-xs">
                          <input
                            type="radio"
                            name={`conflict-${c.key}`}
                            checked={picked}
                            onChange={() => {
                              setChoice(c.key, r.id)
                            }}
                            className="mt-0.5"
                          />
                          <span
                            className={
                              isEmpty(display) ? "text-[var(--color-muted-foreground)]" : ""
                            }
                          >
                            {display || "—"}
                          </span>
                        </label>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tags mode */}
      <fieldset className="mb-5 rounded-md border border-[var(--color-border)] p-3">
        <legend className="px-2 text-xs font-semibold text-[var(--color-muted-foreground)] uppercase">
          Tags
        </legend>
        <div className="space-y-1.5 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="tags-mode"
              checked={tagsMode.mode === "union"}
              onChange={() => {
                setTagsMode({ mode: "union" })
              }}
            />
            Keep all unique tags from every record
          </label>
          {group.records.map((r) => (
            <label key={r.id} className="flex items-center gap-2">
              <input
                type="radio"
                name="tags-mode"
                checked={tagsMode.mode === "use" && tagsMode.fromId === r.id}
                onChange={() => {
                  setTagsMode({ mode: "use", fromId: r.id })
                }}
              />
              Use only {r.firstName} {r.lastName}&apos;s tags{" "}
              <span className="text-xs text-[var(--color-muted-foreground)]">
                ({(r.tags ?? []).join(", ") || "none"})
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Companies mode (junction associations) */}
      <fieldset className="mb-5 rounded-md border border-[var(--color-border)] p-3">
        <legend className="px-2 text-xs font-semibold text-[var(--color-muted-foreground)] uppercase">
          Additional companies (associations)
        </legend>
        <div className="space-y-1.5 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="companies-mode"
              checked={companiesMode.mode === "union"}
              onChange={() => {
                setCompaniesMode({ mode: "union" })
              }}
            />
            Keep all associations from every record
          </label>
          {group.records.map((r) => (
            <label key={r.id} className="flex items-center gap-2">
              <input
                type="radio"
                name="companies-mode"
                checked={companiesMode.mode === "use" && companiesMode.fromId === r.id}
                onChange={() => {
                  setCompaniesMode({ mode: "use", fromId: r.id })
                }}
              />
              Use only {r.firstName} {r.lastName}&apos;s associations
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => {
            setConfirm(true)
          }}
        >
          Merge
        </Button>
      </div>
    </Modal>
  )
}
