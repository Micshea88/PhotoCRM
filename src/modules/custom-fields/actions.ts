"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { z } from "zod"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { customFieldDefinitions } from "./schema"
import { customFieldDefinitionInput } from "./types"
import { assertNoIntrinsicNameCollision } from "./intrinsic-names"
import type { ExtendedRole } from "@/modules/rbac/types"

/**
 * CRUD orgActions for custom_field_definitions, backing the
 * /settings/custom-fields admin page (Push 4 A2).
 *
 * RBAC: Owner + Admin only (matches the spec for /settings/custom-fields).
 * Manager has `manage_settings` for the broader settings surface but cannot
 * shape per-org schemas — only the elevated roles can. Enforced at the
 * action layer via assertOwnerOrAdmin and at the page layer via redirect.
 *
 * Three definition states:
 *   - active     → visible in host forms, listed in /settings/custom-fields
 *   - archived   → hidden from host forms, listed under "Archived" in
 *                  /settings/custom-fields; existing jsonb values on host
 *                  records are preserved
 *   - deleted    → soft-deleted; eventually hard-purged by the cron
 *
 * NOTE for future module commits (P4.3 events, P4.5 tasks, etc.):
 * each module's UI commit MUST add its own record_type tab to the
 * /settings/custom-fields page (e.g., "Project custom fields", "Task
 * custom fields"). This page is the per-record-type registry; do not
 * let the section get lost when you ship a new module.
 */

function assertOwnerOrAdmin(role: ExtendedRole) {
  if (role !== "owner" && role !== "admin") {
    throw new ActionError("FORBIDDEN", "Only owners and admins can manage custom fields.")
  }
}

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
const reorderInput = z.object({
  recordType: z.string().min(1),
  orderedIds: z.array(z.string().min(1)).min(1).max(500),
})

export const createFieldDefinition = orgAction
  .metadata({ actionName: "custom_field_definitions.create" })
  .inputSchema(createInput)
  .action(async ({ parsedInput, ctx }) => {
    assertOwnerOrAdmin(ctx.activeOrg.role)
    assertNoIntrinsicNameCollision(parsedInput.recordType, parsedInput.name)
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
    assertOwnerOrAdmin(ctx.activeOrg.role)
    const { id, ...rest } = parsedInput

    if (rest.name !== undefined) {
      const [existing] = await ctx.db
        .select({ recordType: customFieldDefinitions.recordType })
        .from(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.id, id),
            eq(customFieldDefinitions.organizationId, ctx.activeOrg.id),
            isNull(customFieldDefinitions.deletedAt),
          ),
        )
        .limit(1)
      if (!existing) {
        throw new ActionError("NOT_FOUND", "Custom field definition not found")
      }
      assertNoIntrinsicNameCollision(existing.recordType, rest.name)
    }

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

    try {
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
    } catch (err) {
      if (err instanceof Error && /duplicate key/i.test(err.message)) {
        throw new ActionError(
          "VALIDATION",
          `A custom field named "${String(rest.name)}" already exists for this entity.`,
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
      "custom_field_definitions.updated",
      { resourceType: "custom_field_definition", resourceId: id },
    )
    revalidatePath("/settings/custom-fields")
    return { id }
  })

export const archiveFieldDefinition = orgAction
  .metadata({ actionName: "custom_field_definitions.archive" })
  .inputSchema(idInput)
  .action(async ({ parsedInput, ctx }) => {
    assertOwnerOrAdmin(ctx.activeOrg.role)
    const result = await ctx.db
      .update(customFieldDefinitions)
      .set({ archivedAt: new Date(), archivedBy: ctx.session.user.id })
      .where(
        and(
          eq(customFieldDefinitions.id, parsedInput.id),
          eq(customFieldDefinitions.organizationId, ctx.activeOrg.id),
          isNull(customFieldDefinitions.deletedAt),
          isNull(customFieldDefinitions.archivedAt),
        ),
      )
      .returning({ id: customFieldDefinitions.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Custom field definition not found or already archived")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "custom_field_definitions.archived",
      { resourceType: "custom_field_definition", resourceId: parsedInput.id },
    )
    revalidatePath("/settings/custom-fields")
    return { id: parsedInput.id }
  })

export const unarchiveFieldDefinition = orgAction
  .metadata({ actionName: "custom_field_definitions.unarchive" })
  .inputSchema(idInput)
  .action(async ({ parsedInput, ctx }) => {
    assertOwnerOrAdmin(ctx.activeOrg.role)
    const result = await ctx.db
      .update(customFieldDefinitions)
      .set({ archivedAt: null, archivedBy: null })
      .where(
        and(
          eq(customFieldDefinitions.id, parsedInput.id),
          eq(customFieldDefinitions.organizationId, ctx.activeOrg.id),
          isNull(customFieldDefinitions.deletedAt),
          isNotNull(customFieldDefinitions.archivedAt),
        ),
      )
      .returning({ id: customFieldDefinitions.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Archived custom field definition not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "custom_field_definitions.unarchived",
      { resourceType: "custom_field_definition", resourceId: parsedInput.id },
    )
    revalidatePath("/settings/custom-fields")
    return { id: parsedInput.id }
  })

export const deleteFieldDefinition = orgAction
  .metadata({ actionName: "custom_field_definitions.delete" })
  .inputSchema(idInput)
  .action(async ({ parsedInput, ctx }) => {
    assertOwnerOrAdmin(ctx.activeOrg.role)
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
    assertOwnerOrAdmin(ctx.activeOrg.role)
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

export const reorderFieldDefinitions = orgAction
  .metadata({ actionName: "custom_field_definitions.reorder" })
  .inputSchema(reorderInput)
  .action(async ({ parsedInput, ctx }) => {
    assertOwnerOrAdmin(ctx.activeOrg.role)
    for (let i = 0; i < parsedInput.orderedIds.length; i++) {
      const defId = parsedInput.orderedIds[i]
      if (!defId) continue
      await ctx.db
        .update(customFieldDefinitions)
        .set({ order: i, updatedAt: new Date(), updatedBy: ctx.session.user.id })
        .where(
          and(
            eq(customFieldDefinitions.id, defId),
            eq(customFieldDefinitions.organizationId, ctx.activeOrg.id),
            eq(customFieldDefinitions.recordType, parsedInput.recordType),
            isNull(customFieldDefinitions.deletedAt),
          ),
        )
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "custom_field_definitions.reordered",
      {
        resourceType: "custom_field_definition",
        metadata: { recordType: parsedInput.recordType, count: parsedInput.orderedIds.length },
      },
    )
    revalidatePath("/settings/custom-fields")
    return { ok: true }
  })
