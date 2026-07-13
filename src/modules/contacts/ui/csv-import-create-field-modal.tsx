"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Modal } from "@/components/ui/modal"
import { createFieldDefinition } from "@/modules/custom-fields/actions"
import { FIELD_TYPES, type FieldType } from "@/modules/custom-fields/types"
import type { ImportCustomFieldDef } from "../import-spec"

/**
 * CSV V2 — inline "Create new custom field" modal for the MapStep.
 *
 * The MapStep's "+ Create new custom field" dropdown option opens
 * this modal anchored to one column. The user gives the field a
 * name + type; on success the host (the wizard) appends the new
 * def to its in-memory list and maps THIS row to cf:<newId>.
 *
 * Scope (intentional restriction)
 * ------------------------------
 * Only the 15 simple types are creatable inline. The 4 types that
 * require additional editor state — single_select, multi_select,
 * radio (need an options list), and formula (needs an expression)
 * — render in the dropdown as DISABLED with a tooltip pointing the
 * user at Settings. Those server-side schemas reject creates without
 * the required extras (`options.choices` / `formula` body), so the
 * inline modal would only ever fail validation for them.
 *
 * Server contract
 * ---------------
 * Calls the existing createFieldDefinition orgAction unchanged. Per
 * the action's own RBAC, only owners + admins can create custom
 * fields; managers/members see a FORBIDDEN error inline and the row
 * stays in its `create_new` pending state so they can pick another
 * resolution (existing field or "Don't import").
 *
 * Failure modes surfaced inline (verbatim from result.serverError):
 *   - FORBIDDEN — RBAC (not owner/admin)
 *   - VALIDATION — duplicate name for this recordType
 *   - CONFLICT — name shadows an intrinsic column (e.g., "Email"
 *     would collide with primary_email)
 *
 * Cancel / close / Esc / backdrop click = no state change. The row
 * stays in `create_new` pending; the wizard's Next button stays
 * disabled until the user resolves the intent another way.
 */

/**
 * The 4 types intentionally disabled in the inline modal. Keep in
 * sync with the custom-fields engine's superRefine: select-style
 * types require options.choices, formula requires a formula body —
 * both rejected by the action's input schema if missing.
 */
const DISABLED_TYPES: ReadonlySet<FieldType> = new Set([
  "single_select",
  "multi_select",
  "radio",
  "formula",
])

const TYPE_LABELS: Record<FieldType, string> = {
  text: "Single-line text",
  multiline: "Multi-line text",
  number: "Number",
  currency: "Currency",
  date: "Date",
  datetime: "Date & time",
  email: "Email",
  phone: "Phone",
  url: "URL",
  single_select: "Single select",
  multi_select: "Multi select",
  radio: "Radio",
  checkbox: "Checkbox (yes / no)",
  file: "File",
  image: "Image",
  user_ref: "User reference",
  contact_ref: "Contact reference",
  event_ref: "Event reference",
  formula: "Formula",
}

const DISABLED_TOOLTIP =
  "Add options in Settings — create select-style or formula fields there, then map the column to them."

export interface CreateFieldOptions {
  /** Suggested initial name — the wizard passes the CSV column header. */
  suggestedName: string
  /** Used in the title block so the user remembers which CSV column
   *  they're creating the field for. */
  columnHeader: string
  /** Where in the field-order to place the new def. Wizard passes
   *  `customFieldDefs.length` so the new field lands at the end. */
  orderHint: number
}

export function CsvImportCreateFieldModal({
  open,
  onClose,
  onCreated,
  options,
}: {
  open: boolean
  onClose: () => void
  /** Fires AFTER the action returns successfully. The wizard appends
   *  the def to its in-memory list, maps the row, clears the
   *  create-new intent, and closes the modal. */
  onCreated: (def: ImportCustomFieldDef) => void
  /** When null, the modal renders nothing (handles SSR + the closed
   *  state without an extra check at the host). */
  options: CreateFieldOptions | null
}) {
  const [name, setName] = useState(options?.suggestedName ?? "")
  const [fieldType, setFieldType] = useState<FieldType>("text")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form when the modal (re-)opens for a different column.
  // Compare-during-render pattern keeps us out of effect-driven
  // setState territory — same idiom SearchableSelect uses for its
  // open/query reset.
  const [prevOptionsKey, setPrevOptionsKey] = useState<string | null>(null)
  const currentKey = options ? `${options.columnHeader}|${String(options.orderHint)}` : null
  if (open && currentKey !== prevOptionsKey) {
    setPrevOptionsKey(currentKey)
    setName(options?.suggestedName ?? "")
    setFieldType("text")
    setError(null)
    setSubmitting(false)
  }
  if (!open && prevOptionsKey !== null) {
    setPrevOptionsKey(null)
  }

  if (!options) return null

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError("Name is required.")
      return
    }
    if (!options) return
    setSubmitting(true)
    setError(null)
    const result = await createFieldDefinition({
      recordType: "contact",
      name: trimmed,
      fieldType,
      // Sensible defaults — Mike's spec:
      //   no folder, order = end of list, not required, no options.
      // Select-types are gated out at the type picker so we never
      // reach this call with a needs-choices type.
      folder: null,
      order: options.orderHint,
      required: false,
    })
    setSubmitting(false)
    if (result.serverError) {
      // Verbatim error surface — the server already produces
      // user-readable copy for FORBIDDEN ("Only owners and admins
      // can manage custom fields."), VALIDATION (duplicate-name),
      // and CONFLICT (intrinsic-name shadow). The user reads it,
      // picks a different resolution OR renames, and retries.
      setError(result.serverError)
      return
    }
    const newId = result.data?.id
    if (!newId) {
      setError("Unexpected response — the field may have been created without an id.")
      return
    }
    // Host appends + maps + clears intent + closes.
    onCreated({
      id: newId,
      name: trimmed,
      fieldType,
      archivedAt: null,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="Create new custom field">
      <div className="space-y-4">
        <p className="text-xs text-[var(--color-muted-foreground)]">
          For CSV column <span className="font-medium">{options.columnHeader}</span>. The new field
          will be added to Contact custom fields.
        </p>

        <div className="space-y-1.5">
          <label
            className="text-xs font-medium text-[var(--color-muted-foreground)]"
            htmlFor="csv-v2-create-field-name"
          >
            Field name
          </label>
          <Input
            id="csv-v2-create-field-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
            }}
            disabled={submitting}
            maxLength={120}
            placeholder="e.g. Allergies"
            data-testid="csv-v2-create-field-name"
          />
        </div>

        <div className="space-y-1.5">
          <label
            className="text-xs font-medium text-[var(--color-muted-foreground)]"
            htmlFor="csv-v2-create-field-type"
          >
            Field type
          </label>
          <select
            id="csv-v2-create-field-type"
            value={fieldType}
            onChange={(e) => {
              setFieldType(e.target.value as FieldType)
            }}
            disabled={submitting}
            data-testid="csv-v2-create-field-type"
            className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm shadow-sm focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none"
          >
            {FIELD_TYPES.map((t) => {
              const isDisabled = DISABLED_TYPES.has(t)
              return (
                <option
                  key={t}
                  value={t}
                  disabled={isDisabled}
                  title={isDisabled ? DISABLED_TOOLTIP : undefined}
                >
                  {TYPE_LABELS[t]}
                  {isDisabled ? " — set up in Settings" : ""}
                </option>
              )
            })}
          </select>
        </div>

        {error && (
          <p
            className="rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 px-3 py-2 text-xs text-[var(--color-destructive)]"
            data-testid="csv-v2-create-field-error"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              void submit()
            }}
            disabled={submitting || name.trim().length === 0}
            data-testid="csv-v2-create-field-submit"
          >
            {submitting ? "Creating…" : "Create field"}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
