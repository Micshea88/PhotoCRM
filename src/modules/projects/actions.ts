"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import type * as schema from "@/db/schema"
import { contacts } from "@/modules/contacts/schema"
import { member } from "@/modules/auth/schema"
import {
  prepareCustomFieldsForCreate,
  prepareCustomFieldsForUpdate,
} from "@/modules/custom-fields/host-helpers"
import type { CustomFieldChange } from "@/modules/custom-fields/changes"
import { projects, projectContacts, projectPhotographers, projectSubEvents } from "./schema"
import {
  instantiateProjectFromTemplate as instantiateProjectFromTemplateFn,
  recomputeProjectTaskDueDates,
} from "./instantiation"
import { recomputeProjectPaymentSchedule } from "@/modules/invoices/recompute-payment-schedule"
import {
  addProjectContactInput,
  addProjectPhotographerInput,
  addProjectSubEventInput,
  createProjectInput,
  deleteProjectInput,
  instantiateProjectFromTemplateInput,
  removeProjectContactInput,
  removeProjectPhotographerInput,
  removeProjectSubEventInput,
  restoreProjectInput,
  updatePhotographerConfirmationInput,
  updateProjectInput,
  updateProjectSubEventInput,
} from "./types"

const PROJECT_RECORD_TYPE = "project"

type DbHandle = NodePgDatabase<typeof schema>

async function assertProjectInOrg(db: DbHandle, projectId: string, orgId: string) {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, orgId),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1)
  if (!row) {
    throw new ActionError("VALIDATION", "Project not found in this organization.")
  }
}

async function assertContactInOrg(db: DbHandle, contactId: string, orgId: string) {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.organizationId, orgId),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1)
  if (!row) {
    throw new ActionError("VALIDATION", "Contact not found in this organization.")
  }
}

async function assertMemberOfOrg(db: DbHandle, userId: string, orgId: string) {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1)
  if (!row) {
    throw new ActionError("VALIDATION", "User is not a member of this organization.")
  }
}

// ─── PROJECT CRUD ──────────────────────────────────────────────────────
//
// TODO Push P4.x (Events UI): wire CustomFieldsRenderer into the project
// (Event) form. Use listActiveFieldDefinitionsForRecordType('project')
// for the form rendering. The engine + validators are wired here; the
// UI is the only remaining work.
//
// TODO Push P4.x (Events list UI): the saved-views custom-field
// column / filter / sort engine is record_type-agnostic — call
// listActiveFieldDefinitionsForRecordType('project') from the events
// list page's Edit Columns + More Filters loaders and the saved-view
// jsonb (`field: "customField.<fieldId>"`) plumbing will work the
// same way it does on /contacts.

export const createProject = orgAction
  .metadata({ actionName: "projects.create" })
  .inputSchema(createProjectInput)
  .action(async ({ parsedInput, ctx }) => {
    const id = createId()
    const { value: validatedCustomFields } = await prepareCustomFieldsForCreate(
      ctx.db,
      PROJECT_RECORD_TYPE,
      parsedInput.customFields,
    )
    // Anniversary auto-derivation: for Wedding type, default anniversary
    // to primary_date if the caller didn't explicitly provide one.
    const anniversaryDate =
      parsedInput.anniversaryDate ??
      (parsedInput.projectType === "Wedding" ? (parsedInput.primaryDate ?? null) : null)

    await ctx.db.insert(projects).values({
      id,
      organizationId: ctx.activeOrg.id,
      name: parsedInput.name,
      projectType: parsedInput.projectType ?? null,
      lifecycleStatus: parsedInput.lifecycleStatus ?? null,
      primaryDate: parsedInput.primaryDate ?? null,
      startDatetime: parsedInput.startDatetime ? new Date(parsedInput.startDatetime) : null,
      endDatetime: parsedInput.endDatetime ? new Date(parsedInput.endDatetime) : null,
      hoursOfCoverage: parsedInput.hoursOfCoverage ?? null,
      photographerCount: parsedInput.photographerCount ?? null,
      primaryVenueName: parsedInput.primaryVenueName ?? null,
      primaryVenueAddress: parsedInput.primaryVenueAddress ?? null,
      primaryVenueCoordinates: parsedInput.primaryVenueCoordinates ?? null,
      ceremonyVenue: parsedInput.ceremonyVenue ?? null,
      receptionVenue: parsedInput.receptionVenue ?? null,
      venueNotes: parsedInput.venueNotes ?? null,
      packageName: parsedInput.packageName ?? null,
      packageBasePriceCents: parsedInput.packageBasePriceCents ?? null,
      lineItems: parsedInput.lineItems ?? null,
      discountType: parsedInput.discountType ?? null,
      discountValue: parsedInput.discountValue ?? null,
      taxRateBps: parsedInput.taxRateBps ?? null,
      taxSign: parsedInput.taxSign ?? null,
      anniversaryDate,
      leadSource: parsedInput.leadSource ?? null,
      referredByContactId: parsedInput.referredByContactId ?? null,
      projectNotes: parsedInput.projectNotes ?? null,
      internalNotes: parsedInput.internalNotes ?? null,
      customFields: validatedCustomFields,
      templateId: parsedInput.templateId ?? null,
      createdBy: ctx.session.user.id,
      updatedBy: ctx.session.user.id,
    })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "projects.created",
      {
        resourceType: "project",
        resourceId: id,
        metadata: { name: parsedInput.name, projectType: parsedInput.projectType },
      },
    )
    revalidatePath("/events")
    return { id }
  })

export const updateProject = orgAction
  .metadata({ actionName: "projects.update" })
  .inputSchema(updateProjectInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput

    type ProjectPatch = Partial<typeof projects.$inferInsert>
    const patch: ProjectPatch = {
      updatedAt: new Date(),
      updatedBy: ctx.session.user.id,
    }
    if (rest.name !== undefined) patch.name = rest.name
    if (rest.projectType !== undefined) patch.projectType = rest.projectType
    if (rest.lifecycleStatus !== undefined) patch.lifecycleStatus = rest.lifecycleStatus
    if (rest.primaryDate !== undefined) patch.primaryDate = rest.primaryDate
    if (rest.startDatetime !== undefined) {
      patch.startDatetime = rest.startDatetime ? new Date(rest.startDatetime) : null
    }
    if (rest.endDatetime !== undefined) {
      patch.endDatetime = rest.endDatetime ? new Date(rest.endDatetime) : null
    }
    if (rest.hoursOfCoverage !== undefined) patch.hoursOfCoverage = rest.hoursOfCoverage
    if (rest.photographerCount !== undefined) patch.photographerCount = rest.photographerCount
    if (rest.primaryVenueName !== undefined) patch.primaryVenueName = rest.primaryVenueName
    if (rest.primaryVenueAddress !== undefined) patch.primaryVenueAddress = rest.primaryVenueAddress
    if (rest.primaryVenueCoordinates !== undefined)
      patch.primaryVenueCoordinates = rest.primaryVenueCoordinates
    if (rest.ceremonyVenue !== undefined) patch.ceremonyVenue = rest.ceremonyVenue
    if (rest.receptionVenue !== undefined) patch.receptionVenue = rest.receptionVenue
    if (rest.venueNotes !== undefined) patch.venueNotes = rest.venueNotes
    if (rest.packageName !== undefined) patch.packageName = rest.packageName
    if (rest.packageBasePriceCents !== undefined)
      patch.packageBasePriceCents = rest.packageBasePriceCents
    if (rest.lineItems !== undefined) patch.lineItems = rest.lineItems
    if (rest.discountType !== undefined) patch.discountType = rest.discountType
    if (rest.discountValue !== undefined) patch.discountValue = rest.discountValue
    if (rest.taxRateBps !== undefined) patch.taxRateBps = rest.taxRateBps
    if (rest.taxSign !== undefined) patch.taxSign = rest.taxSign
    if (rest.anniversaryDate !== undefined) patch.anniversaryDate = rest.anniversaryDate
    if (rest.leadSource !== undefined) patch.leadSource = rest.leadSource
    if (rest.referredByContactId !== undefined) patch.referredByContactId = rest.referredByContactId
    if (rest.projectNotes !== undefined) patch.projectNotes = rest.projectNotes
    if (rest.internalNotes !== undefined) patch.internalNotes = rest.internalNotes
    if (rest.templateId !== undefined) patch.templateId = rest.templateId
    let projectCustomFieldChanges: CustomFieldChange[] = []
    if ("customFields" in rest) {
      const [existingRow] = await ctx.db
        .select({ customFields: projects.customFields })
        .from(projects)
        .where(
          and(
            eq(projects.id, id),
            eq(projects.organizationId, ctx.activeOrg.id),
            isNull(projects.deletedAt),
          ),
        )
        .limit(1)
      if (!existingRow) {
        throw new ActionError("NOT_FOUND", "Project not found")
      }
      const prep = await prepareCustomFieldsForUpdate(
        ctx.db,
        PROJECT_RECORD_TYPE,
        existingRow.customFields,
        rest.customFields,
      )
      patch.customFields = prep.value
      projectCustomFieldChanges = prep.changes
    }

    const result = await ctx.db
      .update(projects)
      .set(patch)
      .where(
        and(
          eq(projects.id, id),
          eq(projects.organizationId, ctx.activeOrg.id),
          isNull(projects.deletedAt),
        ),
      )
      .returning({ id: projects.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Project not found")
    }
    // If primary_date moved, shift every non-overridden templated task's
    // due_date in the same transaction (Tech Arch §4 recompute pass).
    let taskRecomputeStats: Awaited<ReturnType<typeof recomputeProjectTaskDueDates>> | null = null
    if (rest.primaryDate !== undefined) {
      taskRecomputeStats = await recomputeProjectTaskDueDates(ctx.db, id)
    }
    // If any money input changed OR primary_date moved, recompute the
    // payment schedule (Tech Arch §4 — the second half of the recompute
    // engine; primitives shared, orchestration separate per
    // src/lib/recompute/README.md). Touches project.*_cents AND the
    // payment_installments rows for non-overridden installments.
    let paymentRecomputeStats: Awaited<ReturnType<typeof recomputeProjectPaymentSchedule>> | null =
      null
    if (
      rest.lineItems !== undefined ||
      rest.packageBasePriceCents !== undefined ||
      rest.discountType !== undefined ||
      rest.discountValue !== undefined ||
      rest.taxRateBps !== undefined ||
      rest.taxSign !== undefined ||
      rest.primaryDate !== undefined
    ) {
      paymentRecomputeStats = await recomputeProjectPaymentSchedule(ctx.db, id)
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "projects.updated",
      {
        resourceType: "project",
        resourceId: id,
        metadata: {
          ...rest,
          ...(taskRecomputeStats ? { taskRecompute: taskRecomputeStats } : {}),
          ...(paymentRecomputeStats ? { paymentRecompute: paymentRecomputeStats } : {}),
          ...(projectCustomFieldChanges.length > 0
            ? { customFieldChanges: projectCustomFieldChanges }
            : {}),
        },
      },
    )
    revalidatePath("/events")
    revalidatePath(`/events/${id}`)
    return { id }
  })

export const instantiateProjectFromTemplate = orgAction
  .metadata({ actionName: "projects.instantiate_from_template" })
  .inputSchema(instantiateProjectFromTemplateInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await instantiateProjectFromTemplateFn(ctx.db, {
      projectId: parsedInput.projectId,
      templateId: parsedInput.templateId,
      organizationId: ctx.activeOrg.id,
      userId: ctx.session.user.id,
    })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "projects.instantiated_from_template",
      {
        resourceType: "project",
        resourceId: parsedInput.projectId,
        metadata: { templateId: parsedInput.templateId, ...result },
      },
    )
    revalidatePath(`/events/${parsedInput.projectId}`)
    return { projectId: parsedInput.projectId, ...result }
  })

export const deleteProject = orgAction
  .metadata({ actionName: "projects.delete" })
  .inputSchema(deleteProjectInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(projects)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(projects.id, parsedInput.id),
          eq(projects.organizationId, ctx.activeOrg.id),
          isNull(projects.deletedAt),
        ),
      )
      .returning({ id: projects.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Project not found or already deleted")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "projects.deleted",
      { resourceType: "project", resourceId: parsedInput.id },
    )
    revalidatePath("/events")
    return { id: parsedInput.id }
  })

export const restoreProject = orgAction
  .metadata({ actionName: "projects.restore" })
  .inputSchema(restoreProjectInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(projects)
      .set({ deletedAt: null, deletedBy: null })
      .where(
        and(
          eq(projects.id, parsedInput.id),
          eq(projects.organizationId, ctx.activeOrg.id),
          isNotNull(projects.deletedAt),
        ),
      )
      .returning({ id: projects.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Deleted project not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "projects.restored",
      { resourceType: "project", resourceId: parsedInput.id },
    )
    revalidatePath("/events")
    return { id: parsedInput.id }
  })

// ─── CONTACT ASSOCIATION ─────────────────────────────────────────────────

export const addProjectContact = orgAction
  .metadata({ actionName: "project_contacts.add" })
  .inputSchema(addProjectContactInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertProjectInOrg(ctx.db, parsedInput.projectId, ctx.activeOrg.id)
    await assertContactInOrg(ctx.db, parsedInput.contactId, ctx.activeOrg.id)
    const id = createId()
    await ctx.db.insert(projectContacts).values({
      id,
      organizationId: ctx.activeOrg.id,
      projectId: parsedInput.projectId,
      contactId: parsedInput.contactId,
      role: parsedInput.role,
      createdBy: ctx.session.user.id,
    })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_contacts.added",
      {
        resourceType: "project_contact",
        resourceId: id,
        metadata: {
          projectId: parsedInput.projectId,
          contactId: parsedInput.contactId,
          role: parsedInput.role,
        },
      },
    )
    revalidatePath(`/events/${parsedInput.projectId}`)
    return { id }
  })

export const removeProjectContact = orgAction
  .metadata({ actionName: "project_contacts.remove" })
  .inputSchema(removeProjectContactInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .delete(projectContacts)
      .where(
        and(
          eq(projectContacts.id, parsedInput.id),
          eq(projectContacts.organizationId, ctx.activeOrg.id),
        ),
      )
      .returning({ id: projectContacts.id, projectId: projectContacts.projectId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Project contact association not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_contacts.removed",
      { resourceType: "project_contact", resourceId: first.id },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id: first.id }
  })

// ─── PHOTOGRAPHER ASSIGNMENT ─────────────────────────────────────────────

export const addProjectPhotographer = orgAction
  .metadata({ actionName: "project_photographers.add" })
  .inputSchema(addProjectPhotographerInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertProjectInOrg(ctx.db, parsedInput.projectId, ctx.activeOrg.id)
    await assertMemberOfOrg(ctx.db, parsedInput.userId, ctx.activeOrg.id)
    const id = createId()
    await ctx.db.insert(projectPhotographers).values({
      id,
      organizationId: ctx.activeOrg.id,
      projectId: parsedInput.projectId,
      userId: parsedInput.userId,
      role: parsedInput.role,
      createdBy: ctx.session.user.id,
      updatedBy: ctx.session.user.id,
    })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_photographers.added",
      {
        resourceType: "project_photographer",
        resourceId: id,
        metadata: {
          projectId: parsedInput.projectId,
          userId: parsedInput.userId,
          role: parsedInput.role,
        },
      },
    )
    revalidatePath(`/events/${parsedInput.projectId}`)
    return { id }
  })

export const removeProjectPhotographer = orgAction
  .metadata({ actionName: "project_photographers.remove" })
  .inputSchema(removeProjectPhotographerInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .delete(projectPhotographers)
      .where(
        and(
          eq(projectPhotographers.id, parsedInput.id),
          eq(projectPhotographers.organizationId, ctx.activeOrg.id),
        ),
      )
      .returning({
        id: projectPhotographers.id,
        projectId: projectPhotographers.projectId,
      })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Photographer assignment not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_photographers.removed",
      { resourceType: "project_photographer", resourceId: first.id },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id: first.id }
  })

export const updatePhotographerConfirmation = orgAction
  .metadata({ actionName: "project_photographers.update_confirmation" })
  .inputSchema(updatePhotographerConfirmationInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(projectPhotographers)
      .set({
        confirmationStatus: parsedInput.confirmationStatus,
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          eq(projectPhotographers.id, parsedInput.id),
          eq(projectPhotographers.organizationId, ctx.activeOrg.id),
        ),
      )
      .returning({
        id: projectPhotographers.id,
        projectId: projectPhotographers.projectId,
      })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Photographer assignment not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_photographers.confirmation_updated",
      {
        resourceType: "project_photographer",
        resourceId: first.id,
        metadata: { confirmationStatus: parsedInput.confirmationStatus },
      },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id: first.id }
  })

// ─── SUB-EVENT MANAGEMENT ────────────────────────────────────────────────

export const addProjectSubEvent = orgAction
  .metadata({ actionName: "project_sub_events.add" })
  .inputSchema(addProjectSubEventInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertProjectInOrg(ctx.db, parsedInput.projectId, ctx.activeOrg.id)
    const id = createId()
    await ctx.db.insert(projectSubEvents).values({
      id,
      organizationId: ctx.activeOrg.id,
      projectId: parsedInput.projectId,
      eventType: parsedInput.eventType,
      included: parsedInput.included,
      eventDate: parsedInput.eventDate ?? null,
      venue: parsedInput.venue ?? null,
      photographerUserId: parsedInput.photographerUserId ?? null,
      createdBy: ctx.session.user.id,
      updatedBy: ctx.session.user.id,
    })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_sub_events.added",
      {
        resourceType: "project_sub_event",
        resourceId: id,
        metadata: {
          projectId: parsedInput.projectId,
          eventType: parsedInput.eventType,
        },
      },
    )
    revalidatePath(`/events/${parsedInput.projectId}`)
    return { id }
  })

export const updateProjectSubEvent = orgAction
  .metadata({ actionName: "project_sub_events.update" })
  .inputSchema(updateProjectSubEventInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    type SubEventPatch = Partial<typeof projectSubEvents.$inferInsert>
    const patch: SubEventPatch = {
      updatedAt: new Date(),
      updatedBy: ctx.session.user.id,
    }
    if (rest.included !== undefined) patch.included = rest.included
    if (rest.eventDate !== undefined) patch.eventDate = rest.eventDate
    if (rest.venue !== undefined) patch.venue = rest.venue
    if (rest.photographerUserId !== undefined) patch.photographerUserId = rest.photographerUserId
    if (rest.galleryDeliveredAt !== undefined) {
      patch.galleryDeliveredAt = rest.galleryDeliveredAt ? new Date(rest.galleryDeliveredAt) : null
    }

    const result = await ctx.db
      .update(projectSubEvents)
      .set(patch)
      .where(
        and(eq(projectSubEvents.id, id), eq(projectSubEvents.organizationId, ctx.activeOrg.id)),
      )
      .returning({
        id: projectSubEvents.id,
        projectId: projectSubEvents.projectId,
      })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Sub-event not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_sub_events.updated",
      { resourceType: "project_sub_event", resourceId: id, metadata: rest },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id }
  })

export const removeProjectSubEvent = orgAction
  .metadata({ actionName: "project_sub_events.remove" })
  .inputSchema(removeProjectSubEventInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .delete(projectSubEvents)
      .where(
        and(
          eq(projectSubEvents.id, parsedInput.id),
          eq(projectSubEvents.organizationId, ctx.activeOrg.id),
        ),
      )
      .returning({
        id: projectSubEvents.id,
        projectId: projectSubEvents.projectId,
      })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Sub-event not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_sub_events.removed",
      { resourceType: "project_sub_event", resourceId: first.id },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id: first.id }
  })
