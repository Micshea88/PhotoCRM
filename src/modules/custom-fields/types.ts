import { z } from "zod"

/**
 * The 18 V1 field types per Requirements §4.3. Stored on
 * `custom_field_definitions.field_type` as text; validated at the
 * application layer via this enum.
 *
 * `formula` is special — its expression lives in
 * `custom_field_definitions.formula` (text), not in `options`. The
 * evaluator is deferred (STEP 2 Q8); storing the source is V1 so future
 * evaluator work is additive, not migration-shaped.
 *
 * `user_ref` / `contact_ref` / `event_ref` store the referenced record's
 * `id` on the host row's `custom_fields jsonb` payload, e.g.
 * `{ "<definition_id>": "<contact_id>" }`. Resolving the reference at
 * read time is a host-module concern.
 */
export const FIELD_TYPES = [
  "text",
  "multiline",
  "number",
  "currency",
  "date",
  "datetime",
  "email",
  "phone",
  "url",
  "single_select",
  "multi_select",
  "radio",
  "checkbox",
  "file",
  "image",
  "user_ref",
  "contact_ref",
  "event_ref",
  "formula",
] as const

export const fieldTypeSchema = z.enum(FIELD_TYPES)
export type FieldType = z.infer<typeof fieldTypeSchema>

/**
 * Shape of `custom_field_definitions.options` for V1. Select-style types
 * carry `choices`; other types currently have no `options` payload. The
 * jsonb column is loose — host code should pull through this schema
 * rather than typing the raw column.
 */
export const fieldOptionsSchema = z
  .object({
    choices: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  })
  .strict()
  .optional()
  .nullable()

export type FieldOptions = z.infer<typeof fieldOptionsSchema>

/**
 * Validated input shape for creating/updating a definition. Used by the
 * future admin-UI server action (Phase 4 Settings module). Today, this
 * just declares the shape — no actions in V1 consume it.
 */
export const customFieldDefinitionInput = z
  .object({
    recordType: z.string().min(1),
    name: z.string().min(1).max(120),
    fieldType: fieldTypeSchema,
    options: fieldOptionsSchema,
    folder: z.string().max(120).optional().nullable(),
    order: z.number().int().nonnegative().default(0),
    required: z.boolean().default(false),
    formula: z.string().max(2000).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    // formula expression only allowed when fieldType is "formula"
    if (data.formula && data.fieldType !== "formula") {
      ctx.addIssue({
        code: "custom",
        path: ["formula"],
        message: "formula is only valid when fieldType is 'formula'",
      })
    }
    if (data.fieldType === "formula" && !data.formula) {
      ctx.addIssue({
        code: "custom",
        path: ["formula"],
        message: "fieldType 'formula' requires a formula expression",
      })
    }
    // choices required for select-style types
    const needsChoices: FieldType[] = ["single_select", "multi_select", "radio"]
    if (needsChoices.includes(data.fieldType) && !data.options?.choices?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["options", "choices"],
        message: `fieldType '${data.fieldType}' requires options.choices`,
      })
    }
  })

export type CustomFieldDefinitionInput = z.infer<typeof customFieldDefinitionInput>
