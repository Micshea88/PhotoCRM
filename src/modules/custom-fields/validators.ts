import { z } from "zod"
import { fieldOptionsSchema, type FieldType } from "./types"
import type { CustomFieldDefinition } from "./schema"

/**
 * Per-host-table value validator. Each `custom_fields jsonb` entry on a
 * host row (contacts, projects, etc.) is keyed by a `custom_field_definitions.id`
 * and carries a value whose shape must match the definition's `field_type`.
 *
 * The 18 V1 field types are validated here against per-type Zod schemas.
 * Select-style types (single_select / multi_select / radio) check the
 * value against `options.choices`. Reference types (user_ref / contact_ref
 * / event_ref) accept any non-empty string — the *existence* of the
 * referenced record is the host module's responsibility to verify if it
 * cares (most don't, since a stale reference rendering as a broken link
 * is recoverable; throwing on write isn't).
 *
 * `formula` fields are read-only: incoming writes throw. The formula
 * evaluator (Phase 4 stretch) owns producing those values.
 *
 * NULL handling: explicit null/undefined values are passed through as
 * null (allowed). If the definition is `required` and the value is null,
 * that's the caller's check — the validator doesn't enforce required
 * (it's a per-form concern).
 *
 * Throws plain Error on validation failure. The host module's action
 * wraps it in an ActionError("VALIDATION") so the client sees a sane
 * error message.
 */

const TEXT_MAX = 2000
const MULTILINE_MAX = 20_000
const URL_MAX = 2000
const FILE_REF_MAX = 2000

interface Choice {
  value: string
  label: string
}

function readChoices(definition: CustomFieldDefinition): string[] {
  const parsed = fieldOptionsSchema.parse(definition.options ?? undefined)
  const choices = parsed?.choices ?? []
  if (choices.length === 0) {
    throw new Error(
      `field "${definition.name}" (${definition.fieldType}) requires options.choices but none defined`,
    )
  }
  return choices.map((c: Choice) => c.value)
}

function inChoices(definition: CustomFieldDefinition, value: unknown): string {
  const s = z.string().parse(value)
  const allowed = readChoices(definition)
  if (!allowed.includes(s)) {
    throw new Error(`field "${definition.name}": value "${s}" is not one of: ${allowed.join(", ")}`)
  }
  return s
}

export function validateCustomFieldValue(
  definition: CustomFieldDefinition,
  value: unknown,
): unknown {
  // Null/undefined is always allowed at this layer. `required` enforcement
  // is the host form / inputSchema's job (e.g., a contact form marks a
  // required field with `.min(1)` before this validator ever runs).
  if (value === null || value === undefined) return null

  const fieldType = definition.fieldType as FieldType

  switch (fieldType) {
    case "text":
      return z.string().max(TEXT_MAX).parse(value)
    case "multiline":
      return z.string().max(MULTILINE_MAX).parse(value)
    case "number":
      return z.number().parse(value)
    case "currency":
      // V1: any finite number. Phase 4 invoices module's payment-schedule
      // engine is the source of integer-cents discipline for money — until
      // then, currency custom-fields are display-only and we don't enforce.
      return z.number().parse(value)
    case "date":
      return z.iso.date().parse(value)
    case "datetime":
      return z.iso.datetime().parse(value)
    case "email":
      return z.email().parse(value)
    case "phone":
      return z.string().max(80).parse(value)
    case "url":
      return z.url().max(URL_MAX).parse(value)
    case "single_select":
    case "radio":
      return inChoices(definition, value)
    case "multi_select": {
      const arr = z.array(z.string()).parse(value)
      const allowed = readChoices(definition)
      const bad = arr.filter((v) => !allowed.includes(v))
      if (bad.length > 0) {
        throw new Error(
          `field "${definition.name}": value(s) ${bad.map((b) => `"${b}"`).join(", ")} not in choices: ${allowed.join(", ")}`,
        )
      }
      return arr
    }
    case "checkbox":
      return z.boolean().parse(value)
    case "file":
    case "image":
      // Stored as a file id / URL. The blob module's upload action is the
      // source of truth for what's accepted; this validator just checks
      // it's a sensible string.
      return z.string().max(FILE_REF_MAX).parse(value)
    case "user_ref":
    case "contact_ref":
    case "event_ref":
      // Referenced record id. Existence not checked here — the host
      // module checks if it cares about referential integrity at write
      // time. A stale ref renders as a broken link, which is recoverable.
      return z.string().min(1).parse(value)
    case "formula":
      throw new Error(
        `field "${definition.name}" is a formula field; values are computed, not written`,
      )
    default: {
      // Exhaustive guard. If a future FieldType ships in types.ts but no
      // case lands here, TypeScript catches it; this branch is for
      // runtime safety against a stale DB row with an unknown field_type.
      const exhaustive: never = fieldType
      throw new Error(`unknown field type: ${String(exhaustive)}`)
    }
  }
}

export interface ValidatePayloadOptions {
  /**
   * Called when a key in the payload has no matching definition — for
   * instance, a definition that was soft-deleted between form render and
   * form submit. The validator drops the key either way; this is a hook
   * for the host module to log the drop with its own infra (pino/Sentry).
   * Kept here as a callback so this file stays free of @/lib/log /
   * @/lib/env imports — important for unit tests in jsdom, which can't
   * load the env-validated logger.
   */
  onUnknownKey?: (defId: string) => void
}

/**
 * Validate every entry in a `custom_fields jsonb` payload against the
 * known definitions for the host's record_type. Returns a NEW object
 * with the validated values — does not mutate the input.
 *
 * Unknown keys (no matching definition id) are DROPPED, not rejected.
 * Rationale: a form might be rendered against one set of definitions,
 * then a sibling admin soft-deletes a definition before the user
 * submits. Dropping the orphan is gentler than failing the entire write
 * — the form is already in an inconsistent state and the user can't
 * recover by retrying. The optional `onUnknownKey` callback fires once
 * per drop for logging.
 *
 * Per-value failures DO throw (with the field name in the message), so
 * a malformed value fails the whole write. The host module's action
 * wraps in ActionError("VALIDATION").
 */
export function validateCustomFieldsPayload(
  definitions: Map<string, CustomFieldDefinition>,
  payload: Record<string, unknown>,
  opts: ValidatePayloadOptions = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [defId, raw] of Object.entries(payload)) {
    const def = definitions.get(defId)
    if (!def) {
      opts.onUnknownKey?.(defId)
      continue
    }
    out[defId] = validateCustomFieldValue(def, raw)
  }
  return out
}
