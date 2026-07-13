"use client"

import { useState, type ReactNode } from "react"
import Image from "next/image"
import { upload } from "@vercel/blob/client"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import type { CustomFieldDefinition } from "../schema"
import type { FieldType } from "../types"
import { UserRefPicker, type UserOption } from "./user-ref-picker"
import { ContactRefPicker, type ContactOption } from "./contact-ref-picker"

/**
 * Generic renderer for `custom_fields` form input AND read-only display.
 *
 * Field-type coverage (edit mode):
 *   - text / multiline / number / currency / date / datetime / email /
 *     phone / url                          → native inputs
 *   - single_select / radio                → <select> / radio group
 *   - multi_select                         → checkboxes
 *   - checkbox                             → <input type="checkbox">
 *   - file / image                         → @vercel/blob client upload,
 *                                            stores returned URL as value
 *   - user_ref                             → UserRefPicker when
 *                                            `userOptions` passed, else
 *                                            paste-an-id text input
 *   - contact_ref                          → ContactRefPicker when
 *                                            `contactOptions` passed, else
 *                                            paste-an-id text input
 *   - event_ref                            → paste-an-id text input
 *                                            (EventRefPicker ships with
 *                                            Events UI push P4.x)
 *   - formula                              → read-only placeholder
 *                                            (evaluator deferred per
 *                                            validators.ts case "formula")
 *
 * Read-only mode (Push 4 A3, built but not yet consumed — Push 3's
 * HubSpot detail rebuild is its first consumer): pass `readOnly={true}`
 * and the same definitions+values to render a label/value pair per
 * field with no inputs. Empty values render as "—". File / image
 * render as anchor / inline thumbnail. user_ref / contact_ref render
 * the option's label (resolved from `userOptions` / `contactOptions`
 * by id) and, if the caller passes `linkRef`, wrap it in a Link.
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
  readOnly = false,
  userOptions,
  contactOptions,
  linkRef,
}: {
  definitions: CustomFieldDefinition[]
  values: Record<string, unknown>
  onChange?: (next: Record<string, unknown>) => void
  readOnly?: boolean
  /** Pre-loaded org members; when supplied, user_ref renders as a picker. */
  userOptions?: UserOption[]
  /** Pre-loaded org contacts; when supplied, contact_ref renders as a picker. */
  contactOptions?: ContactOption[]
  /** Optional link resolver for read-only reference rendering. */
  linkRef?: (kind: "user" | "contact" | "event", id: string) => string | null
}) {
  function setField(defId: string, value: unknown) {
    if (!onChange) return
    if (value === "" || value === null || value === undefined) {
      const { [defId]: _omit, ...rest } = values
      void _omit
      onChange(rest)
      return
    }
    onChange({ ...values, [defId]: value })
  }

  if (definitions.length === 0) {
    if (readOnly) return null
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">
        No custom fields defined yet. Add some in Settings → Custom fields.
      </p>
    )
  }

  if (readOnly) {
    return (
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {definitions.map((def) => (
          <FieldReadOnly
            key={def.id}
            definition={def}
            value={values[def.id]}
            userOptions={userOptions}
            contactOptions={contactOptions}
            linkRef={linkRef}
          />
        ))}
      </dl>
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
          userOptions={userOptions}
          contactOptions={contactOptions}
        />
      ))}
    </div>
  )
}

function FieldInput({
  definition,
  value,
  onChange,
  userOptions,
  contactOptions,
}: {
  definition: CustomFieldDefinition
  value: unknown
  onChange: (value: unknown) => void
  userOptions?: UserOption[]
  contactOptions?: ContactOption[]
}) {
  const fieldType = definition.fieldType as FieldType
  const inputId = `cf-${definition.id}`
  const label = (
    <Label htmlFor={inputId}>
      {definition.name}
      {definition.required && <span className="text-[var(--color-destructive)]"> *</span>}
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
            {definition.required && <span className="text-[var(--color-destructive)]"> *</span>}
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
            {definition.required && <span className="text-[var(--color-destructive)]"> *</span>}
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
          {definition.required && <span className="text-[var(--color-destructive)]"> *</span>}
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
      if (userOptions) {
        return (
          <div className="space-y-2">
            {label}
            <UserRefPicker
              id={inputId}
              options={userOptions}
              value={typeof value === "string" ? value : null}
              onChange={(id) => {
                onChange(id)
              }}
            />
          </div>
        )
      }
      return (
        <div className="space-y-2">
          {label}
          <Input
            id={inputId}
            value={typeof value === "string" ? value : ""}
            placeholder="Paste a user id"
            onChange={(e) => {
              onChange(e.target.value)
            }}
          />
          <p className="text-xs text-[var(--color-muted-foreground)]">
            V1: paste the record id. Pass <code>userOptions</code> for the picker UX.
          </p>
        </div>
      )

    case "contact_ref":
      if (contactOptions) {
        return (
          <div className="space-y-2">
            {label}
            <ContactRefPicker
              id={inputId}
              options={contactOptions}
              value={typeof value === "string" ? value : null}
              onChange={(id) => {
                onChange(id)
              }}
            />
          </div>
        )
      }
      return (
        <div className="space-y-2">
          {label}
          <Input
            id={inputId}
            value={typeof value === "string" ? value : ""}
            placeholder="Paste a contact id"
            onChange={(e) => {
              onChange(e.target.value)
            }}
          />
          <p className="text-xs text-[var(--color-muted-foreground)]">
            V1: paste the record id. Pass <code>contactOptions</code> for the picker UX.
          </p>
        </div>
      )

    case "event_ref":
      // TODO Events UI push (P4.x): swap for EventRefPicker once that
      // module lands. Until then it's a paste-an-id text input.
      return (
        <div className="space-y-2">
          {label}
          <Input
            id={inputId}
            value={typeof value === "string" ? value : ""}
            placeholder="Paste an event id"
            onChange={(e) => {
              onChange(e.target.value)
            }}
          />
          <p className="text-xs text-[var(--color-muted-foreground)]">
            V1: paste the record id. EventRefPicker ships with the Events UI push.
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
      return (
        <div className="text-sm text-[var(--color-destructive)]">
          Unknown field type: {String(exhaustive)}
        </div>
      )
    }
  }
}

function FieldReadOnly({
  definition,
  value,
  userOptions,
  contactOptions,
  linkRef,
}: {
  definition: CustomFieldDefinition
  value: unknown
  userOptions?: UserOption[]
  contactOptions?: ContactOption[]
  linkRef?: (kind: "user" | "contact" | "event", id: string) => string | null
}) {
  const fieldType = definition.fieldType as FieldType
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-[var(--color-muted-foreground)]">
        {definition.name}
      </dt>
      <dd className="text-sm">
        {renderReadOnlyValue(definition, value, fieldType, userOptions, contactOptions, linkRef)}
      </dd>
    </div>
  )
}

const EMPTY = <span className="text-[var(--color-muted-foreground)]">—</span>

function renderReadOnlyValue(
  definition: CustomFieldDefinition,
  value: unknown,
  fieldType: FieldType,
  userOptions: UserOption[] | undefined,
  contactOptions: ContactOption[] | undefined,
  linkRef: ((kind: "user" | "contact" | "event", id: string) => string | null) | undefined,
): ReactNode {
  if (value === null || value === undefined || value === "") return EMPTY

  switch (fieldType) {
    case "text":
    case "multiline":
    case "email":
    case "phone":
      return typeof value === "string" ? value : EMPTY
    case "number":
      return typeof value === "number" ? String(value) : EMPTY
    case "currency":
      if (typeof value !== "number") return EMPTY
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)
    case "date":
      return typeof value === "string" ? value : EMPTY
    case "datetime":
      if (typeof value !== "string") return EMPTY
      try {
        return new Date(value).toLocaleString()
      } catch {
        return value
      }
    case "url":
      if (typeof value !== "string") return EMPTY
      return (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-info)] underline"
        >
          {value}
        </a>
      )
    case "single_select":
    case "radio": {
      if (typeof value !== "string") return EMPTY
      const choices = readChoicesSafe(definition)
      const match = choices.find((c) => c.value === value)
      return match?.label ?? value
    }
    case "multi_select": {
      if (!Array.isArray(value)) return EMPTY
      const choices = readChoicesSafe(definition)
      const labels = (value as string[]).map((v) => {
        const m = choices.find((c) => c.value === v)
        return m?.label ?? v
      })
      return labels.length === 0 ? EMPTY : labels.join(", ")
    }
    case "checkbox":
      return value === true ? "Yes" : "No"
    case "file":
      if (typeof value !== "string") return EMPTY
      return (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-info)] underline"
        >
          Download file
        </a>
      )
    case "image":
      if (typeof value !== "string") return EMPTY
      return (
        <Image
          src={value}
          alt={definition.name}
          width={320}
          height={128}
          unoptimized
          className="max-h-32 w-auto max-w-xs rounded"
        />
      )
    case "user_ref": {
      if (typeof value !== "string") return EMPTY
      const u = userOptions?.find((x) => x.id === value)
      const label = u ? u.name : value
      const href = linkRef?.("user", value)
      return href ? (
        <a href={href} className="text-[var(--color-info)] underline">
          {label}
        </a>
      ) : (
        label
      )
    }
    case "contact_ref": {
      if (typeof value !== "string") return EMPTY
      const c = contactOptions?.find((x) => x.id === value)
      const label = c ? `${c.firstName} ${c.lastName}`.trim() : value
      const href = linkRef?.("contact", value)
      return href ? (
        <a href={href} className="text-[var(--color-info)] underline">
          {label}
        </a>
      ) : (
        label
      )
    }
    case "event_ref": {
      if (typeof value !== "string") return EMPTY
      const href = linkRef?.("event", value)
      return href ? (
        <a href={href} className="text-[var(--color-info)] underline">
          {value}
        </a>
      ) : (
        value
      )
    }
    case "formula":
      // Evaluator deferred. If a computed scalar was written to jsonb
      // already (post-evaluator world), render it; otherwise placeholder.
      if (typeof value === "string" || typeof value === "number") return String(value)
      if (typeof value === "boolean") return value ? "Yes" : "No"
      return <span className="text-[var(--color-muted-foreground)]">(formula)</span>
    default: {
      const exhaustive: never = fieldType
      return (
        <span className="text-[var(--color-destructive)]">
          Unknown field type: {String(exhaustive)}
        </span>
      )
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

function readChoicesSafe(def: CustomFieldDefinition): Choice[] {
  return readChoices(def)
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
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-info)] underline"
          >
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
      {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
    </div>
  )
}
