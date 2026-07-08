import "server-only"
import { db } from "@/lib/db"
import { log } from "@/lib/log"
import { findEmailLogByResendEmailIdAnyOrg } from "@/modules/email-log/queries"
import { classifyBounceClass, recordDeliveryEvent } from "./ingest"

/** Resend event types that represent outbound delivery lifecycle events. */
const DELIVERY_TYPES = new Set(["email.bounced", "email.complained", "email.delivered"])

/**
 * Handle a pre-verified Resend delivery event (`email.bounced`,
 * `email.complained`, or `email.delivered`). All other event types are
 * silently dropped (no-op).
 *
 * Correlation: reads `event.data.email_id`, resolves it to an `email_log`
 * row via `findEmailLogByResendEmailIdAnyOrg` (cross-org, no GUC), and calls
 * `recordDeliveryEvent` with the correct type + org. A missing email_id or
 * unresolvable id is logged and dropped — this is expected for mail sent
 * before the Task 6 Part 1 fix and is NOT an error.
 *
 * `providerEventId` is the Svix `svix-id` header from the route — used as the
 * dedup key in `email_delivery_events` (the partial unique index on
 * (organization_id, provider_event_id)).
 */
export async function ingestResendDeliveryEvent(
  event: unknown,
  providerEventId: string | null,
): Promise<void> {
  if (!event || typeof event !== "object") return
  const evt = event as {
    type?: string
    created_at?: string
    data?: Record<string, unknown>
  }

  if (!evt.type || !DELIVERY_TYPES.has(evt.type)) return

  const data = evt.data ?? {}
  const emailId = typeof data.email_id === "string" ? data.email_id : null
  if (!emailId) {
    log.info({ eventType: evt.type }, "resend-delivery: missing email_id — dropped")
    return
  }

  const match = await findEmailLogByResendEmailIdAnyOrg(db, emailId)
  if (!match) {
    log.info(
      { emailId, eventType: evt.type },
      "resend-delivery: no email_log match — dropped (expected for pre-fix sends)",
    )
    return
  }

  // Derive occurredAt from the event's own created_at, or its data.created_at,
  // or fall back to now. Resend uses ISO-8601 strings.
  const rawTs =
    typeof data.created_at === "string"
      ? data.created_at
      : typeof evt.created_at === "string"
        ? evt.created_at
        : null
  const occurredAt = rawTs ? new Date(rawTs) : new Date()

  const common = {
    organizationId: match.organizationId,
    emailLogId: match.id,
    path: "resend" as const,
    providerEventId,
    occurredAt,
  }

  if (evt.type === "email.bounced") {
    await recordDeliveryEvent({
      ...common,
      type: "bounced",
      bounceClass: classifyBounceClass(data),
      detail: data,
    })
  } else if (evt.type === "email.complained") {
    await recordDeliveryEvent({
      ...common,
      type: "complained",
      detail: data,
    })
  } else if (evt.type === "email.delivered") {
    await recordDeliveryEvent({
      ...common,
      type: "delivered",
      detail: data,
    })
  }
}
