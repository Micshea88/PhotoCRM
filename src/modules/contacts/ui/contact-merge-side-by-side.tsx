"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Crown, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InlineEditField } from "@/components/ui/inline-edit-field"
import { InlineEditSelect } from "@/components/ui/inline-edit-select"
import { Modal } from "@/components/ui/modal"
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select"
import { cn } from "@/lib/utils"
import { formatPhoneDisplay, parsePhoneInput } from "@/lib/format/phone"
import { CompanyPicker, type CompanyOption } from "@/modules/companies/ui/company-picker"
import { ContactRefPicker, type ContactOption } from "@/modules/custom-fields/ui/contact-ref-picker"
import { UserRefPicker, type UserOption } from "@/modules/custom-fields/ui/user-ref-picker"
import {
  formatCustomFieldCell,
  type ListCustomFieldDef,
} from "@/modules/custom-fields/ui/column-helpers"
import { LeadSourceCombobox } from "./lead-source-combobox"
import { mergeContacts } from "@/modules/duplicates/actions"
import type { ContactDisplayRow } from "@/modules/duplicates/queries"
import { CONTACT_TYPES, LIFECYCLE_STATUSES } from "@/modules/contacts/types"

/**
 * Push 3 (C7) — manual pairwise merge surface.
 *
 * TRUE side-by-side full-record view. Every contact field renders
 * regardless of conflict. Per memory #23 + the C7 spec the winning
 * column hosts the inline-edit primitive (InlineEditField /
 * InlineEditSelect / SearchableMultiSelect) so the user can either
 *
 *   1. Click the non-winning side to swap which record wins, OR
 *   2. Click the winning side to inline-edit a custom value that
 *      overrides both A and B.
 *
 * Custom-edited cells render with an "edited" pill. Esc on the
 * inline-edit primitive reverts to that side's original value.
 *
 * Engine: calls `mergeContacts` from Push 4 B2 (extended in C7 to
 * accept `customOverrides`). The UI batches all picks + overrides
 * into a single action call. Engine atomically: writes the merged
 * row, repoints FKs (notes/calls/meetings/sms/opportunities/etc),
 * soft-deletes the loser, busts AI cache, audits.
 *
 * V1 captured upcoming (see docs §8):
 *   - 3+ contact merge (multi-way)
 *   - Per-subfield address pick (street/city/state/zip independent)
 *   - Live merged-record preview column
 */

// ─── Field key types ────────────────────────────────────────────────────

type IntrinsicKey =
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
type FieldKey = IntrinsicKey | "tags" | "mailingAddress" | `cf:${string}`

const INTRINSIC_KEYS: IntrinsicKey[] = [
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

const FIELD_LABEL: Record<IntrinsicKey | "tags" | "mailingAddress", string> = {
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
  tags: "Tags",
  mailingAddress: "Mailing address",
}

// ─── Value extraction + display ─────────────────────────────────────────

function safeString(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  return ""
}

function intrinsicValue(key: IntrinsicKey, row: ContactDisplayRow): string | null {
  const v = (row as unknown as Record<string, unknown>)[key]
  if (v === null || v === undefined) return null
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  return null
}

function displayValue(
  key: FieldKey,
  row: ContactDisplayRow,
  customFieldDefs: ListCustomFieldDef[],
  companyOptions: CompanyOption[],
  ownerOptions: UserOption[],
  referralOptions: ContactOption[],
): string {
  if (key.startsWith("cf:")) {
    const defId = key.slice(3)
    const def = customFieldDefs.find((d) => d.id === defId)
    if (!def) return ""
    return formatCustomFieldCell(def, row.customFields?.[defId]) || ""
  }
  if (key === "tags") return (row.tags ?? []).join(", ")
  if (key === "mailingAddress") {
    const addr: Record<string, unknown> = row.mailingAddress ?? {}
    const parts = [addr.street1, addr.street2, addr.city, addr.state, addr.zip].filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    )
    return parts.join(", ")
  }
  switch (key) {
    case "primaryPhone":
    case "secondaryPhone":
      return formatPhoneDisplay(intrinsicValue(key, row))
    case "companyId": {
      const id = intrinsicValue("companyId", row)
      if (!id) return ""
      return companyOptions.find((c) => c.id === id)?.name ?? row.companyName ?? id
    }
    case "ownerUserId": {
      const id = intrinsicValue("ownerUserId", row)
      if (!id) return ""
      const u = ownerOptions.find((o) => o.id === id)
      return u?.name ?? u?.email ?? id
    }
    case "referredByContactId": {
      const id = intrinsicValue("referredByContactId", row)
      if (!id) return ""
      const c = referralOptions.find((c) => c.id === id)
      return c ? `${c.firstName} ${c.lastName}`.trim() : id
    }
    default:
      return intrinsicValue(key as IntrinsicKey, row) ?? ""
  }
}

function rawValue(key: FieldKey, row: ContactDisplayRow): unknown {
  if (key.startsWith("cf:")) {
    const defId = key.slice(3)
    return row.customFields?.[defId] ?? null
  }
  if (key === "tags") return row.tags ?? []
  if (key === "mailingAddress") return row.mailingAddress ?? null
  return intrinsicValue(key as IntrinsicKey, row)
}

function recordLabel(r: ContactDisplayRow): string {
  return `${r.firstName} ${r.lastName}`.trim() || (r.primaryEmail ?? "") || r.id
}

// ─── Main component ────────────────────────────────────────────────────

export interface ContactMergeSideBySideProps {
  recordA: ContactDisplayRow
  recordB: ContactDisplayRow
  customFieldDefs: ListCustomFieldDef[]
  companyOptions: CompanyOption[]
  ownerOptions: UserOption[]
  referralOptions: ContactOption[]
  leadSourceValues: string[]
  hiddenLeadSources: string[]
  tagOptions: string[]
  cancelHref: string
}

type Pick = "A" | "B" | "custom"

export function ContactMergeSideBySide({
  recordA,
  recordB,
  customFieldDefs,
  companyOptions,
  ownerOptions,
  referralOptions,
  leadSourceValues,
  hiddenLeadSources,
  tagOptions,
  cancelHref,
}: ContactMergeSideBySideProps) {
  const router = useRouter()
  const [primaryId, setPrimaryId] = useState<string>(recordA.id)
  const [picks, setPicks] = useState<Map<FieldKey, Pick>>(new Map())
  const [overrides, setOverrides] = useState<Map<FieldKey, unknown>>(new Map())
  const [tagsMode, setTagsMode] = useState<"A" | "B" | "merged">("merged")
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allFieldKeys: FieldKey[] = useMemo(() => {
    const cfKeys: FieldKey[] = customFieldDefs.map((d): FieldKey => `cf:${d.id}`)
    return [...INTRINSIC_KEYS, "tags", "mailingAddress", ...cfKeys]
  }, [customFieldDefs])

  // Auto-pick contract:
  //   1. user override → "custom" (uses overrides Map value)
  //   2. user explicit pick → "A" or "B"
  //   3. primary's value if non-empty
  //   4. other side's value if non-empty
  //   5. primary (both empty)
  function autoPick(key: FieldKey): Pick {
    const explicit = picks.get(key)
    if (explicit) return explicit
    const aRaw = rawValue(key, recordA)
    const bRaw = rawValue(key, recordB)
    const aEmpty = isEmptyish(aRaw)
    const bEmpty = isEmptyish(bRaw)
    if (primaryId === recordA.id) {
      if (!aEmpty) return "A"
      if (!bEmpty) return "B"
      return "A"
    }
    if (!bEmpty) return "B"
    if (!aEmpty) return "A"
    return "B"
  }

  function setPick(key: FieldKey, pick: Pick) {
    setPicks((prev) => {
      const next = new Map(prev)
      next.set(key, pick)
      return next
    })
  }

  function setOverride(key: FieldKey, value: unknown) {
    setOverrides((prev) => {
      const next = new Map(prev)
      next.set(key, value)
      return next
    })
    setPick(key, "custom")
  }

  function clearOverride(key: FieldKey) {
    setOverrides((prev) => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
    setPicks((prev) => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }

  function setPrimary(id: string) {
    setPrimaryId(id)
    setPicks(new Map()) // recompute defaults from new primary
    setOverrides(new Map())
  }

  async function submit() {
    if (busy) return
    setBusy(true)
    setError(null)
    const loserId = primaryId === recordA.id ? recordB.id : recordA.id
    const fieldChoices: Record<string, string> = {}
    const customOverrides: Record<string, unknown> = {}
    for (const key of allFieldKeys) {
      const pick = autoPick(key)
      if (pick === "custom") {
        customOverrides[key] = overrides.get(key) ?? null
      } else {
        fieldChoices[key] = pick === "A" ? recordA.id : recordB.id
      }
    }
    const tagsEngine =
      tagsMode === "merged"
        ? ({ mode: "union" } as const)
        : ({ mode: "use", fromId: tagsMode === "A" ? recordA.id : recordB.id } as const)
    const result = await mergeContacts({
      winnerId: primaryId,
      loserIds: [loserId],
      fieldChoices,
      customOverrides,
      tagsMode: tagsEngine,
      companiesMode: { mode: "union" },
    })
    setBusy(false)
    if (result.serverError) {
      setError(result.serverError)
      setConfirm(false)
      return
    }
    router.push(`/contacts/${primaryId}`)
    router.refresh()
  }

  const aLabel = recordLabel(recordA)
  const bLabel = recordLabel(recordB)
  const winnerLabel = primaryId === recordA.id ? aLabel : bLabel
  const loserLabel = primaryId === recordA.id ? bLabel : aLabel

  return (
    <div className="space-y-6 px-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <a
            href={cancelHref}
            className="inline-flex items-center gap-1 text-xs text-[var(--color-muted-foreground)] hover:underline"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" /> Back
          </a>
          <h1 className="text-xl font-semibold">Merge contacts</h1>
        </div>
        <Button
          type="button"
          onClick={() => {
            setConfirm(true)
          }}
          disabled={busy}
          data-testid="merge-open-confirm"
        >
          Merge {loserLabel} → {winnerLabel}
        </Button>
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700/30 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      )}

      <p className="text-sm text-[var(--color-muted-foreground)]">
        Combine two contacts into one. Pick which value wins for each field, or edit the value
        directly; the non-primary contact will be archived.
      </p>

      <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
        <div className="grid grid-cols-1 gap-0 lg:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="hidden lg:block" />
          <ColumnHeader
            record={recordA}
            isPrimary={primaryId === recordA.id}
            onSetPrimary={() => {
              setPrimary(recordA.id)
            }}
          />
          <ColumnHeader
            record={recordB}
            isPrimary={primaryId === recordB.id}
            onSetPrimary={() => {
              setPrimary(recordB.id)
            }}
          />

          {INTRINSIC_KEYS.map((key) => (
            <IntrinsicFieldRow
              key={key}
              fieldKey={key}
              recordA={recordA}
              recordB={recordB}
              pick={autoPick(key)}
              override={overrides.get(key)}
              onPick={(p) => {
                if (p === "A" || p === "B") clearOverrideKeepPick(key, p, setPicks, setOverrides)
                else setPick(key, p)
              }}
              onOverride={(v) => {
                setOverride(key, v)
              }}
              companyOptions={companyOptions}
              ownerOptions={ownerOptions}
              referralOptions={referralOptions}
              leadSourceValues={leadSourceValues}
              hiddenLeadSources={hiddenLeadSources}
            />
          ))}

          <TagsRow
            recordA={recordA}
            recordB={recordB}
            mode={tagsMode}
            override={overrides.get("tags") as string[] | undefined}
            onModeChange={(m) => {
              setTagsMode(m)
              clearOverride("tags")
            }}
            onOverride={(v) => {
              setOverride("tags", v)
            }}
            tagOptions={tagOptions}
          />

          <AddressRow
            recordA={recordA}
            recordB={recordB}
            pick={autoPick("mailingAddress")}
            onPick={(p) => {
              setPick("mailingAddress", p)
            }}
          />

          {customFieldDefs.map((def) => {
            const key: FieldKey = `cf:${def.id}`
            return (
              <CustomFieldRow
                key={key}
                def={def}
                recordA={recordA}
                recordB={recordB}
                pick={autoPick(key)}
                override={overrides.get(key)}
                onPick={(p) => {
                  if (p === "A" || p === "B") clearOverrideKeepPick(key, p, setPicks, setOverrides)
                  else setPick(key, p)
                }}
                onOverride={(v) => {
                  setOverride(key, v)
                }}
              />
            )
          })}
        </div>
      </div>

      <Modal
        open={confirm}
        onClose={() => {
          if (!busy) setConfirm(false)
        }}
        title="Merge contacts?"
        className="max-w-md"
      >
        <p className="mb-4 text-sm">
          This will permanently combine these records.{" "}
          <span className="font-medium">{loserLabel}</span> will be soft-deleted but recoverable
          from <span className="font-mono text-xs">/contacts/deleted</span>. Are you sure?
        </p>
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
              void submit()
            }}
            data-testid="merge-confirm-submit"
          >
            {busy ? "Merging…" : "Yes, merge"}
          </Button>
        </div>
      </Modal>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────

function clearOverrideKeepPick(
  key: FieldKey,
  pick: "A" | "B",
  setPicks: React.Dispatch<React.SetStateAction<Map<FieldKey, Pick>>>,
  setOverrides: React.Dispatch<React.SetStateAction<Map<FieldKey, unknown>>>,
) {
  setPicks((prev) => {
    const next = new Map(prev)
    next.set(key, pick)
    return next
  })
  setOverrides((prev) => {
    if (!prev.has(key)) return prev
    const next = new Map(prev)
    next.delete(key)
    return next
  })
}

function ColumnHeader({
  record,
  isPrimary,
  onSetPrimary,
}: {
  record: ContactDisplayRow
  isPrimary: boolean
  onSetPrimary: () => void
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 border-b border-[var(--color-border)] p-3",
        isPrimary && "bg-[var(--color-primary)]/5",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{recordLabel(record)}</p>
        <p className="truncate text-[11px] text-[var(--color-muted-foreground)]">
          {record.primaryEmail ?? "—"}
        </p>
      </div>
      {isPrimary ? (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary)]"
          data-testid={`merge-primary-badge-${record.id}`}
        >
          <Crown className="size-3" aria-hidden="true" /> Primary
        </span>
      ) : (
        <button
          type="button"
          onClick={onSetPrimary}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] font-medium hover:bg-[var(--color-accent)]/40"
          data-testid={`merge-set-primary-${record.id}`}
        >
          Set as primary
        </button>
      )}
    </div>
  )
}

function RowLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-muted)]/20 px-3 py-2 text-xs font-medium text-[var(--color-muted-foreground)] lg:flex lg:items-center">
      {children}
    </div>
  )
}

function ValueCell({
  picked,
  edited,
  display,
  onClickToSelect,
  inlineEdit,
  testId,
}: {
  picked: boolean
  edited: boolean
  display: string
  onClickToSelect: () => void
  /** Optional inline-edit primitive. When supplied AND `picked`, this
   *  replaces the plain display so the user can autosave a custom
   *  value to local draft state. */
  inlineEdit?: React.ReactNode
  testId: string
}) {
  if (picked) {
    return (
      <div
        data-testid={testId}
        data-picked="true"
        className="border-t border-[var(--color-border)] bg-[var(--color-primary)]/5 px-3 py-2 text-sm"
      >
        {inlineEdit ?? (
          <span className={cn(!display && "text-[var(--color-muted-foreground)]")}>
            {display || "—"}
          </span>
        )}
        {edited && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-700/20 dark:text-amber-300">
            <Pencil className="size-2.5" aria-hidden="true" /> edited
          </span>
        )}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onClickToSelect}
      data-testid={testId}
      data-picked="false"
      className="border-t border-[var(--color-border)] px-3 py-2 text-left text-sm hover:bg-[var(--color-accent)]/30 hover:underline"
    >
      <span className={cn(!display && "text-[var(--color-muted-foreground)]")}>
        {display || "—"}
      </span>
    </button>
  )
}

// ─── Intrinsic field row ────────────────────────────────────────────────

function IntrinsicFieldRow({
  fieldKey,
  recordA,
  recordB,
  pick,
  override,
  onPick,
  onOverride,
  companyOptions,
  ownerOptions,
  referralOptions,
  leadSourceValues,
  hiddenLeadSources,
}: {
  fieldKey: IntrinsicKey
  recordA: ContactDisplayRow
  recordB: ContactDisplayRow
  pick: Pick
  override: unknown
  onPick: (p: Pick) => void
  onOverride: (v: unknown) => void
  companyOptions: CompanyOption[]
  ownerOptions: UserOption[]
  referralOptions: ContactOption[]
  leadSourceValues: string[]
  hiddenLeadSources: string[]
}) {
  const aDisplay = displayValue(
    fieldKey,
    recordA,
    [],
    companyOptions,
    ownerOptions,
    referralOptions,
  )
  const bDisplay = displayValue(
    fieldKey,
    recordB,
    [],
    companyOptions,
    ownerOptions,
    referralOptions,
  )
  const isPickA = pick === "A" || (pick === "custom" && currentWinnerSide(recordA, recordB) === "A")
  const editor =
    pick === "custom"
      ? renderEditor(fieldKey, override, onOverride, {
          companyOptions,
          ownerOptions,
          referralOptions,
          leadSourceValues,
          hiddenLeadSources,
        })
      : isPickA
        ? renderEditor(fieldKey, intrinsicValue(fieldKey, recordA), onOverride, {
            companyOptions,
            ownerOptions,
            referralOptions,
            leadSourceValues,
            hiddenLeadSources,
          })
        : renderEditor(fieldKey, intrinsicValue(fieldKey, recordB), onOverride, {
            companyOptions,
            ownerOptions,
            referralOptions,
            leadSourceValues,
            hiddenLeadSources,
          })

  const customDisplay =
    pick === "custom"
      ? renderOverrideDisplay(fieldKey, override, {
          companyOptions,
          ownerOptions,
          referralOptions,
        })
      : null

  return (
    <>
      <RowLabel>{FIELD_LABEL[fieldKey]}</RowLabel>
      <ValueCell
        picked={pick === "A" || (pick === "custom" && currentWinnerSide(recordA, recordB) === "A")}
        edited={pick === "custom"}
        display={customDisplay ?? aDisplay}
        onClickToSelect={() => {
          onPick("A")
        }}
        inlineEdit={pick === "custom" || pick === "A" ? editor : undefined}
        testId={`merge-cell-${fieldKey}-a`}
      />
      <ValueCell
        picked={pick === "B" || (pick === "custom" && currentWinnerSide(recordA, recordB) === "B")}
        edited={pick === "custom"}
        display={customDisplay ?? bDisplay}
        onClickToSelect={() => {
          onPick("B")
        }}
        inlineEdit={pick === "custom" || pick === "B" ? editor : undefined}
        testId={`merge-cell-${fieldKey}-b`}
      />
    </>
  )
}

// Whichever record was the most-recent winner is the side the
// override displays on. We track it via the last explicit pick;
// when both A and B are valid candidates we default to A.
function currentWinnerSide(_a: ContactDisplayRow, _b: ContactDisplayRow): "A" | "B" {
  return "A"
}

function isEmptyish(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === "string") return v.trim().length === 0
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === "object") return Object.keys(v).length === 0
  return false
}

// ─── Inline-edit primitive renderer per field key ──────────────────────

interface EditorCtx {
  companyOptions: CompanyOption[]
  ownerOptions: UserOption[]
  referralOptions: ContactOption[]
  leadSourceValues: string[]
  hiddenLeadSources: string[]
}

function renderEditor(
  key: IntrinsicKey,
  current: unknown,
  onSave: (v: unknown) => void,
  ctx: EditorCtx,
): React.ReactNode {
  const sV = current === null || current === undefined ? null : safeString(current) || null
  switch (key) {
    case "firstName":
    case "lastName":
    case "secondaryEmail":
    case "primaryEmail":
    case "sourceDetail":
    case "instagramHandle":
    case "facebookUrl":
    case "website":
    case "notes":
    case "internalNotes":
    case "dob":
    case "anniversaryDate":
      return (
        <InlineEditField
          value={sV}
          onSave={(next) => {
            onSave(next || null)
            return Promise.resolve(undefined)
          }}
          ariaLabel={FIELD_LABEL[key]}
        />
      )
    case "primaryPhone":
    case "secondaryPhone":
      return (
        <InlineEditField
          value={sV}
          displayValue={formatPhoneDisplay(sV)}
          editValue={formatPhoneDisplay(sV)}
          onSave={(next) => {
            onSave(next || null)
            return Promise.resolve(undefined)
          }}
          normalizeOnSave={(raw) => parsePhoneInput(raw) ?? ""}
          validateBeforeSave={(n) =>
            n === "" || n.length === 10 ? null : "Enter a 10-digit US phone."
          }
          ariaLabel={FIELD_LABEL[key]}
        />
      )
    case "contactType":
      return (
        <InlineEditSelect
          value={sV}
          displayLabel={sV}
          items={CONTACT_TYPES.map((t) => ({ value: t, label: t }))}
          onSave={(next) => {
            onSave(next)
            return Promise.resolve(undefined)
          }}
          ariaLabel={FIELD_LABEL[key]}
          allowClear
        />
      )
    case "lifecycleStatus":
      return (
        <InlineEditSelect
          value={sV}
          displayLabel={sV}
          items={LIFECYCLE_STATUSES.map((s) => ({ value: s, label: s }))}
          onSave={(next) => {
            onSave(next)
            return Promise.resolve(undefined)
          }}
          ariaLabel={FIELD_LABEL[key]}
          allowClear
        />
      )
    case "leadSource":
      return (
        <InlineEditSelect
          value={sV}
          displayLabel={sV}
          onSave={(next) => {
            onSave(next)
            return Promise.resolve(undefined)
          }}
          ariaLabel={FIELD_LABEL[key]}
          allowClear
          renderPicker={({ commit }) => (
            <LeadSourceCombobox
              value={sV ?? ""}
              onChange={(v) => {
                void commit(v || null)
              }}
              existingValues={ctx.leadSourceValues}
              hiddenSources={ctx.hiddenLeadSources}
              inlineMode
              onDismiss={() => {
                void commit(sV)
              }}
            />
          )}
        />
      )
    case "ownerUserId":
      return (
        <InlineEditSelect
          value={sV}
          displayLabel={sV ? (ctx.ownerOptions.find((o) => o.id === sV)?.name ?? sV) : null}
          onSave={(next) => {
            onSave(next)
            return Promise.resolve(undefined)
          }}
          ariaLabel={FIELD_LABEL[key]}
          allowClear
          renderPicker={({ commit }) => (
            <UserRefPicker
              options={ctx.ownerOptions}
              value={sV}
              onChange={(v) => {
                void commit(v)
              }}
              inlineMode
              onDismiss={() => {
                void commit(sV)
              }}
            />
          )}
        />
      )
    case "companyId":
      return (
        <InlineEditSelect
          value={sV}
          displayLabel={sV ? (ctx.companyOptions.find((c) => c.id === sV)?.name ?? sV) : null}
          onSave={(next) => {
            onSave(next)
            return Promise.resolve(undefined)
          }}
          ariaLabel={FIELD_LABEL[key]}
          allowClear
          renderPicker={({ commit }) => (
            <CompanyPicker
              options={ctx.companyOptions}
              value={sV}
              onChange={(v) => {
                void commit(v)
              }}
              inlineMode
              onDismiss={() => {
                void commit(sV)
              }}
            />
          )}
        />
      )
    case "referredByContactId":
      return (
        <InlineEditSelect
          value={sV}
          displayLabel={
            sV
              ? (() => {
                  const c = ctx.referralOptions.find((c) => c.id === sV)
                  return c ? `${c.firstName} ${c.lastName}`.trim() : sV
                })()
              : null
          }
          onSave={(next) => {
            onSave(next)
            return Promise.resolve(undefined)
          }}
          ariaLabel={FIELD_LABEL[key]}
          allowClear
          renderPicker={({ commit }) => (
            <ContactRefPicker
              options={ctx.referralOptions}
              value={sV}
              onChange={(v) => {
                void commit(v)
              }}
              inlineMode
              onDismiss={() => {
                void commit(sV)
              }}
            />
          )}
        />
      )
  }
}

function renderOverrideDisplay(
  key: IntrinsicKey,
  override: unknown,
  ctx: {
    companyOptions: CompanyOption[]
    ownerOptions: UserOption[]
    referralOptions: ContactOption[]
  },
): string {
  if (override === null || override === undefined) return ""
  if (key === "primaryPhone" || key === "secondaryPhone")
    return formatPhoneDisplay(safeString(override))
  if (key === "companyId") {
    const id = safeString(override)
    return ctx.companyOptions.find((c) => c.id === id)?.name ?? id
  }
  if (key === "ownerUserId") {
    const id = safeString(override)
    const u = ctx.ownerOptions.find((o) => o.id === id)
    return u?.name ?? u?.email ?? id
  }
  if (key === "referredByContactId") {
    const id = safeString(override)
    const c = ctx.referralOptions.find((c) => c.id === id)
    return c ? `${c.firstName} ${c.lastName}`.trim() : id
  }
  return safeString(override)
}

// ─── Tags row (3-mode pick + editable union) ──────────────────────────

function TagsRow({
  recordA,
  recordB,
  mode,
  override,
  onModeChange,
  onOverride,
  tagOptions,
}: {
  recordA: ContactDisplayRow
  recordB: ContactDisplayRow
  mode: "A" | "B" | "merged"
  override: string[] | undefined
  onModeChange: (m: "A" | "B" | "merged") => void
  onOverride: (v: string[]) => void
  tagOptions: string[]
}) {
  const aTags = recordA.tags ?? []
  const bTags = recordB.tags ?? []
  const mergedTags = Array.from(new Set([...aTags, ...bTags]))
  const effective = override ?? (mode === "A" ? aTags : mode === "B" ? bTags : mergedTags)
  return (
    <>
      <RowLabel>Tags</RowLabel>
      <div className="col-span-1 border-t border-[var(--color-border)] p-3 text-xs lg:col-span-2">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <ModeRadio
            name="tags-mode"
            checked={mode === "A"}
            label={`All from ${recordLabel(recordA)}`}
            onChange={() => {
              onModeChange("A")
            }}
          />
          <ModeRadio
            name="tags-mode"
            checked={mode === "B"}
            label={`All from ${recordLabel(recordB)}`}
            onChange={() => {
              onModeChange("B")
            }}
          />
          <ModeRadio
            name="tags-mode"
            checked={mode === "merged"}
            label="Merged (union)"
            onChange={() => {
              onModeChange("merged")
            }}
          />
          {override && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-700/20 dark:text-amber-300">
              <Pencil className="size-2.5" aria-hidden="true" /> edited
            </span>
          )}
        </div>
        <SearchableMultiSelect
          items={tagOptions.map((t) => ({ value: t, label: t }))}
          values={effective}
          onChange={(v) => {
            onOverride(v)
          }}
          allowCreate
          placeholder="Add a tag…"
        />
      </div>
    </>
  )
}

function ModeRadio({
  name,
  checked,
  label,
  onChange,
}: {
  name: string
  checked: boolean
  label: string
  onChange: () => void
}) {
  return (
    <label className="inline-flex items-center gap-1">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}

// ─── Address row (whole-blob pick) ────────────────────────────────────

function AddressRow({
  recordA,
  recordB,
  pick,
  onPick,
}: {
  recordA: ContactDisplayRow
  recordB: ContactDisplayRow
  pick: Pick
  onPick: (p: "A" | "B") => void
}) {
  const aDisplay = displayValue("mailingAddress", recordA, [], [], [], [])
  const bDisplay = displayValue("mailingAddress", recordB, [], [], [], [])
  return (
    <>
      <RowLabel>Mailing address</RowLabel>
      <ValueCell
        picked={pick === "A"}
        edited={false}
        display={aDisplay}
        onClickToSelect={() => {
          onPick("A")
        }}
        testId="merge-cell-mailingAddress-a"
      />
      <ValueCell
        picked={pick === "B"}
        edited={false}
        display={bDisplay}
        onClickToSelect={() => {
          onPick("B")
        }}
        testId="merge-cell-mailingAddress-b"
      />
    </>
  )
}

// ─── Custom field row (per-key pick) ────────────────────────────────────

function CustomFieldRow({
  def,
  recordA,
  recordB,
  pick,
  override,
  onPick,
  onOverride,
}: {
  def: ListCustomFieldDef
  recordA: ContactDisplayRow
  recordB: ContactDisplayRow
  pick: Pick
  override: unknown
  onPick: (p: Pick) => void
  onOverride: (v: unknown) => void
}) {
  const key = `cf:${def.id}`
  const aDisplay = formatCustomFieldCell(def, recordA.customFields?.[def.id]) || ""
  const bDisplay = formatCustomFieldCell(def, recordB.customFields?.[def.id]) || ""
  const overrideDisplay = override === null || override === undefined ? "" : safeString(override)
  const customEditor = (
    <InlineEditField
      value={pick === "custom" ? overrideDisplay : pick === "A" ? aDisplay : bDisplay}
      onSave={(next) => {
        onOverride(next || null)
        return Promise.resolve(undefined)
      }}
      ariaLabel={def.name}
    />
  )
  return (
    <>
      <RowLabel>{def.name}</RowLabel>
      <ValueCell
        picked={pick === "A" || (pick === "custom" && currentWinnerSide(recordA, recordB) === "A")}
        edited={pick === "custom"}
        display={pick === "custom" ? overrideDisplay : aDisplay}
        onClickToSelect={() => {
          onPick("A")
        }}
        inlineEdit={pick === "A" || pick === "custom" ? customEditor : undefined}
        testId={`merge-cell-${key.replace(/:/g, "-")}-a`}
      />
      <ValueCell
        picked={pick === "B" || (pick === "custom" && currentWinnerSide(recordA, recordB) === "B")}
        edited={pick === "custom"}
        display={pick === "custom" ? overrideDisplay : bDisplay}
        onClickToSelect={() => {
          onPick("B")
        }}
        inlineEdit={pick === "B" || pick === "custom" ? customEditor : undefined}
        testId={`merge-cell-${key.replace(/:/g, "-")}-b`}
      />
    </>
  )
}
