/**
 * Task 10b — `emitNotification` dispatch engine.
 *
 * Single entrypoint every producer calls to create in-app notification rows
 * and fan-out notification emails.  Mirrors the `recordDeliveryEvent` /
 * `recordDeliveryEventInTx` split in `@/modules/email-delivery/ingest` exactly:
 *   - `emitNotification` opens a db.transaction, sets `app.current_org`, delegates.
 *   - `emitNotificationInTx` contains the per-recipient logic; exported for tests
 *     and future callers that already hold a transaction.
 *
 * Per-recipient steps:
 *   1. Registry lookup via getNotificationTypeMeta (throws on unknown type).
 *   2. Own-action suppression — skip if recipient === actorUserId.
 *   3. Preference resolution — stored row wins over registry defaults.
 *   4. Quiet-hours — computeScheduledFor; deferred routines get scheduled_for set.
 *   5. In-app row insert (when in_app channel enabled).
 *   6. Email fan-out (when email channel enabled AND immediate delivery).
 *      Deferred routine emails are NOT sent now — Task 17 flush cron handles them.
 */
import "server-only"
import { and, eq, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import type * as schema from "@/db/schema"
import { db } from "@/lib/db"
import { notifications, notificationPreferences } from "@/modules/notifications/schema"
import { userPreferences } from "@/modules/user-preferences/schema"
import { getNotificationTypeMeta, computeScheduledFor } from "@/modules/notifications/types"
import type { NotificationSettings } from "@/modules/notifications/types"
import { sendNotificationEmail } from "./email"

// ─── Types ────────────────────────────────────────────────────────────────────

/** Matches NodePgDatabase<typeof schema> — includes both pool-backed db and tx. */
type DbTx = NodePgDatabase<typeof schema>

export interface EmitNotificationInput {
  organizationId: string
  /** Must exist in NOTIFICATION_TYPES; getNotificationTypeMeta throws otherwise. */
  type: string
  /** The producer decides who receives this notification (owner + admins, or a single user). */
  recipientUserIds: string[]
  /** Who caused it.  Used for own-action suppression. */
  actorUserId?: string | null
  /** Written to notifications.contact_id. */
  contactId?: string | null
  title: string
  body?: string | null
  linkPath?: string | null
  payload?: Record<string, unknown> | null
  /** "email" this round; extensible for future modules. */
  sourceModule: string
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Emits a notification from an unauthenticated / system context (webhook,
 * cron job, background task).
 *
 * Opens ONE transaction that:
 *   1. Sets `app.current_org` GUC (transaction-local) to satisfy the
 *      notifications INSERT RLS policy (org-only check — Task 9).
 *   2. Delegates to `emitNotificationInTx`.
 */
export async function emitNotification(input: EmitNotificationInput): Promise<{ created: number }> {
  return db.transaction(async (tx) => {
    // Mirror src/modules/email-delivery/ingest.ts — set org GUC FIRST so every
    // subsequent write satisfies FORCE RLS without a session.
    await tx.execute(sql`SELECT set_config('app.current_org', ${input.organizationId}, true)`)
    return emitNotificationInTx(tx, input)
  })
}

/**
 * Core emit logic.  Exported for callers that already hold a transaction
 * (e.g. Task 11 trigger inside recordDeliveryEventInTx) and for direct use
 * in integration tests via withTestDb + setOrgContext.
 *
 * Precondition: `app.current_org` GUC must already be set on `tx`.
 */
export async function emitNotificationInTx(
  tx: DbTx,
  input: EmitNotificationInput,
): Promise<{ created: number }> {
  // Registry lookup — throws for unknown types (hard fail, let callers see it).
  const meta = getNotificationTypeMeta(input.type)

  let created = 0

  for (const recipientUserId of input.recipientUserIds) {
    // ── 1. Own-action suppression ─────────────────────────────────────────────
    if (input.actorUserId != null && recipientUserId === input.actorUserId) {
      continue
    }

    // Set current_user_id GUC so RLS on notification_preferences and
    // user_preferences filters to this recipient's rows.
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${recipientUserId}, true)`)

    // ── 2. Preference resolution ──────────────────────────────────────────────
    const [prefRow] = await tx
      .select({ inApp: notificationPreferences.inApp, email: notificationPreferences.email })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, recipientUserId),
          eq(notificationPreferences.type, input.type),
        ),
      )
      .limit(1)

    const channels = prefRow
      ? { in_app: prefRow.inApp, email: prefRow.email }
      : meta.defaultChannels

    // ── 3. Quiet-hours resolution ─────────────────────────────────────────────
    const [settingsRow] = await tx
      .select({ value: userPreferences.value })
      .from(userPreferences)
      .where(
        and(
          eq(userPreferences.userId, recipientUserId),
          eq(userPreferences.key, "notifications.settings"),
        ),
      )
      .limit(1)

    const settings = parseNotificationSettings(settingsRow?.value)
    const scheduledFor = computeScheduledFor(settings, meta.tier, new Date())

    // ── 4. In-app row ─────────────────────────────────────────────────────────
    let notifId: string | null = null
    if (channels.in_app) {
      notifId = createId()
      await tx.insert(notifications).values({
        id: notifId,
        organizationId: input.organizationId,
        recipientUserId,
        type: input.type,
        category: meta.category,
        tier: meta.tier,
        title: input.title,
        body: input.body ?? null,
        linkPath: input.linkPath ?? null,
        contactId: input.contactId ?? null,
        payload: input.payload ?? null,
        sourceModule: input.sourceModule,
        scheduledFor: scheduledFor ?? null,
        snoozedUntil: null,
        readAt: null,
        archivedAt: null,
        emailSentAt: null,
      })
      created++
    }

    // ── 5. Email fan-out (immediate only) ────────────────────────────────────
    // Deferred routines (scheduledFor != null) are flushed by Task 17's cron.
    if (channels.email && (meta.tier === "critical" || scheduledFor === null)) {
      const sent = await sendNotificationEmail(
        recipientUserId,
        input.title,
        input.body ?? null,
        input.linkPath,
      )
      if (sent && notifId !== null) {
        await tx
          .update(notifications)
          .set({ emailSentAt: new Date(), updatedAt: new Date() })
          .where(eq(notifications.id, notifId))
      }
    }
  }

  return { created }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Safely parse the raw `user_preferences.value` jsonb into a
 * `NotificationSettings` shape.  Returns null when absent or malformed —
 * callers treat null as "no quiet hours configured" (immediate delivery).
 */
function parseNotificationSettings(raw: unknown): NotificationSettings | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== "object" || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  return {
    timezone: typeof v.timezone === "string" ? v.timezone : null,
    quietHoursStart: typeof v.quietHoursStart === "number" ? v.quietHoursStart : null,
    quietHoursEnd: typeof v.quietHoursEnd === "number" ? v.quietHoursEnd : null,
    digestFrequency:
      v.digestFrequency === "daily" || v.digestFrequency === "weekly" ? v.digestFrequency : "off",
  }
}
