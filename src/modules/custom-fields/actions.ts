"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { z } from "zod"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { customFieldDefinitions } from "./schema"
import { customFieldDefinitionInput } from "./types"

/**
 * CRUD orgActions for custom_field_definitions, backing the
 * /settings/custom-fields admin page that lands in P4.2 push 4.
 *
 * All four mutations require `manage_settings` (gated at the UI layer
 * for V1). Soft-delete on the definition is supported so a UI mistake
 * can be undone before the purge cron sweeps deletes.
 *
 * NOTE for future module commits (P4.3 events, P4.5 tasks, etc.):
 * each module's UI commit MUST add its own object_type section to the
 * /settings/custom-fields page (e.g., "Project custom fields", "Task
 * custom fields"). This page is the per-object-type registry; do not
 * let the section get lost when you ship a new module.
 */

const createInput = customFieldDefinitionInput
const updateInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  options: z
    .object({
      choices: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
    })
    .strict()
    .optional()
    .nullable(),
  folder: z.string().max(120).nullable().optional(),
  order: z.number().int().nonnegative().optional(),
  required: z.boolean().optional(),
  formula: z.string().max(2000).nullable().optional(),
  // fieldType and recordType are immutable post-create — changing them
  // would break any rows whose custom_fields jsonb already references
  // the definition.
})
const idInput = z.object({ id: z.string().min(1) })

export const createFieldDefinition = orgAction
  .metadata({ actionName: "custom_field_definitions.create" })
  .inputSchema(createInput)
  .action(async ({ parsedInput, ctx }) => {
    const id = createId()
    try {
      await ctx.db.insert(customFieldDefinitions).values({
        id,
        organizationId: ctx.activeOrg.id,
        recordType: parsedInput.recordType,
        name: parsedInput.name,
        fieldType: parsedInput.fieldType,
        options: parsedInput.options ?? null,
        folder: parsedInput.folder ?? null,
        order: parsedInput.order,
        required: parsedInput.required,
        formula: parsedInput.formula ?? null,
        createdBy: ctx.session.user.id,
        updatedBy: ctx.session.user.id,
      })
    } catch (err) {
      if (err instanceof Error && /duplicate key/i.test(err.message)) {
        throw new ActionError(
          "VALIDATION",
          `A custom field named "${parsedInput.name}" already exists for ${parsedInput.recordType}.`,
        )
      }
      throw err
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "custom_field_definitions.created",
      {
        resourceType: "custom_field_definition",
        resourceId: id,
        metadata: { recordType: parsedInput.recordType, fieldType: parsedInput.fieldType },
      },
    )
    revalidatePath("/settings/custom-fields")
    return { id }
  })

export const updateFieldDefinition = orgAction
  .metadata({ actionName: "custom_field_definitions.update" })
  .inputSchema(updateInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: ctx.session.user.id,
    }
    if (rest.name !== undefined) patch.name = rest.name
    if (rest.options !== undefined) patch.options = rest.options
    if (rest.folder !== undefined) patch.folder = rest.folder
    if (rest.order !== undefined) patch.order = rest.order
    if (rest.required !== undefined) patch.required = rest.required
    if (rest.formula !== undefined) patch.formula = rest.formula

    const result = await ctx.db
      .update(customFieldDefinitions)
      .set(patch)
      .where(
        and(
          eq(customFieldDefinitions.id, id),
          eq(customFieldDefinitions.organizationId, ctx.activeOrg.id),
          isNull(customFieldDefinitions.deletedAt),
        ),
      )
      .returning({ id: customFieldDefinitions.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Custom field definition not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "custom_field_definitions.updated",
      { resourceType: "custom_field_definition", resourceId: id },
    )
    revalidatePath("/settings/custom-fields")
    return { id }
  })

export const deleteFieldDefinition = orgAction
  .metadata({ actionName: "custom_field_definitions.delete" })
  .inputSchema(idInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(customFieldDefinitions)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(customFieldDefinitions.id, parsedInput.id),
          eq(customFieldDefinitions.organizationId, ctx.activeOrg.id),
          isNull(customFieldDefinitions.deletedAt),
        ),
      )
      .returning({ id: customFieldDefinitions.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Custom field definition not found or already deleted")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "custom_field_definitions.deleted",
      { resourceType: "custom_field_definition", resourceId: parsedInput.id },
    )
    revalidatePath("/settings/custom-fields")
    return { id: parsedInput.id }
  })

export const restoreFieldDefinition = orgAction
  .metadata({ actionName: "custom_field_definitions.restore" })
  .inputSchema(idInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(customFieldDefinitions)
      .set({ deletedAt: null, deletedBy: null })
      .where(
        and(
          eq(customFieldDefinitions.id, parsedInput.id),
          eq(customFieldDefinitions.organizationId, ctx.activeOrg.id),
          isNotNull(customFieldDefinitions.deletedAt),
        ),
      )
      .returning({ id: customFieldDefinitions.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Deleted custom field definition not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "custom_field_definitions.restored",
      { resourceType: "custom_field_definition", resourceId: parsedInput.id },
    )
    revalidatePath("/settings/custom-fields")
    return { id: parsedInput.id }
  })
