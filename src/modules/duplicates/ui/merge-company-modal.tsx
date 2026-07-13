"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { formatPhoneDisplay } from "@/lib/format/phone"
import {
  formatCustomFieldCell,
  type ListCustomFieldDef,
} from "@/modules/custom-fields/ui/column-helpers"
import { mergeCompanies, type CompanyDuplicateGroupView } from "../actions"
import type { CompanyDisplayRow } from "../queries"

type FieldKey = "name" | "website" | "mainPhone" | "instagramHandle" | "category" | `cf:${string}`

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  website: "Website",
  mainPhone: "Main phone",
  instagramHandle: "Instagram",
  category: "Category",
}

function valueDisplay(
  key: FieldKey,
  row: CompanyDisplayRow,
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
    case "mainPhone":
      return formatPhoneDisplay(row.mainPhone)
    default: {
      const v = row[key as keyof CompanyDisplayRow] as unknown
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
  values: Record<string, string>
  defaultId: string
}

function computeConflicts(
  group: CompanyDuplicateGroupView,
  primaryId: string,
  customFieldDefs: ListCustomFieldDef[],
): ConflictRow[] {
  const intrinsic: FieldKey[] = ["name", "website", "mainPhone", "instagramHandle", "category"]
  const cf: FieldKey[] = customFieldDefs.map((d): FieldKey => `cf:${d.id}`)
  const conflicts: ConflictRow[] = []
  for (const key of [...intrinsic, ...cf]) {
    const values: Record<string, string> = {}
    for (const r of group.records) values[r.id] = valueDisplay(key, r, customFieldDefs)
    const distinct = new Set(Object.values(values))
    if (distinct.size <= 1) continue
    const primaryVal = values[primaryId] ?? ""
    let defaultId = primaryId
    if (isEmpty(primaryVal)) {
      const other = group.records.find((r) => r.id !== primaryId && !isEmpty(values[r.id] ?? ""))
      if (other) defaultId = other.id
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

export function CompanyMergeModal({
  open,
  group,
  customFieldDefs,
  onClose,
  onMerged,
}: {
  open: boolean
  group: CompanyDuplicateGroupView | null
  customFieldDefs: ListCustomFieldDef[]
  onClose: () => void
  onMerged: () => void
}) {
  if (!open || !group) return null
  return (
    <CompanyMergeModalBody
      key={group.records.map((r) => r.id).join("|")}
      group={group}
      customFieldDefs={customFieldDefs}
      onClose={onClose}
      onMerged={onMerged}
    />
  )
}

function CompanyMergeModalBody({
  group,
  customFieldDefs,
  onClose,
  onMerged,
}: {
  group: CompanyDuplicateGroupView
  customFieldDefs: ListCustomFieldDef[]
  onClose: () => void
  onMerged: () => void
}) {
  const [primaryId, setPrimaryId] = useState(group.records[0]?.id ?? "")
  const [fieldChoices, setFieldChoices] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const conflicts = useMemo(
    () => computeConflicts(group, primaryId, customFieldDefs),
    [group, primaryId, customFieldDefs],
  )

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
    for (const c of conflicts) finalChoices[c.key] = effectiveChoice(c)
    const result = await mergeCompanies({
      winnerId: primaryId,
      loserIds: group.records.filter((r) => r.id !== primaryId).map((r) => r.id),
      fieldChoices: finalChoices,
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
        title="Merge companies?"
        className="max-w-md"
      >
        <p className="mb-4 text-sm">
          This will permanently combine these records. The non-primary companies will be
          soft-deleted but recoverable from{" "}
          <span className="font-mono text-xs">/companies/deleted</span>. Are you sure?
        </p>
        {error && (
          <div className="mb-3 rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 p-3 text-sm text-[var(--color-destructive)]">
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
      title="Merge companies"
      className="max-w-3xl"
    >
      <p className="mb-4 text-sm text-[var(--color-muted-foreground)]">
        Pick a primary record and resolve any conflicting fields. The non-primary companies will be
        soft-deleted.
      </p>

      {error && (
        <div className="mb-3 rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 p-3 text-sm text-[var(--color-destructive)]">
          {error}
        </div>
      )}

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
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  {r.website ?? "—"} · {formatPhoneDisplay(r.mainPhone) || "—"} ·{" "}
                  {r.category ?? "—"} · created {r.createdAt.slice(0, 10)}
                </div>
              </div>
            </label>
          ))}
        </div>
      </fieldset>

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
                    {r.name}
                    {r.id === primaryId && (
                      <span className="text-3xs ml-1 rounded-full bg-[var(--color-muted)] px-1.5">
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
