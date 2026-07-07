"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNull, lte, or, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { z } from "zod"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { tasks } from "@/modules/tasks/schema"
import { notifications, notificationPreferences } from "./schema"
import { NOTIFICATION_TYPES } from "./types"

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * "Live" predicate: archived_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= now()).
 * Inline here (not imported from queries.ts) so actions remain self-contained.
 */
function livePredicate() {
  return and(
    isNull(notifications.archivedAt),
    or(isNull(notifications.snoozedUntil), lte(notifications.snoozedUntil, sql`now()`)),
  )
}

// ---------------------------------------------------------------------------
// markNotificationRead
// ---------------------------------------------------------------------------

export const markNotificationRead = orgAction
  .metadata({ actionName: "notifications.mark_read" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    // Idempotent: only update when read_at IS NULL so a second call is a no-op
    // (we do NOT throw if the row is already read — idempotent is explicit in the brief).
    // But we DO check that the row exists for this user — a missing row means wrong
    // user (RLS silently blocked) or bad id.
    const [existing] = await ctx.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.id, parsedInput.id),
          eq(notifications.organizationId, ctx.activeOrg.id),
          eq(notifications.recipientUserId, ctx.session.user.id),
        ),
      )
      .limit(1)
    if (!existing) {
      throw new ActionError("NOT_FOUND", "Notification not found")
    }
    await ctx.db
      .update(notifications)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(notifications.id, parsedInput.id),
          eq(notifications.organizationId, ctx.activeOrg.id),
          eq(notifications.recipientUserId, ctx.session.user.id),
          isNull(notifications.readAt), // idempotent guard
        ),
      )
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "notifications.mark_read",
      { resourceType: "notification", resourceId: parsedInput.id },
    )
    revalidatePath("/notifications")
    return { id: parsedInput.id }
  })

// ---------------------------------------------------------------------------
// markNotificationUnread
// ---------------------------------------------------------------------------

export const markNotificationUnread = orgAction
  .metadata({ actionName: "notifications.mark_unread" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(notifications)
      .set({ readAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(notifications.id, parsedInput.id),
          eq(notifications.organizationId, ctx.activeOrg.id),
          eq(notifications.recipientUserId, ctx.session.user.id),
        ),
      )
      .returning({ id: notifications.id })
    if (!result[0]) {
      throw new ActionError("NOT_FOUND", "Notification not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "notifications.mark_unread",
      { resourceType: "notification", resourceId: parsedInput.id },
    )
    revalidatePath("/notifications")
    return { id: parsedInput.id }
  })

// ---------------------------------------------------------------------------
// markAllNotificationsRead
// ---------------------------------------------------------------------------

export const markAllNotificationsRead = orgAction
  .metadata({ actionName: "notifications.mark_all_read" })
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => {
    // Idempotent: only targets live unread rows; returns 0 if all already read
    const result = await ctx.db
      .update(notifications)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(notifications.organizationId, ctx.activeOrg.id),
          eq(notifications.recipientUserId, ctx.session.user.id),
          isNull(notifications.readAt),
          livePredicate(),
        ),
      )
      .returning({ id: notifications.id })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "notifications.mark_all_read",
      { resourceType: "notification", metadata: { count: result.length } },
    )
    revalidatePath("/notifications")
    return { count: result.length }
  })

// ---------------------------------------------------------------------------
// snoozeNotification
// ---------------------------------------------------------------------------

export const snoozeNotification = orgAction
  .metadata({ actionName: "notifications.snooze" })
  .inputSchema(
    z.object({
      id: z.string().min(1),
      until: z.coerce.date().refine((d) => d > new Date(), {
        message: "Snooze date must be in the future",
      }),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(notifications)
      .set({ snoozedUntil: parsedInput.until, updatedAt: new Date() })
      .where(
        and(
          eq(notifications.id, parsedInput.id),
          eq(notifications.organizationId, ctx.activeOrg.id),
          eq(notifications.recipientUserId, ctx.session.user.id),
        ),
      )
      .returning({ id: notifications.id })
    if (!result[0]) {
      throw new ActionError("NOT_FOUND", "Notification not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "notifications.snoozed",
      {
        resourceType: "notification",
        resourceId: parsedInput.id,
        metadata: { until: parsedInput.until.toISOString() },
      },
    )
    revalidatePath("/notifications")
    return { id: parsedInput.id }
  })

// ---------------------------------------------------------------------------
// archiveNotification
// ---------------------------------------------------------------------------

export const archiveNotification = orgAction
  .metadata({ actionName: "notifications.archive" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(notifications)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(notifications.id, parsedInput.id),
          eq(notifications.organizationId, ctx.activeOrg.id),
          eq(notifications.recipientUserId, ctx.session.user.id),
        ),
      )
      .returning({ id: notifications.id })
    if (!result[0]) {
      throw new ActionError("NOT_FOUND", "Notification not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "notifications.archived",
      { resourceType: "notification", resourceId: parsedInput.id },
    )
    revalidatePath("/notifications")
    return { id: parsedInput.id }
  })

// ---------------------------------------------------------------------------
// createTaskFromNotification
// ---------------------------------------------------------------------------

export const createTaskFromNotification = orgAction
  .metadata({ actionName: "notifications.create_task" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    // Load the notification (must belong to this user in this org)
    const [notif] = await ctx.db
      .select({
        id: notifications.id,
        title: notifications.title,
        contactId: notifications.contactId,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.id, parsedInput.id),
          eq(notifications.organizationId, ctx.activeOrg.id),
          eq(notifications.recipientUserId, ctx.session.user.id),
        ),
      )
      .limit(1)
    if (!notif) {
      throw new ActionError("NOT_FOUND", "Notification not found")
    }
    // Tasks require at least one scope (project OR contact — schema CHECK constraint).
    // For a notification-spawned task the natural scope is the linked contact.
    // System notifications without a contactId cannot spawn a scoped task in V1.
    if (!notif.contactId) {
      throw new ActionError(
        "VALIDATION",
        "Cannot create a task from a notification with no linked contact",
      )
    }

    const taskId = createId()
    await ctx.db.insert(tasks).values({
      id: taskId,
      organizationId: ctx.activeOrg.id,
      contactId: notif.contactId,
      title: `Follow up: ${notif.title}`,
      assigneeUserId: ctx.session.user.id,
      status: "not_started",
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
      "notifications.task_created",
      {
        resourceType: "task",
        resourceId: taskId,
        metadata: { notificationId: parsedInput.id, contactId: notif.contactId },
      },
    )
    revalidatePath("/notifications")
    if (notif.contactId) revalidatePath(`/contacts/${notif.contactId}`)
    return { taskId }
  })

// ---------------------------------------------------------------------------
// updateNotificationPreference
// ---------------------------------------------------------------------------

export const updateNotificationPreference = orgAction
  .metadata({ actionName: "notifications.update_preference" })
  .inputSchema(
    z.object({
      type: z.string().min(1),
      inApp: z.boolean(),
      email: z.boolean(),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    if (!(parsedInput.type in NOTIFICATION_TYPES)) {
      throw new ActionError(
        "VALIDATION",
        `Unknown notification type: ${parsedInput.type}. Valid types: ${Object.keys(NOTIFICATION_TYPES).join(", ")}`,
      )
    }
    // Upsert on (userId, type) unique index
    await ctx.db
      .insert(notificationPreferences)
      .values({
        id: createId(),
        organizationId: ctx.activeOrg.id,
        userId: ctx.session.user.id,
        type: parsedInput.type,
        inApp: parsedInput.inApp,
        email: parsedInput.email,
      })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.type],
        set: {
          inApp: parsedInput.inApp,
          email: parsedInput.email,
          updatedAt: new Date(),
        },
      })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "notifications.preference_updated",
      {
        resourceType: "notification_preference",
        metadata: { type: parsedInput.type, inApp: parsedInput.inApp, email: parsedInput.email },
      },
    )
    revalidatePath("/notifications")
    return { type: parsedInput.type }
  })
