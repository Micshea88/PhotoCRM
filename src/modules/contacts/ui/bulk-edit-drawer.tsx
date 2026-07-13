"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Mail,
  Phone,
  Tag,
  Type as TypeIcon,
  User as UserIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Drawer } from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select"
import { US_STATE_CODES } from "@/lib/format/us-states"
import { CompanyPicker } from "@/modules/companies/ui/company-picker"
import { UserRefPicker } from "@/modules/custom-fields/ui/user-ref-picker"
import { bulkUpdateContactFields } from "../actions"
import { CONTACT_TYPES, LIFECYCLE_STATUSES, type BulkFieldUpdate } from "../types"
import { LeadSourceCombobox } from "./lead-source-combobox"

/**
 * Push 2c.4 part 2 — Bulk edit drawer.
 *
 * Slide-out drawer triggered from the SelectionBanner. Lets the user
 * edit ANY editable field across the selected contacts. The master
 * list — Basic info / Lead info / Tags / Mailing address — is
 * grouped, searchable, and intentionally redundant with the
 * banner's inline shortcuts (HubSpot's pattern: the shortcuts cover
 * 80% of edits, the drawer is the full catalog).
 *
 * V1 contract: ONE field per drawer session. Pick a field → input
 * appears inline below → enter value → "Apply to N contacts" sends
 * a single bulkUpdateContactFields call. The action's discriminated
 * `update` payload validates the value shape against the chosen
 * field's type.
 *
 * Custom fields (Push 4) hook in by appending field defs to the
 * Tags / Mailing groups — `kind` keys can grow without breaking
 * the contract.
 */

type FieldKind = BulkFieldUpdate["kind"]
type FieldGroup = "Basic info" | "Lead info" | "Tags" | "Mailing address"
type InputType =
  | "text"
  | "email"
  | "phone"
  | "company"
  | "contactType"
  | "lifecycleStatus"
  | "leadSource"
  | "owner"
  | "tags"
  | "state"

interface FieldDef {
  kind: FieldKind
  label: string
  group: FieldGroup
  input: InputType
  /** Set on "Replace all tags" — surfaces a confirm before Apply. */
  destructive?: boolean
}

const FIELDS: FieldDef[] = [
  { kind: "firstName", label: "First name", group: "Basic info", input: "text" },
  { kind: "lastName", label: "Last name", group: "Basic info", input: "text" },
  { kind: "primaryEmail", label: "Primary email", group: "Basic info", input: "email" },
  { kind: "secondaryEmail", label: "Secondary email", group: "Basic info", input: "email" },
  { kind: "primaryPhone", label: "Primary phone", group: "Basic info", input: "phone" },
  { kind: "secondaryPhone", label: "Secondary phone", group: "Basic info", input: "phone" },
  { kind: "companyId", label: "Company", group: "Basic info", input: "company" },

  { kind: "contactType", label: "Type", group: "Lead info", input: "contactType" },
  { kind: "lifecycleStatus", label: "Status", group: "Lead info", input: "lifecycleStatus" },
  { kind: "leadSource", label: "Lead source", group: "Lead info", input: "leadSource" },
  { kind: "ownerUserId", label: "Owner", group: "Lead info", input: "owner" },

  { kind: "tagsAdd", label: "Add tags", group: "Tags", input: "tags" },
  { kind: "tagsRemove", label: "Remove tags", group: "Tags", input: "tags" },
  {
    kind: "tagsReplace",
    label: "Replace all tags",
    group: "Tags",
    input: "tags",
    destructive: true,
  },

  { kind: "mailingStreet", label: "Street", group: "Mailing address", input: "text" },
  { kind: "mailingCity", label: "City", group: "Mailing address", input: "text" },
  { kind: "mailingState", label: "State", group: "Mailing address", input: "state" },
  {
    kind: "mailingPostalCode",
    label: "Zip / Postal code",
    group: "Mailing address",
    input: "text",
  },
]

const GROUP_ORDER: FieldGroup[] = ["Basic info", "Lead info", "Tags", "Mailing address"]

function iconForInput(input: InputType) {
  switch (input) {
    case "text":
      return TypeIcon
    case "email":
      return Mail
    case "phone":
      return Phone
    case "company":
      return Building2
    case "owner":
      return UserIcon
    case "tags":
      return Tag
    case "state":
    case "leadSource":
    case "contactType":
    case "lifecycleStatus":
      return ChevronDown
    default:
      return TypeIcon
  }
}

export interface BulkEditDrawerProps {
  open: boolean
  onClose: () => void
  selectedIds: string[]
  companyOptions: { id: string; name: string }[]
  ownerOptions: { id: string; name: string | null; email: string }[]
  leadSourceOptions: string[]
  /** P3 (C3) — org-level hidden lead sources, filtered from the bulk
   *  Lead source picker. Optional with empty-array default so older
   *  callers (or tests) don't need to pass it. */
  hiddenLeadSources?: string[]
  tagOptions: string[]
  /** Called after a successful Apply so the host can clear selection. */
  onAfterApply: () => void
}

/**
 * Outer wrapper — bails when closed so the inner Body remounts with
 * fresh state on every open. Avoids the lint-flagged setState-in-
 * useEffect pattern for the reset-on-close case.
 */
export function BulkEditDrawer(props: BulkEditDrawerProps) {
  if (!props.open) return null
  return <BulkEditDrawerBody {...props} />
}

function BulkEditDrawerBody({
  open,
  onClose,
  selectedIds,
  companyOptions,
  ownerOptions,
  leadSourceOptions,
  hiddenLeadSources = [],
  tagOptions,
  onAfterApply,
}: BulkEditDrawerProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [selectedField, setSelectedField] = useState<FieldDef | null>(null)
  // Per-field input value. Strings + arrays per input type — narrowed
  // back to the discriminated BulkFieldUpdate shape on Apply.
  const [textValue, setTextValue] = useState("")
  const [tagValues, setTagValues] = useState<string[]>([])
  const [replaceAcked, setReplaceAcked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<FieldGroup>>(new Set())
  // For group-header collapse — start with every group expanded.

  // Debounce search to keep filtering snappy on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query)
    }, 150)
    return () => {
      clearTimeout(t)
    }
  }, [query])

  // Reset value-state when the user picks a different field. This
  // uses the "adjusting state in response to prop change" pattern
  // (React docs) rather than useEffect — runs during render but
  // converges in one pass because it only fires when prevKind
  // actually changes.
  const [prevKind, setPrevKind] = useState<FieldKind | null>(selectedField?.kind ?? null)
  const currentKind = selectedField?.kind ?? null
  if (prevKind !== currentKind) {
    setPrevKind(currentKind)
    setTextValue("")
    setTagValues([])
    setReplaceAcked(false)
  }

  const filteredFields = useMemo(() => {
    if (!debouncedQuery.trim()) return FIELDS
    const q = debouncedQuery.trim().toLowerCase()
    return FIELDS.filter(
      (f) =>
        f.label.toLowerCase().includes(q) ||
        f.group.toLowerCase().includes(q) ||
        f.kind.toLowerCase().includes(q),
    )
  }, [debouncedQuery])

  const groupedFields = useMemo(() => {
    const groups: Record<FieldGroup, FieldDef[]> = {
      "Basic info": [],
      "Lead info": [],
      Tags: [],
      "Mailing address": [],
    }
    for (const f of filteredFields) groups[f.group].push(f)
    return groups
  }, [filteredFields])

  function toggleGroup(g: FieldGroup) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      return next
    })
  }

  // Active search expands all groups so matches are visible.
  const showAllExpanded = debouncedQuery.trim().length > 0

  function canApply(): boolean {
    if (!selectedField || busy) return false
    if (selectedField.input === "tags") {
      if (tagValues.length === 0) {
        // tagsReplace can technically apply an empty array (= clear all
        // tags) but require the confirm checkbox to do so.
        return selectedField.kind === "tagsReplace" && replaceAcked
      }
      if (selectedField.destructive && !replaceAcked) return false
      return true
    }
    // Most fields require a non-empty value. Nullable email/phone/lead
    // source allow empty string ("" → null at the server).
    return textValue.trim().length > 0
  }

  function buildUpdate(): BulkFieldUpdate | null {
    if (!selectedField) return null
    const kind = selectedField.kind
    if (selectedField.input === "tags") {
      if (kind === "tagsAdd" || kind === "tagsRemove" || kind === "tagsReplace") {
        return { kind, value: tagValues }
      }
      return null
    }
    const v = textValue.trim()
    switch (kind) {
      case "firstName":
      case "lastName":
      case "primaryEmail":
      case "secondaryEmail":
      case "primaryPhone":
      case "secondaryPhone":
      case "leadSource":
      case "mailingStreet":
      case "mailingCity":
      case "mailingPostalCode":
        return { kind, value: v }
      case "companyId":
      case "ownerUserId":
        return { kind, value: v === "" ? null : v }
      case "contactType":
        // Trust the dropdown — value comes from the enum.
        return { kind, value: v as (typeof CONTACT_TYPES)[number] }
      case "lifecycleStatus":
        return { kind, value: v as (typeof LIFECYCLE_STATUSES)[number] }
      case "mailingState":
        return { kind, value: v.toUpperCase() }
      default:
        return null
    }
  }

  async function onApply() {
    const update = buildUpdate()
    if (!update) return
    setBusy(true)
    const result = await bulkUpdateContactFields({ ids: selectedIds, update })
    setBusy(false)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    onAfterApply()
    router.refresh()
    onClose()
  }

  const count = selectedIds.length

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Bulk edit — ${String(count)} contact${count === 1 ? "" : "s"} selected`}
      widthClass="w-[480px]"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onApply} disabled={!canApply()}>
            {busy ? "Applying…" : `Apply to ${String(count)} contact${count === 1 ? "" : "s"}`}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
          }}
          placeholder="Search fields..."
          aria-label="Search fields"
        />

        {GROUP_ORDER.map((group) => {
          const items = groupedFields[group]
          if (items.length === 0) return null
          const collapsed = !showAllExpanded && collapsedGroups.has(group)
          return (
            <section key={group} className="rounded-md border border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => {
                  toggleGroup(group)
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium hover:bg-[var(--color-accent)]/30"
                aria-expanded={!collapsed}
              >
                <span>{group}</span>
                {collapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
              {!collapsed && (
                <ul className="border-t border-[var(--color-border)]">
                  {items.map((f) => {
                    const Icon = iconForInput(f.input)
                    const isActive = selectedField?.kind === f.kind
                    return (
                      <li key={f.kind}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedField(isActive ? null : f)
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--color-accent)]/30 ${
                            isActive ? "bg-[var(--color-primary)]/10" : ""
                          }`}
                          aria-expanded={isActive}
                        >
                          <Icon
                            className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]"
                            aria-hidden="true"
                          />
                          <span>{f.label}</span>
                          {f.destructive && (
                            <span className="text-3xs ml-auto text-[var(--color-destructive)]">
                              destructive
                            </span>
                          )}
                        </button>
                        {isActive && (
                          <div className="border-t border-[var(--color-border)] px-3 py-3">
                            <ValueInput
                              field={f}
                              textValue={textValue}
                              onTextChange={setTextValue}
                              tagValues={tagValues}
                              onTagsChange={setTagValues}
                              tagOptions={tagOptions}
                              companyOptions={companyOptions}
                              ownerOptions={ownerOptions}
                              leadSourceOptions={leadSourceOptions}
                              hiddenLeadSources={hiddenLeadSources}
                            />
                            {f.destructive && (
                              <label className="mt-3 flex items-start gap-2 text-xs text-[var(--color-destructive)]">
                                <input
                                  type="checkbox"
                                  checked={replaceAcked}
                                  onChange={(e) => {
                                    setReplaceAcked(e.target.checked)
                                  }}
                                  className="mt-0.5"
                                />
                                <span>
                                  This will replace all existing tags on {String(count)} contact
                                  {count === 1 ? "" : "s"}. I understand.
                                </span>
                              </label>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}

        {filteredFields.length === 0 && (
          <p className="rounded-md border border-dashed border-[var(--color-border)] p-4 text-center text-xs text-[var(--color-muted-foreground)]">
            No fields match &ldquo;{query}&rdquo;.
          </p>
        )}
      </div>
    </Drawer>
  )
}

// ─── Per-field value inputs ─────────────────────────────────────────────

function ValueInput({
  field,
  textValue,
  onTextChange,
  tagValues,
  onTagsChange,
  tagOptions,
  companyOptions,
  ownerOptions,
  leadSourceOptions,
  hiddenLeadSources,
}: {
  field: FieldDef
  textValue: string
  onTextChange: (v: string) => void
  tagValues: string[]
  onTagsChange: (v: string[]) => void
  tagOptions: string[]
  companyOptions: { id: string; name: string }[]
  ownerOptions: { id: string; name: string | null; email: string }[]
  leadSourceOptions: string[]
  hiddenLeadSources: string[]
}) {
  if (field.input === "tags") {
    return (
      <SearchableMultiSelect
        items={tagOptions.map((t) => ({ value: t, label: t }))}
        values={tagValues}
        onChange={onTagsChange}
        placeholder="Add a tag…"
        allowCreate
        aria-label="Tags"
      />
    )
  }
  if (field.input === "contactType") {
    return (
      <SearchableSelect
        items={CONTACT_TYPES.map((t) => ({ value: t, label: t }))}
        value={textValue || null}
        onChange={(v) => {
          onTextChange(v ?? "")
        }}
        placeholder="— Select type —"
        aria-label="Contact type"
      />
    )
  }
  if (field.input === "lifecycleStatus") {
    return (
      <SearchableSelect
        items={LIFECYCLE_STATUSES.map((s) => ({ value: s, label: s }))}
        value={textValue || null}
        onChange={(v) => {
          onTextChange(v ?? "")
        }}
        placeholder="— Select status —"
        aria-label="Lifecycle status"
      />
    )
  }
  if (field.input === "leadSource") {
    return (
      <LeadSourceCombobox
        value={textValue}
        onChange={onTextChange}
        existingValues={leadSourceOptions}
        hiddenSources={hiddenLeadSources}
      />
    )
  }
  if (field.input === "owner") {
    return (
      <UserRefPicker
        options={ownerOptions.map((o) => ({
          id: o.id,
          name: o.name ?? o.email,
          email: o.email,
        }))}
        value={textValue || null}
        onChange={(v) => {
          onTextChange(v ?? "")
        }}
      />
    )
  }
  if (field.input === "company") {
    return (
      <CompanyPicker
        options={companyOptions}
        value={textValue || null}
        onChange={(v) => {
          onTextChange(v ?? "")
        }}
      />
    )
  }
  if (field.input === "state") {
    return (
      <SearchableSelect
        items={US_STATE_CODES.map((s) => ({ value: s, label: s }))}
        value={textValue || null}
        onChange={(v) => {
          onTextChange(v ?? "")
        }}
        placeholder="— Select state —"
        aria-label="State"
      />
    )
  }
  // text / email / phone
  return (
    <Input
      value={textValue}
      onChange={(e) => {
        onTextChange(e.target.value)
      }}
      placeholder={
        field.input === "email"
          ? "name@example.com"
          : field.input === "phone"
            ? "(555) 123-4567"
            : "Enter a value"
      }
      type={field.input === "email" ? "email" : "text"}
      aria-label={field.label}
      maxLength={field.input === "phone" ? 80 : 200}
    />
  )
}
