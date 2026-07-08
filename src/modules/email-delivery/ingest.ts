import "server-only"
import { and, eq, inArray, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import type * as schema from "@/db/schema"
import { db } from "@/lib/db"
import { emailDeliveryEvents } from "./schema"
import { emailLog } from "@/modules/email-log/schema"
import { emitNotificationInTx } from "@/modules/notifications/dispatch"
import { memberRole } from "@/modules/rbac/schema"

export interface DeliveryEventInput {
  organizationId: string
  emailLogId: string // caller (Task 6/7) has already resolved a VALID email_log row
  path: "nylas" | "resend"
  type: "sent" | "delivered" | "bounced" | "failed" | "complained"
  bounceClass?: "hard" | "soft" | null
  detail?: unknown // raw provider payload/reason
  providerEventId?: string | null // Svix svix-id / Nylas event id — dedup key
  occurredAt: Date
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Delivery status precedence rank.
 * sent=0, delivered=1, complained=2, failed=3, bounced=4
 */
export function deliveryStatusRank(status: string): number {
  const ranks: Record<string, number> = {
    sent: 0,
    delivered: 1,
    complained: 2,
    failed: 3,
    bounced: 4,
  }
  return ranks[status] ?? -1
}

/**
 * Returns the status to store: advances only when the event is a higher rank
 * than the current status; never downgrades.
 */
export function nextDeliveryStatus(current: string, eventType: DeliveryEventInput["type"]): string {
  return deliveryStatusRank(eventType) > deliveryStatusRank(current) ? eventType : current
}

/**
 * Best-effort bounce class inference from common provider shapes.
 * - Resend: `{ bounceType: "hard"|"soft" }` or `{ type: "hard"|"soft"|"permanent"|"transient" }`
 * - Nylas: `{ detail: { type: ... } }`
 * Unknown → null.
 */
export function classifyBounceClass(detail: unknown): "hard" | "soft" | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null
  const d = detail as Record<string, unknown>
  const raw = d.bounceType ?? d.type ?? d.bounce_type
  if (raw === "hard" || raw === "permanent") return "hard"
  if (raw === "soft" || raw === "transient") return "soft"
  // Recurse into a nested `detail` object (Nylas shape)
  if (d.detail && typeof d.detail === "object") {
    return classifyBounceClass(d.detail)
  }
  return null
}

/**
 * Best-effort plain-English bounce reason from common provider shapes.
 * Prefers human-readable string fields; returns null when none found.
 */
export function bounceReasonText(detail: unknown): string | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null
  const d = detail as Record<string, unknown>
  for (const key of ["reason", "message", "description", "error", "bounceMessage"]) {
    const val = d[key]
    if (typeof val === "string" && val.length > 0) return val
  }
  return null
}

// ─── Core writer (accepts a tx/db handle with org GUC already set) ────────────

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Core logic for recording a delivery event. Expects `app.current_org` to be
 * set on the provided db/tx (either via setOrgContext in tests, or via the
 * set_config call in the `recordDeliveryEvent` wrapper below).
 *
 * Exported for direct use in tests (via withTestDb + setOrgContext) and in
 * future machine-context callers that manage their own transaction.
 */
export async function recordDeliveryEventInTx(
  tx: DbHandle,
  input: DeliveryEventInput,
): Promise<{ recorded: boolean }> {
  // 1. Idempotent insert — onConflictDoNothing catches the partial unique index
  //    (organization_id, provider_event_id) WHERE provider_event_id IS NOT NULL.
  //    For null providerEventId rows the partial index doesn't apply, so every
  //    call inserts a new row (correct: no dedup key means no dedup).
  const inserted = await tx
    .insert(emailDeliveryEvents)
    .values({
      id: createId(),
      organizationId: input.organizationId,
      emailLogId: input.emailLogId,
      path: input.path,
      type: input.type,
      bounceClass: input.bounceClass ?? null,
      detail: (input.detail ?? null) as Record<string, unknown> | null,
      providerEventId: input.providerEventId ?? null,
      occurredAt: input.occurredAt,
    })
    .onConflictDoNothing()
    .returning({ id: emailDeliveryEvents.id })

  // Duplicate event (provider_event_id conflict) — return without re-applying
  // the status update (idempotent webhook redelivery).
  if (inserted.length === 0) {
    return { recorded: false }
  }

  // 2. Read current denormalized status from email_log.
  //    Also fetch userId / contactId / subject for Task 11 notification emit.
  const [currentRow] = await tx
    .select({
      deliveryStatus: emailLog.deliveryStatus,
      userId: emailLog.userId,
      contactId: emailLog.contactId,
      subject: emailLog.subject,
    })
    .from(emailLog)
    .where(
      and(eq(emailLog.id, input.emailLogId), eq(emailLog.organizationId, input.organizationId)),
    )
    .limit(1)

  if (!currentRow) return { recorded: true }

  // 3. Denormalized status update with precedence — never downgrade.
  const newStatus = nextDeliveryStatus(currentRow.deliveryStatus, input.type)
  const statusAdvances = newStatus !== currentRow.deliveryStatus

  const updateValues: Partial<typeof emailLog.$inferInsert> = {
    updatedAt: new Date(),
  }

  if (statusAdvances) {
    updateValues.deliveryStatus = newStatus
  }
  // Set bounce timestamps/reason whenever the event is of type "bounced"
  // regardless of whether delivery_status itself advances.
  if (input.type === "bounced") {
    updateValues.bouncedAt = input.occurredAt
    updateValues.bounceReason = bounceReasonText(input.detail)
  }
  // Set failure timestamp whenever the event is of type "failed".
  if (input.type === "failed") {
    updateValues.failedAt = input.occurredAt
  }

  await tx
    .update(emailLog)
    .set(updateValues)
    .where(
      and(eq(emailLog.id, input.emailLogId), eq(emailLog.organizationId, input.organizationId)),
    )

  // Task 11: emit critical notification (bounce/fail/complaint) via notifications/dispatch.
  if (input.type === "bounced" || input.type === "complained" || input.type === "failed") {
    // Resolve recipients: sender (email_log.userId) + org owners/admins, deduped.
    const adminRows = await tx
      .select({ userId: memberRole.userId })
      .from(memberRole)
      .where(
        and(
          eq(memberRole.organizationId, input.organizationId),
          inArray(memberRole.role, ["owner", "admin"]),
        ),
      )

    const recipientSet = new Set<string>()
    if (currentRow.userId) recipientSet.add(currentRow.userId)
    for (const row of adminRows) recipientSet.add(row.userId)

    const recipientUserIds = [...recipientSet]

    if (recipientUserIds.length > 0) {
      // Map delivery event type → notification type.
      const notificationType =
        input.type === "bounced"
          ? "email.bounced"
          : input.type === "complained"
            ? "email.complained"
            : "email.send_failed"

      const subject = currentRow.subject ?? null
      const reason = bounceReasonText(input.detail)

      let title: string
      let body: string
      if (input.type === "bounced") {
        title = "Email couldn't be delivered"
        body = `Your email${subject ? ` "${subject}"` : ""} bounced${reason ? `: ${reason}` : "."}`
      } else if (input.type === "complained") {
        title = "Spam complaint"
        body = `A recipient marked your email${subject ? ` "${subject}"` : ""} as spam.`
      } else {
        title = "Email failed to send"
        body = `Your email${subject ? ` "${subject}"` : ""} failed to send${reason ? `: ${reason}` : "."}`
      }

      await emitNotificationInTx(tx, {
        organizationId: input.organizationId,
        type: notificationType,
        recipientUserIds,
        actorUserId: null, // delivery failure is NOT the user's action; do NOT suppress sender
        contactId: currentRow.contactId ?? null,
        title,
        body,
        linkPath: currentRow.contactId ? `/contacts/${currentRow.contactId}` : null,
        payload: { emailLogId: input.emailLogId },
        sourceModule: "email",
      })
    }
  }

  return { recorded: true }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Records a single delivery event from an unauthenticated webhook context.
 *
 * Runs in ONE transaction that:
 *   1. Sets `app.current_org` GUC (transaction-local) so FORCE RLS is satisfied.
 *   2. Does an idempotent insert into `email_delivery_events`.
 *   3. Updates the denormalized status columns on `email_log` (status-rank
 *      precedence — never downgrades).
 *
 * Returns `{ recorded: true }` when the event was written; `{ recorded: false }`
 * when the event was a duplicate (idempotent webhook redelivery — the caller
 * should ack 200 but skip any downstream actions).
 */
export async function recordDeliveryEvent(
  input: DeliveryEventInput,
): Promise<{ recorded: boolean }> {
  return db.transaction(async (tx) => {
    // Drop into the NOBYPASSRLS app role FIRST (before any GUC) so FORCE RLS
    // genuinely enforces on this system-context write — mirroring
    // processInboundEmail (src/modules/email-log/inbound.ts:260-262). All
    // tables touched here (email_delivery_events, email_log, member_role SELECT)
    // are org-scoped; emitNotificationInTx sets app.current_user_id per-recipient.
    await tx.execute(sql`SET LOCAL ROLE app_authenticated`)
    // Set org GUC so every subsequent write satisfies FORCE RLS.
    await tx.execute(sql`SELECT set_config('app.current_org', ${input.organizationId}, true)`)
    return recordDeliveryEventInTx(tx, input)
  })
}
