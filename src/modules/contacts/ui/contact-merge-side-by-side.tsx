"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Crown, Pencil, User as UserIcon } from "lucide-react"
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
 * Push 3 (C7 rebuild) — full-record schema-driven merge grid.
 *
 * Replaces the conflicts-only B2 modal AND the prior C7 draft. Builds
 * the approved Copper-style 3-column grid (label | Record A | Record
 * B) with HubSpot-style record headers, primary-drives-column
 * defaulting, Model C inline edit on selected cells (§1), an
 * "Only show fields that differ" toggle, and a flat page-flow with
 * divide-y rows (§2 — no outer card box).
 *
 * Field enumeration is schema-driven:
 *   - Standard fields enumerated from the denylist-filtered contact
 *     surface (firstName … internalNotes + mailingAddress).
 *   - Custom fields enumerated from the active contact custom-field
 *     definitions (one row per def, formatted via the existing
 *     `formatCustomFieldCell` helper).
 *
 * Wire contract: the client resolves every pick + inline edit into a
 * concrete `fieldValues` object before submit (`mergeContacts` engine
 * extension). No pick/winner semantics travel over the wire.
 *
 * Engine side effects (Push 4 B2 + C7 hooks, unchanged):
 *   - UPDATE primary with the final values
 *   - Repoint FKs on contact_notes / call_log / meetings / sms /
 *     opportunities / project_contacts / payment_installments /
 *     contact_company_associations to primary
 *   - Soft-delete the loser
 *   - Bust primary's AI cache (auto-regen on next view via Fix 8)
 *   - Audit log
 *   - Redirect to /contacts/<primaryId>
 *
 * V1 captured upcoming (docs §8):
 *   - 3+ contact merge (multi-way)
 *   - Per-subfield address pick
 *   - Live merged-record preview column
 */

// ─── Field schema (denylist-filtered standard columns) ───────────────

type FieldKind =
  | "text"
  | "multiline"
  | "email"
  | "phone"
  | "url"
  | "date"
  | "selectContactType"
  | "selectLifecycle"
  | "leadSource"
  | "owner"
  | "company"
  | "contactRef"
  | "address"

interface StandardField {
  key: string
  label: string
  kind: FieldKind
}

/**
 * Approved field order — identity/contact, status/ownership, address,
 * relationship/event, notes. Custom fields appended dynamically.
 * Denylist (NOT rendered): id, organizationId, createdBy/updatedBy,
 * deletedAt/deletedBy, archivedAt/archivedBy, mergedRecordIds, all six
 * ai_* cache fields, search/tsv. System dates (createdAt/updatedAt)
 * are read-only — engine preserves oldest createdAt + writes a new
 * updatedAt automatically (out of this grid).
 */
const STANDARD_FIELDS: StandardField[] = [
  // Identity / contact
  { key: "firstName", label: "First name", kind: "text" },
  { key: "lastName", label: "Last name", kind: "text" },
  { key: "primaryEmail", label: "Primary email", kind: "email" },
  { key: "secondaryEmail", label: "Secondary email", kind: "email" },
  { key: "primaryPhone", label: "Primary phone", kind: "phone" },
  { key: "secondaryPhone", label: "Secondary phone", kind: "phone" },
  { key: "instagramHandle", label: "Instagram handle", kind: "text" },
  { key: "instagramUserId", label: "Instagram user ID", kind: "text" },
  { key: "facebookUrl", label: "Facebook", kind: "url" },
  { key: "website", label: "Website", kind: "url" },
  // Status / ownership
  { key: "contactType", label: "Contact type", kind: "selectContactType" },
  { key: "lifecycleStatus", label: "Lifecycle status", kind: "selectLifecycle" },
  { key: "leadSource", label: "Lead source", kind: "leadSource" },
  { key: "sourceDetail", label: "Source detail", kind: "text" },
  { key: "ownerUserId", label: "Owner", kind: "owner" },
  // Address
  { key: "mailingAddress", label: "Mailing address", kind: "address" },
  // Relationship / event
  { key: "companyId", label: "Primary company", kind: "company" },
  { key: "referredByContactId", label: "Referred by", kind: "contactRef" },
  { key: "dob", label: "Birthday", kind: "date" },
  { key: "anniversaryDate", label: "Anniversary", kind: "date" },
  // Notes
  { key: "notes", label: "Notes", kind: "multiline" },
  { key: "internalNotes", label: "Internal notes", kind: "multiline" },
]

// ─── Pure helpers ────────────────────────────────────────────────────

function safeString(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  return ""
}

function rawValue(key: string, row: ContactDisplayRow): unknown {
  if (key === "tags") return row.tags ?? []
  if (key === "mailingAddress") return row.mailingAddress ?? null
  if (key.startsWith("cf:")) {
    const defId = key.slice(3)
    return row.customFields?.[defId] ?? null
  }
  return (row as unknown as Record<string, unknown>)[key] ?? null
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((x, i) => x === b[i])
  }
  if (typeof a === "object" && typeof b === "object" && a && b) {
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }
  return false
}

function isEmptyish(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === "string") return v.trim().length === 0
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === "object") return Object.keys(v).length === 0
  return false
}

function recordLabel(r: ContactDisplayRow): string {
  return `${r.firstName} ${r.lastName}`.trim() || (r.primaryEmail ?? "") || r.id
}

function initials(r: ContactDisplayRow): string {
  const first = r.firstName.trim().charAt(0)
  const last = r.lastName.trim().charAt(0)
  const combined = `${first}${last}`.toUpperCase()
  if (combined) return combined
  return (r.primaryEmail ?? "?").charAt(0).toUpperCase()
}

// ─── Display formatting per field kind ───────────────────────────────

function displayValue(field: StandardField, row: ContactDisplayRow, ctx: EditorCtx): string {
  const v = rawValue(field.key, row)
  switch (field.kind) {
    case "phone":
      return formatPhoneDisplay(safeString(v))
    case "owner": {
      const id = safeString(v)
      if (!id) return ""
      const u = ctx.ownerOptions.find((o) => o.id === id)
      return u?.name ?? u?.email ?? id
    }
    case "company": {
      const id = safeString(v)
      if (!id) return ""
      return ctx.companyOptions.find((c) => c.id === id)?.name ?? row.companyName ?? id
    }
    case "contactRef": {
      const id = safeString(v)
      if (!id) return ""
      const c = ctx.referralOptions.find((c) => c.id === id)
      return c ? `${c.firstName} ${c.lastName}`.trim() : id
    }
    case "address": {
      if (!v || typeof v !== "object") return ""
      const addr = v as Record<string, unknown>
      const parts = [addr.street1, addr.street2, addr.city, addr.state, addr.zip].filter(
        (p): p is string => typeof p === "string" && p.length > 0,
      )
      return parts.join(", ")
    }
    default:
      return safeString(v)
  }
}

// ─── Editor renderer per field kind ──────────────────────────────────

interface EditorCtx {
  companyOptions: CompanyOption[]
  ownerOptions: UserOption[]
  referralOptions: ContactOption[]
  leadSourceValues: string[]
  hiddenLeadSources: string[]
}

function renderEditor(
  field: StandardField,
  current: unknown,
  onSave: (v: unknown) => void,
  ctx: EditorCtx,
): React.ReactNode {
  const sV = current === null || current === undefined ? null : safeString(current) || null
  switch (field.kind) {
    case "text":
    case "multiline":
    case "email":
    case "url":
    case "date":
      return (
        <InlineEditField
          value={sV}
          onSave={(next) => {
            onSave(next || null)
            return Promise.resolve(undefined)
          }}
          ariaLabel={field.label}
        />
      )
    case "phone":
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
          ariaLabel={field.label}
        />
      )
    case "selectContactType":
      return (
        <InlineEditSelect
          value={sV}
          displayLabel={sV}
          items={CONTACT_TYPES.map((t) => ({ value: t, label: t }))}
          onSave={(next) => {
            onSave(next)
            return Promise.resolve(undefined)
          }}
          ariaLabel={field.label}
          allowClear
        />
      )
    case "selectLifecycle":
      return (
        <InlineEditSelect
          value={sV}
          displayLabel={sV}
          items={LIFECYCLE_STATUSES.map((s) => ({ value: s, label: s }))}
          onSave={(next) => {
            onSave(next)
            return Promise.resolve(undefined)
          }}
          ariaLabel={field.label}
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
          ariaLabel={field.label}
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
    case "owner":
      return (
        <InlineEditSelect
          value={sV}
          displayLabel={sV ? (ctx.ownerOptions.find((o) => o.id === sV)?.name ?? sV) : null}
          onSave={(next) => {
            onSave(next)
            return Promise.resolve(undefined)
          }}
          ariaLabel={field.label}
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
    case "company":
      return (
        <InlineEditSelect
          value={sV}
          displayLabel={sV ? (ctx.companyOptions.find((c) => c.id === sV)?.name ?? sV) : null}
          onSave={(next) => {
            onSave(next)
            return Promise.resolve(undefined)
          }}
          ariaLabel={field.label}
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
    case "contactRef":
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
          ariaLabel={field.label}
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
    case "address":
      // V1: address picks are whole-blob from A or B; no inline edit
      // in the grid cell. Per-subfield is captured upcoming.
      return null
  }
}

// ─── Component ────────────────────────────────────────────────────────

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

type Side = "A" | "B"

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
  // Explicit per-row pick. When unset, the row defaults to the
  // primary side (or the non-empty side when primary is empty).
  const [picks, setPicks] = useState<Map<string, Side>>(new Map())
  // Inline-edit overrides. Take precedence over picks.
  const [overrides, setOverrides] = useState<Map<string, unknown>>(new Map())
  // Which row, if any, is currently in inline-edit mode. Clicking a
  // selected cell toggles this.
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [tagsMode, setTagsMode] = useState<"both" | "A" | "B">("both")
  const [companiesMode, setCompaniesMode] = useState<"both" | "A" | "B">("both")
  const [diffOnly, setDiffOnly] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const editorCtx: EditorCtx = {
    companyOptions,
    ownerOptions,
    referralOptions,
    leadSourceValues,
    hiddenLeadSources,
  }

  const allFields: (StandardField | { custom: ListCustomFieldDef })[] = useMemo(() => {
    const cf = customFieldDefs.map((d) => ({ custom: d }))
    return [...STANDARD_FIELDS, ...cf]
  }, [customFieldDefs])

  function effectiveSide(key: string): Side {
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

  function effectiveValue(key: string): unknown {
    if (overrides.has(key)) return overrides.get(key)
    const side = effectiveSide(key)
    return rawValue(key, side === "A" ? recordA : recordB)
  }

  function isEdited(key: string): boolean {
    if (!overrides.has(key)) return false
    const ov = overrides.get(key)
    return !valuesEqual(ov, rawValue(key, recordA)) && !valuesEqual(ov, rawValue(key, recordB))
  }

  function selectSide(key: string, side: Side) {
    setPicks((prev) => {
      const next = new Map(prev)
      next.set(key, side)
      return next
    })
    setOverrides((prev) => {
      if (!prev.has(key)) return prev
      const next = new Map(prev)
      next.delete(key)
      return next
    })
    setEditingKey(null)
  }

  function setOverride(key: string, value: unknown) {
    setOverrides((prev) => {
      const next = new Map(prev)
      next.set(key, value)
      return next
    })
  }

  function setPrimary(id: string) {
    // Approved behavior: flipping primary re-defaults ALL picks to
    // the new primary's column. Inline-edit overrides also clear so
    // the user sees the column-driven defaults.
    setPrimaryId(id)
    setPicks(new Map())
    setOverrides(new Map())
    setEditingKey(null)
  }

  async function submit() {
    if (busy) return
    setBusy(true)
    setError(null)
    const loserId = primaryId === recordA.id ? recordB.id : recordA.id
    const fieldValues: Record<string, unknown> = {}
    // Standard fields.
    for (const f of STANDARD_FIELDS) {
      fieldValues[f.key] = effectiveValue(f.key)
    }
    // Custom fields.
    for (const def of customFieldDefs) {
      fieldValues[`cf:${def.id}`] = effectiveValue(`cf:${def.id}`)
    }
    // Tags + companies remain mode-driven (3-mode radios below grid).
    const tagsEngine =
      tagsMode === "both"
        ? ({ mode: "union" } as const)
        : ({ mode: "use", fromId: tagsMode === "A" ? recordA.id : recordB.id } as const)
    const companiesEngine =
      companiesMode === "both"
        ? ({ mode: "union" } as const)
        : ({
            mode: "use",
            fromId: companiesMode === "A" ? recordA.id : recordB.id,
          } as const)
    const result = await mergeContacts({
      winnerId: primaryId,
      loserIds: [loserId],
      fieldValues,
      tagsMode: tagsEngine,
      companiesMode: companiesEngine,
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
        <div className="flex items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
            <input
              type="checkbox"
              checked={diffOnly}
              onChange={(e) => {
                setDiffOnly(e.target.checked)
              }}
              data-testid="merge-diff-only-toggle"
            />
            Only show fields that differ
          </label>
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
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <p className="text-sm text-[var(--color-muted-foreground)]">
        Pick the value to keep for each field, or click the winning cell to edit it directly. The
        non-primary contact will be archived; their notes, calls, meetings, and other activity will
        move to the primary.
      </p>

      {/* Flat grid — no outer card box, per design system §2. */}
      <div className="grid grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)] gap-x-3">
        {/* Record headers (row 1). */}
        <div />
        <RecordHeader
          record={recordA}
          isPrimary={primaryId === recordA.id}
          onSetPrimary={() => {
            setPrimary(recordA.id)
          }}
        />
        <RecordHeader
          record={recordB}
          isPrimary={primaryId === recordB.id}
          onSetPrimary={() => {
            setPrimary(recordB.id)
          }}
        />

        {/* Field rows (divide-y between rows). */}
        {allFields.map((entry, idx) => {
          if ("custom" in entry) {
            const def = entry.custom
            const key = `cf:${def.id}`
            const aRaw = rawValue(key, recordA)
            const bRaw = rawValue(key, recordB)
            if (diffOnly && valuesEqual(aRaw, bRaw)) return null
            return (
              <CustomFieldRow
                key={key}
                def={def}
                aRaw={aRaw}
                bRaw={bRaw}
                pickedSide={effectiveSide(key)}
                overrideValue={overrides.get(key)}
                edited={isEdited(key)}
                editing={editingKey === key}
                onPickA={() => {
                  if (effectiveSide(key) === "A" && !editingKey) setEditingKey(key)
                  else selectSide(key, "A")
                }}
                onPickB={() => {
                  if (effectiveSide(key) === "B" && !editingKey) setEditingKey(key)
                  else selectSide(key, "B")
                }}
                onOverride={(v) => {
                  setOverride(key, v)
                  setEditingKey(null)
                }}
                onDismissEdit={() => {
                  setEditingKey(null)
                }}
                divider={idx > 0}
              />
            )
          }
          const field = entry
          const aRaw = rawValue(field.key, recordA)
          const bRaw = rawValue(field.key, recordB)
          if (diffOnly && valuesEqual(aRaw, bRaw)) return null
          return (
            <StandardFieldRow
              key={field.key}
              field={field}
              recordA={recordA}
              recordB={recordB}
              pickedSide={effectiveSide(field.key)}
              overrideValue={overrides.get(field.key)}
              edited={isEdited(field.key)}
              editing={editingKey === field.key}
              ctx={editorCtx}
              onPickA={() => {
                if (effectiveSide(field.key) === "A" && !editingKey && field.kind !== "address") {
                  setEditingKey(field.key)
                } else {
                  selectSide(field.key, "A")
                }
              }}
              onPickB={() => {
                if (effectiveSide(field.key) === "B" && !editingKey && field.kind !== "address") {
                  setEditingKey(field.key)
                } else {
                  selectSide(field.key, "B")
                }
              }}
              onOverride={(v) => {
                setOverride(field.key, v)
                setEditingKey(null)
              }}
              onDismissEdit={() => {
                setEditingKey(null)
              }}
              divider={idx > 0}
            />
          )
        })}
      </div>

      {/* Tags + Companies 3-mode sections. */}
      <section className="grid gap-6 md:grid-cols-2">
        <ModeSection
          title="Tags"
          mode={tagsMode}
          onMode={setTagsMode}
          recordA={recordA}
          recordB={recordB}
        >
          <SearchableMultiSelect
            items={tagOptions.map((t) => ({ value: t, label: t }))}
            values={(() => {
              if (tagsMode === "A") return recordA.tags ?? []
              if (tagsMode === "B") return recordB.tags ?? []
              return Array.from(new Set([...(recordA.tags ?? []), ...(recordB.tags ?? [])]))
            })()}
            onChange={() => {
              // Tags are mode-driven only in the grid — bulk edit
              // lands in the activity / detail page after merge.
            }}
            disabled
            placeholder="Tags resolve via mode above"
          />
        </ModeSection>
        <ModeSection
          title="Additional companies (associations)"
          mode={companiesMode}
          onMode={setCompaniesMode}
          recordA={recordA}
          recordB={recordB}
        >
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {companiesMode === "both"
              ? "Union of both records' additional company links."
              : `Use only ${recordLabel(companiesMode === "A" ? recordA : recordB)}'s links.`}
          </p>
        </ModeSection>
      </section>

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
          <span className="font-medium">{loserLabel}</span> will be archived and their activity
          moved to <span className="font-medium">{winnerLabel}</span>. Recoverable from
          <span className="font-mono text-xs"> /contacts/deleted</span>. Are you sure?
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

// ─── Sub-components ──────────────────────────────────────────────────

function RecordHeader({
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
        "flex items-center justify-between gap-2 rounded-lg border-2 bg-[var(--color-card)] p-3",
        isPrimary ? "border-[var(--color-primary)]" : "border-[var(--color-border)]",
      )}
      data-testid={`merge-header-${record.id}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/15 text-xs font-semibold text-[var(--color-primary)]">
          {initials(record) || <UserIcon className="size-4" aria-hidden="true" />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{recordLabel(record)}</p>
          <p className="truncate text-[11px] text-[var(--color-muted-foreground)]">
            {record.primaryEmail ?? "—"}
          </p>
        </div>
      </div>
      {isPrimary ? (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary)]"
          data-testid={`merge-primary-pill-${record.id}`}
        >
          <Crown className="size-3" aria-hidden="true" /> Primary — kept
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

function FieldLabel({ children, divider }: { children: React.ReactNode; divider: boolean }) {
  return (
    <div
      className={cn(
        "self-center py-3 pr-2 text-xs text-[var(--color-muted-foreground)]",
        divider && "border-t border-[var(--color-border)]",
      )}
    >
      {children}
    </div>
  )
}

interface ValueCellProps {
  picked: boolean
  edited: boolean
  display: string
  inlineEdit?: React.ReactNode
  onClick: () => void
  divider: boolean
  disabled?: boolean
  testId: string
}

function ValueCell({
  picked,
  edited,
  display,
  inlineEdit,
  onClick,
  divider,
  disabled,
  testId,
}: ValueCellProps) {
  // Clickable button row. Selected → blue background (info) + filled
  // radio. Inline-edit primitive replaces the display when the host
  // hands one in.
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      data-picked={picked ? "true" : "false"}
      className={cn(
        "group flex items-center gap-2 px-3 py-3 text-left text-sm",
        divider && "border-t border-[var(--color-border)]",
        picked
          ? "bg-[var(--color-info)]/10 ring-1 ring-[var(--color-primary)]/30 ring-inset"
          : "hover:bg-[var(--color-accent)]/30",
        disabled && !picked && "cursor-default opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
          picked
            ? "border-[var(--color-primary)] bg-[var(--color-primary)]"
            : "border-[var(--color-border)] bg-transparent",
        )}
      >
        {picked && <span className="size-1.5 rounded-full bg-white" />}
      </span>
      <span className="min-w-0 flex-1">
        {inlineEdit ?? (
          <span
            className={cn("block truncate", !display && "text-[var(--color-muted-foreground)]")}
          >
            {display || "—"}
          </span>
        )}
      </span>
      {edited && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
          <Pencil className="size-2.5" aria-hidden="true" /> edited
        </span>
      )}
    </button>
  )
}

function StandardFieldRow({
  field,
  recordA,
  recordB,
  pickedSide,
  overrideValue,
  edited,
  editing,
  ctx,
  onPickA,
  onPickB,
  onOverride,
  onDismissEdit,
  divider,
}: {
  field: StandardField
  recordA: ContactDisplayRow
  recordB: ContactDisplayRow
  pickedSide: Side
  overrideValue: unknown
  edited: boolean
  editing: boolean
  ctx: EditorCtx
  onPickA: () => void
  onPickB: () => void
  onOverride: (v: unknown) => void
  onDismissEdit: () => void
  divider: boolean
}) {
  const aPicked = pickedSide === "A"
  const bPicked = pickedSide === "B"
  const aDisplay = displayValue(field, recordA, ctx)
  const bDisplay = displayValue(field, recordB, ctx)
  // When edited, both cells show the overridden value; the picked side
  // still drives which one is highlighted blue.
  const editedDisplay = edited ? safeString(overrideValue) : null
  const showInlineOnSide: Side | null = editing && field.kind !== "address" ? pickedSide : null
  const editorNode =
    showInlineOnSide !== null
      ? renderEditor(
          field,
          overrideValue ?? rawValue(field.key, pickedSide === "A" ? recordA : recordB),
          (v) => {
            onOverride(v)
          },
          ctx,
        )
      : null

  void onDismissEdit // Esc handling lives in InlineEditField; we just close on commit.

  return (
    <>
      <FieldLabel divider={divider}>{field.label}</FieldLabel>
      <ValueCell
        picked={aPicked}
        edited={edited && aPicked}
        display={edited && aPicked ? (editedDisplay ?? aDisplay) : aDisplay}
        inlineEdit={showInlineOnSide === "A" ? editorNode : undefined}
        onClick={onPickA}
        divider={divider}
        testId={`merge-cell-${field.key}-a`}
      />
      <ValueCell
        picked={bPicked}
        edited={edited && bPicked}
        display={edited && bPicked ? (editedDisplay ?? bDisplay) : bDisplay}
        inlineEdit={showInlineOnSide === "B" ? editorNode : undefined}
        onClick={onPickB}
        divider={divider}
        testId={`merge-cell-${field.key}-b`}
      />
    </>
  )
}

function CustomFieldRow({
  def,
  aRaw,
  bRaw,
  pickedSide,
  overrideValue,
  edited,
  editing,
  onPickA,
  onPickB,
  onOverride,
  onDismissEdit,
  divider,
}: {
  def: ListCustomFieldDef
  aRaw: unknown
  bRaw: unknown
  pickedSide: Side
  overrideValue: unknown
  edited: boolean
  editing: boolean
  onPickA: () => void
  onPickB: () => void
  onOverride: (v: unknown) => void
  onDismissEdit: () => void
  divider: boolean
}) {
  const aDisplay = formatCustomFieldCell(def, aRaw) || ""
  const bDisplay = formatCustomFieldCell(def, bRaw) || ""
  const aPicked = pickedSide === "A"
  const bPicked = pickedSide === "B"
  // Custom-field inline edit V1: plain text input. The 19-type field
  // engine has rich editors elsewhere — surfacing those here would
  // double the surface area; text-edit is good enough for the
  // typo-fix use case (full-fidelity edit is V1.5 alongside the
  // multi-way merge work).
  const editorNode = editing ? (
    <InlineEditField
      value={safeString(overrideValue ?? (pickedSide === "A" ? aRaw : bRaw))}
      onSave={(next) => {
        onOverride(next || null)
        return Promise.resolve(undefined)
      }}
      ariaLabel={def.name}
    />
  ) : undefined

  void onDismissEdit

  return (
    <>
      <FieldLabel divider={divider}>{def.name}</FieldLabel>
      <ValueCell
        picked={aPicked}
        edited={edited && aPicked}
        display={edited && aPicked ? safeString(overrideValue) : aDisplay}
        inlineEdit={editing && pickedSide === "A" ? editorNode : undefined}
        onClick={onPickA}
        divider={divider}
        testId={`merge-cell-cf-${def.id}-a`}
      />
      <ValueCell
        picked={bPicked}
        edited={edited && bPicked}
        display={edited && bPicked ? safeString(overrideValue) : bDisplay}
        inlineEdit={editing && pickedSide === "B" ? editorNode : undefined}
        onClick={onPickB}
        divider={divider}
        testId={`merge-cell-cf-${def.id}-b`}
      />
    </>
  )
}

function ModeSection({
  title,
  mode,
  onMode,
  recordA,
  recordB,
  children,
}: {
  title: string
  mode: "both" | "A" | "B"
  onMode: (m: "both" | "A" | "B") => void
  recordA: ContactDisplayRow
  recordB: ContactDisplayRow
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="flex flex-wrap gap-3 text-xs">
        <label className="inline-flex items-center gap-1">
          <input
            type="radio"
            checked={mode === "both"}
            onChange={() => {
              onMode("both")
            }}
          />
          Keep all from both
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="radio"
            checked={mode === "A"}
            onChange={() => {
              onMode("A")
            }}
          />
          {recordLabel(recordA)} only
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="radio"
            checked={mode === "B"}
            onChange={() => {
              onMode("B")
            }}
          />
          {recordLabel(recordB)} only
        </label>
      </div>
      <div>{children}</div>
    </section>
  )
}
