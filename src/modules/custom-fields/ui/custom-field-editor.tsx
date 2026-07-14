"use client"

import { useState, type ChangeEvent, type SyntheticEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Modal } from "@/components/ui/modal"
import { type FieldType } from "../types"
import type { CustomFieldDefinition } from "../schema"
import { createFieldDefinition, updateFieldDefinition } from "../actions"

/**
 * Modal for creating / editing a custom field definition. All 19 V1
 * field types are exposed; they're grouped logically in the type
 * dropdown so the dense list is scannable:
 *
 *   Basic        : text, multiline, number, currency, date, datetime,
 *                  email, phone, url, checkbox
 *   Choice       : single_select, multi_select, radio
 *   File         : file, image
 *   Reference    : user_ref, contact_ref, event_ref
 *   Computed     : formula
 *
 * Type and recordType are IMMUTABLE on edit per actions.ts (changing
 * either would orphan jsonb values on host rows).
 *
 * For select-style types (single_select / multi_select / radio) we
 * surface a simple options editor — one row per choice with the
 * "label / value" pair. Both default to the same string until the
 * user edits one independently.
 *
 * For formula type we surface a text area for the expression. The
 * evaluator is deferred (per types.ts), so this just stores the
 * source.
 */
const TYPE_GROUPS: { label: string; types: readonly FieldType[] }[] = [
  {
    label: "Basic",
    types: [
      "text",
      "multiline",
      "number",
      "currency",
      "date",
      "datetime",
      "email",
      "phone",
      "url",
      "checkbox",
    ],
  },
  { label: "Choice", types: ["single_select", "multi_select", "radio"] },
  { label: "File", types: ["file", "image"] },
  { label: "Reference", types: ["user_ref", "contact_ref", "event_ref"] },
  { label: "Computed", types: ["formula"] },
]

function typeNeedsChoices(t: FieldType): boolean {
  return t === "single_select" || t === "multi_select" || t === "radio"
}

interface Choice {
  value: string
  label: string
}

export function CustomFieldEditor({
  open,
  recordType,
  recordTypeLabel,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean
  recordType: string
  recordTypeLabel: string
  initial: CustomFieldDefinition | null
  onClose: () => void
  onSaved: () => void
}) {
  if (!open) return null
  return (
    <CustomFieldEditorForm
      key={initial?.id ?? "new"}
      recordType={recordType}
      recordTypeLabel={recordTypeLabel}
      initial={initial}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
}

function CustomFieldEditorForm({
  recordType,
  recordTypeLabel,
  initial,
  onClose,
  onSaved,
}: {
  recordType: string
  recordTypeLabel: string
  initial: CustomFieldDefinition | null
  onClose: () => void
  onSaved: () => void
}) {
  const editing = initial !== null
  const [name, setName] = useState(initial?.name ?? "")
  const [fieldType, setFieldType] = useState<FieldType>(
    (initial?.fieldType as FieldType | undefined) ?? "text",
  )
  const [required, setRequired] = useState(initial?.required ?? false)
  const [folder, setFolder] = useState(initial?.folder ?? "")
  const [formula, setFormula] = useState(initial?.formula ?? "")
  const [choices, setChoices] = useState<Choice[]>(() => {
    const opts = initial?.options as { choices?: Choice[] } | null | undefined
    return opts?.choices?.map((c) => ({ value: c.value, label: c.label })) ?? []
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addChoice() {
    setChoices((prev) => [...prev, { value: "", label: "" }])
  }

  function updateChoice(idx: number, patch: Partial<Choice>) {
    setChoices((prev) =>
      prev.map((c, i) => {
        if (i !== idx) return c
        const next = { ...c, ...patch }
        if (patch.label !== undefined && c.value === c.label) {
          next.value = patch.label
        }
        return next
      }),
    )
  }

  function removeChoice(idx: number) {
    setChoices((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSubmit(e: SyntheticEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    const trimmedName = name.trim()
    if (trimmedName.length === 0) {
      setError("Name is required")
      setBusy(false)
      return
    }

    const optionsPayload =
      typeNeedsChoices(fieldType) && choices.length > 0
        ? { choices: choices.map((c) => ({ value: c.value || c.label, label: c.label })) }
        : null

    if (initial !== null) {
      const result = await updateFieldDefinition({
        id: initial.id,
        name: trimmedName,
        options: optionsPayload,
        folder: folder.trim() === "" ? null : folder.trim(),
        required,
        formula: fieldType === "formula" ? formula : null,
      })
      setBusy(false)
      if (result.serverError) {
        setError(result.serverError)
        return
      }
      if (result.validationErrors) {
        setError(formatValidationErrors(result.validationErrors))
        return
      }
      onSaved()
      return
    }

    const result = await createFieldDefinition({
      recordType,
      name: trimmedName,
      fieldType,
      options: optionsPayload,
      folder: folder.trim() === "" ? null : folder.trim(),
      order: 0,
      required,
      formula: fieldType === "formula" ? formula : null,
    })
    setBusy(false)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    if (result.validationErrors) {
      setError(formatValidationErrors(result.validationErrors))
      return
    }
    onSaved()
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose()
      }}
      title={editing ? "Edit custom field" : `New ${recordTypeLabel.toLowerCase()} custom field`}
      className="max-w-lg"
    >
      <form className="space-y-4" onSubmit={(e) => void handleSubmit(e)}>
        {error && (
          <div className="rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 p-3 text-sm text-[var(--color-destructive)]">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="cf-editor-name">Name</Label>
          <Input
            id="cf-editor-name"
            value={name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setName(e.target.value)
            }}
            placeholder="e.g. Allergies"
            required
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cf-editor-type">Type</Label>
          <select
            id="cf-editor-type"
            value={fieldType}
            disabled={editing}
            onChange={(e) => {
              setFieldType(e.target.value as FieldType)
            }}
            className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {TYPE_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.types.map((t) => (
                  <option key={t} value={t}>
                    {humanType(t)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {editing && (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Type can&apos;t be changed once a field is created.
            </p>
          )}
        </div>

        {typeNeedsChoices(fieldType) && (
          <div className="space-y-2">
            <Label>Choices</Label>
            <div className="space-y-2">
              {choices.map((c, idx) => (
                <div key={idx} className="flex gap-2">
                  <Input
                    aria-label={`Choice ${String(idx + 1)} label`}
                    value={c.label}
                    placeholder="Label"
                    onChange={(e) => {
                      updateChoice(idx, { label: e.target.value })
                    }}
                  />
                  <Input
                    aria-label={`Choice ${String(idx + 1)} value`}
                    value={c.value}
                    placeholder="Value"
                    onChange={(e) => {
                      updateChoice(idx, { value: e.target.value })
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      removeChoice(idx)
                    }}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addChoice}>
                + Add choice
              </Button>
            </div>
          </div>
        )}

        {fieldType === "formula" && (
          <div className="space-y-2">
            <Label htmlFor="cf-editor-formula">Formula expression</Label>
            <textarea
              id="cf-editor-formula"
              rows={3}
              className="block w-full rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 font-mono text-sm shadow-sm"
              value={formula}
              onChange={(e) => {
                setFormula(e.target.value)
              }}
              placeholder="Formula evaluator ships later — the expression is stored for then."
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="cf-editor-folder">Folder (optional)</Label>
          <Input
            id="cf-editor-folder"
            value={folder}
            onChange={(e) => {
              setFolder(e.target.value)
            }}
            placeholder="Group this field under a section"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => {
              setRequired(e.target.checked)
            }}
          />
          Required
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (!busy) onClose()
            }}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save" : "Create field"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function humanType(t: FieldType): string {
  return t
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ")
}

function formatValidationErrors(v: unknown): string {
  try {
    return `Validation: ${JSON.stringify(v)}`
  } catch {
    return "Validation error"
  }
}
