import "server-only"
import { and, eq, isNull, sql, desc } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import type * as schema from "@/db/schema"
import { callLog } from "@/modules/calls/schema"
import { parsePhoneInput } from "@/lib/format/phone"
import { findContactByPhoneImpl } from "@/modules/telephony/queries"
import { log } from "@/lib/log"
import type { RcCallLogRecord } from "@/lib/ringcentral/types"
import { decideReconcileAction, mapRcResultToDisposition } from "@/modules/rc-sync/rules"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Reconciliation engine for the RC call-log sync. The single find-or-create
 * used by Layer 2 (targeted post-hangup pull) now and Layers 1/3 later.
 *
 * Rule order (Mike-locked):
 *   Rule 0 — PRECISE telephony_session_id match (Layer 2 witnessed path).
 *            We know the exact row; update it. No fuzzy guessing.
 *   Rule 1 — match by rc_call_id (re-sync / RC corrections; monotonicity-guarded).
 *   Rule 2 — fuzzy: one unlinked witnessed row by phone + ±30s + direction
 *            (Layer 3 only — cell-answered correlation). Ambiguous → insert.
 *   Rule 3 — no match → insert a new rc_sync row (cell-answered payoff).
 *
 * Every machine write runs inside a tx with app.current_org already set
 * (the worker wraps it); reconcile takes that tx.
 */

const FUZZY_WINDOW_SECONDS = 30

function rcOtherPartyDigits(rec: RcCallLogRecord): string | null {
  const inbound = (rec.direction ?? "").toLowerCase() === "inbound"
  const raw = inbound ? rec.from?.phoneNumber : rec.to?.phoneNumber
  return parsePhoneInput(raw ?? null)
}

function rcDirectionToPathway(rec: RcCallLogRecord): "incoming" | "outgoing" {
  return (rec.direction ?? "").toLowerCase() === "inbound" ? "incoming" : "outgoing"
}

/**
 * Apply RC truth to the call-log: rc_call_id/result/recording, flip
 * disposition_source to rc_authoritative, overwrite disposition + duration,
 * keep created_at. Returns the outcome string for logging/tests.
 */
export async function reconcileCallRecord(
  tx: DbHandle,
  organizationId: string,
  rcRecord: RcCallLogRecord,
  opts: { telephonySessionId?: string } = {},
): Promise<{ outcome: string; callLogId: string | null }> {
  const incomingLastModified = rcRecord.lastModifiedTime
    ? new Date(rcRecord.lastModifiedTime)
    : null

  // Rule 0 lookup — precise session id (Layer 2).
  let sessionMatch: { id: string; rcLastModifiedTime: Date | null } | null = null
  if (opts.telephonySessionId) {
    const [row] = await tx
      .select({ id: callLog.id, rcLastModifiedTime: callLog.rcLastModifiedTime })
      .from(callLog)
      .where(
        and(
          eq(callLog.organizationId, organizationId),
          eq(callLog.telephonySessionId, opts.telephonySessionId),
          isNull(callLog.deletedAt),
        ),
      )
      .orderBy(desc(callLog.startedAt))
      .limit(1)
    sessionMatch = row ?? null
  }

  // Rule 1 lookup — rc_call_id.
  const [rcMatchRow] = await tx
    .select({ id: callLog.id, rcLastModifiedTime: callLog.rcLastModifiedTime })
    .from(callLog)
    .where(
      and(
        eq(callLog.organizationId, organizationId),
        eq(callLog.rcCallId, rcRecord.id),
        isNull(callLog.deletedAt),
      ),
    )
    .limit(1)

  // Rule 2 lookup — fuzzy (phone + ±30s + direction, unlinked). Phone lives in
  // externalMetadata->>'phoneNumber' (call_log has no phone column).
  let fuzzyMatchIds: string[] = []
  const otherDigits = rcOtherPartyDigits(rcRecord)
  if (!sessionMatch && !rcMatchRow && otherDigits && rcRecord.startTime) {
    const startedAt = new Date(rcRecord.startTime)
    const direction = rcDirectionToPathway(rcRecord)
    const fuzzy = await tx
      .select({ id: callLog.id })
      .from(callLog)
      .where(
        and(
          eq(callLog.organizationId, organizationId),
          isNull(callLog.deletedAt),
          isNull(callLog.rcCallId),
          eq(callLog.direction, direction),
          sql`right(regexp_replace(coalesce(${callLog.externalMetadata}->>'phoneNumber', ''), '[^0-9]', '', 'g'), 10) = ${otherDigits}`,
          sql`abs(extract(epoch from (${callLog.startedAt} - ${startedAt.toISOString()}::timestamptz))) <= ${FUZZY_WINDOW_SECONDS}`,
        ),
      )
    fuzzyMatchIds = fuzzy.map((r) => r.id)
  }

  const decision = decideReconcileAction({
    sessionMatch,
    rcCallIdMatch: rcMatchRow ?? null,
    fuzzyMatchIds,
    incomingLastModified,
  })

  const disposition = mapRcResultToDisposition(rcRecord.result, rcRecord.duration)

  if (decision.action === "update") {
    if (decision.stale) {
      return { outcome: `skip_stale_${decision.via}`, callLogId: decision.targetId }
    }
    await tx
      .update(callLog)
      .set({
        rcCallId: rcRecord.id,
        rcResult: rcRecord.result ?? null,
        rcRecordingUrl: rcRecord.recording?.contentUri ?? null,
        rcRecordingId: rcRecord.recording?.id ?? null,
        rcLastModifiedTime: incomingLastModified,
        dispositionSource: "rc_authoritative",
        disposition,
        durationSeconds: rcRecord.duration ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(callLog.id, decision.targetId))
    if (decision.via === "fuzzy") {
      log.info(
        { feature: "rc-sync", outcome: "fuzzy_merge", callLogId: decision.targetId },
        "rc-sync fuzzy merge",
      )
    }
    return { outcome: `update_${decision.via}`, callLogId: decision.targetId }
  }

  // INSERT (Rule 3 / ambiguous fuzzy). Contact-match the other party.
  if (decision.via === "ambiguous_fuzzy") {
    log.warn(
      { feature: "rc-sync", rcCallId: rcRecord.id },
      "rc-sync ambiguous fuzzy — inserting instead of merging",
    )
  }
  const contact = otherDigits ? await findContactByPhoneImpl(tx, organizationId, otherDigits) : null
  const id = createId()
  await tx.insert(callLog).values({
    id,
    organizationId,
    contactId: contact?.contactId ?? null,
    userId: null,
    direction: rcDirectionToPathway(rcRecord),
    disposition,
    dispositionSource: "rc_authoritative",
    startedAt: rcRecord.startTime ? new Date(rcRecord.startTime) : new Date(),
    durationSeconds: rcRecord.duration ?? null,
    notes: null,
    source: "rc_sync",
    rcCallId: rcRecord.id,
    rcResult: rcRecord.result ?? null,
    rcRecordingUrl: rcRecord.recording?.contentUri ?? null,
    rcRecordingId: rcRecord.recording?.id ?? null,
    rcLastModifiedTime: incomingLastModified,
    externalMetadata: {
      phoneNumber: otherDigits ?? null,
      source: "rc_sync",
    },
  })
  return { outcome: `insert_${decision.via}`, callLogId: id }
}
