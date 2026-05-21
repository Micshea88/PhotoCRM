"use client"

import { useState } from "react"
import { upload } from "@vercel/blob/client"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import type { CustomFieldDefinition } from "../schema"
import type { FieldType } from "../types"

/**
 * Generic renderer for `custom_fields` form input. Given the host's
 * definitions + the current values jsonb, renders one input per field
 * type. Maintains its values internally and propagates the full map
 * up via `onChange` whenever any field changes.
 *
 * Field-type coverage:
 *   - text / multiline / number / currency / date / datetime / email /
 *     phone / url     → native inputs
 *   - single_select / radio                → <select> / radio group
 *   - multi_select                         → checkboxes
 *   - checkbox                             → <input type="checkbox">
 *   - file / image                         → @vercel/blob client upload,
 *                                            stores returned URL as value
 *   - user_ref / contact_ref / event_ref   → free-text ID input (proper
 *                                            pickers ship per-module
 *                                            later — V1 is paste-an-ID)
 *   - formula                              → read-only placeholder
 *                                            (evaluator deferred per
 *                                            validators.ts case "formula")
 *
 * `required` is rendered as a visual asterisk but NOT enforced here —
 * per validators.ts, the host form layer (Zod schema or onSubmit) owns
 * required-checks. Keeping this component free of "what's required"
 * logic lets it be reused across modules without rewiring.
 */
export function CustomFieldsRenderer({
  definitions,
  values,
  onChange,
}: {
  definitions: CustomFieldDefinition[]
  values: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}) {
  function setField(defId: string, value: unknown) {
    if (value === "" || value === null || value === undefined) {
      const { [defId]: _omit, ...rest } = values
      void _omit
      onChange(rest)
      return
    }
    onChange({ ...values, [defId]: value })
  }

  if (definitions.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">
        No custom fields defined yet. Add some in Settings → Custom fields.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {definitions.map((def) => (
        <FieldInput
          key={def.id}
          definition={def}
          value={values[def.id]}
          onChange={(v) => {
            setField(def.id, v)
          }}
        />
      ))}
    </div>
  )
}

function FieldInput({
  definition,
  value,
  onChange,
}: {
  definition: CustomFieldDefinition
  value: unknown
  onChange: (value: unknown) => void
}) {
  const fieldType = definition.fieldType as FieldType
  const inputId = `cf-${definition.id}`
  const label = (
    <Label htmlFor={inputId}>
      {definition.name}
      {definition.required && <span className="text-red-600"> *</span>}
    </Label>
  )

  switch (fieldType) {
    case "text":
      return (
        <div className="space-y-2">
          {label}
          <Input
            id={inputId}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => {
              onChange(e.target.value)
            }}
          />
        </div>
      )

    case "multiline":
      return (
        <div className="space-y-2">
          {label}
          <textarea
            id={inputId}
            rows={4}
            className="block w-full rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => {
              onChange(e.target.value)
            }}
          />
        </div>
      )

    case "number":
    case "currency":
      return (
        <div className="space-y-2">
          {label}
          <Input
            id={inputId}
            type="number"
            step={fieldType === "currency" ? "0.01" : "any"}
            value={typeof value === "number" ? value : ""}
            onChange={(e) => {
              const v = e.target.value
              onChange(v === "" ? null : Number(v))
            }}
          />
        </div>
      )

    case "date":
      return (
        <div className="space-y-2">
          {label}
          <Input
            id={inputId}
            type="date"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => {
              onChange(e.target.value || null)
            }}
          />
        </div>
      )

    case "datetime":
      return (
        <div className="space-y-2">
          {label}
          <Input
            id={inputId}
            type="datetime-local"
            value={typeof value === "string" ? value.replace(/Z$/, "").slice(0, 16) : ""}
            onChange={(e) => {
              if (!e.target.value) {
                onChange(null)
                return
              }
              const iso = new Date(e.target.value).toISOString()
              onChange(iso)
            }}
          />
        </div>
      )

    case "email":
      return (
        <div className="space-y-2">
          {label}
          <Input
            id={inputId}
            type="email"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => {
              onChange(e.target.value)
            }}
          />
        </div>
      )

    case "phone":
      return (
        <div className="space-y-2">
          {label}
          <Input
            id={inputId}
            type="tel"
            placeholder="(555) 123-4567"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => {
              onChange(e.target.value)
            }}
          />
        </div>
      )

    case "url":
      return (
        <div className="space-y-2">
          {label}
          <Input
            id={inputId}
            type="url"
            placeholder="https://"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => {
              onChange(e.target.value)
            }}
          />
        </div>
      )

    case "single_select": {
      const choices = readChoices(definition)
      return (
        <div className="space-y-2">
          {label}
          <select
            id={inputId}
            className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm shadow-sm"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => {
              onChange(e.target.value || null)
            }}
          >
            <option value="">— None —</option>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )
    }

    case "radio": {
      const choices = readChoices(definition)
      return (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            {definition.name}
            {definition.required && <span className="text-red-600"> *</span>}
          </legend>
          <div className="space-y-1">
            {choices.map((c) => (
              <label key={c.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={inputId}
                  value={c.value}
                  checked={value === c.value}
                  onChange={() => {
                    onChange(c.value)
                  }}
                />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>
      )
    }

    case "multi_select": {
      const choices = readChoices(definition)
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            {definition.name}
            {definition.required && <span className="text-red-600"> *</span>}
          </legend>
          <div className="space-y-1">
            {choices.map((c) => {
              const checked = selected.includes(c.value)
              return (
                <label key={c.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...selected, c.value]
                        : selected.filter((v) => v !== c.value)
                      onChange(next.length === 0 ? null : next)
                    }}
                  />
                  {c.label}
                </label>
              )
            })}
          </div>
        </fieldset>
      )
    }

    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            id={inputId}
            type="checkbox"
            checked={value === true}
            onChange={(e) => {
              onChange(e.target.checked)
            }}
          />
          {definition.name}
          {definition.required && <span className="text-red-600"> *</span>}
        </label>
      )

    case "file":
    case "image":
      return (
        <BlobUploadField
          inputId={inputId}
          label={label}
          accept={fieldType === "image" ? "image/png,image/jpeg,image/webp,image/gif" : undefined}
          value={typeof value === "string" ? value : null}
          onChange={onChange}
        />
      )

    case "user_ref":
    case "contact_ref":
    case "event_ref":
      return (
        <div className="space-y-2">
          {label}
          <Input
            id={inputId}
            value={typeof value === "string" ? value : ""}
            placeholder={`Paste a ${fieldType.replace("_ref", "")} id`}
            onChange={(e) => {
              onChange(e.target.value)
            }}
          />
          <p className="text-xs text-[var(--color-muted-foreground)]">
            V1: paste the record id. A proper picker will land later.
          </p>
        </div>
      )

    case "formula":
      return (
        <div className="space-y-2">
          {label}
          <div className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted-foreground)]">
            Computed value — formula evaluator is not yet shipped.
          </div>
        </div>
      )

    default: {
      const exhaustive: never = fieldType
      return <div className="text-sm text-red-600">Unknown field type: {String(exhaustive)}</div>
    }
  }
}

interface Choice {
  value: string
  label: string
}

function readChoices(def: CustomFieldDefinition): Choice[] {
  const options = def.options as { choices?: Choice[] } | null | undefined
  return options?.choices ?? []
}

function BlobUploadField({
  inputId,
  label,
  accept,
  value,
  onChange,
}: {
  inputId: string
  label: React.ReactNode
  accept?: string
  value: string | null
  onChange: (value: unknown) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setBusy(true)
    setError(null)
    try {
      const result = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
      })
      onChange(result.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {label}
      {value && (
        <div className="rounded-md border border-[var(--color-border)] p-2 text-xs">
          <a href={value} target="_blank" rel="noreferrer" className="text-blue-600 underline">
            {value}
          </a>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-2"
            onClick={() => {
              onChange(null)
            }}
          >
            Remove
          </Button>
        </div>
      )}
      <Input
        id={inputId}
        type="file"
        accept={accept}
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />
      {busy && <p className="text-xs text-[var(--color-muted-foreground)]">Uploading…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
