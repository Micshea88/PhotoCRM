import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { withOrgContext } from "@/lib/org-context"
import type * as schema from "@/db/schema"
import { contactNotes } from "@/modules/contacts/schema"
import { callLog } from "@/modules/calls/schema"
import { meetings } from "@/modules/meetings/schema"
import { smsMessages } from "@/modules/sms-messages/schema"
import { user } from "@/modules/auth/schema"
import type { ActivityEntry } from "./ui/contact-activity-feed"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Push 3 (C6c) — server-side loader for the unified activity feed.
 *
 * Pulls notes + calls + meetings + sms_messages for a given contact,
 * joins to `user` for the actor label, merges + sorts DESC, returns
 * a list of `ActivityEntry` (the shape the client component reads).
 *
 * Each source query is independent + scoped to the contact; the
 * merge happens in TypeScript. With per-contact volumes well under
 * 1k rows in V1 the overhead is trivial. Pagination is a follow-up
 * when volumes grow.
 *
 * Caller must be inside a runWithOrgContext scope (RLS); each query
 * also filters by organization_id for plan clarity.
 */
export async function loadContactActivity(
  orgId: string,
  contactId: string,
): Promise<ActivityEntry[]> {
  return withOrgContext(async (db) => loadContactActivityWithDb(db, orgId, contactId))
}

/**
 * Parametric variant for callers that already hold a tx — used by
 * the regenerate pipeline (which runs inside its own action tx and
 * can't grab the AsyncLocalStorage handle that `loadContactActivity`
 * uses).
 */
export async function loadContactActivityWithDb(
  db: DbHandle,
  orgId: string,
  contactId: string,
): Promise<ActivityEntry[]> {
  {
    // Notes
    const notesRows = await db
      .select({
        id: contactNotes.id,
        createdAt: contactNotes.createdAt,
        body: contactNotes.body,
        actorName: user.name,
        actorEmail: user.email,
      })
      .from(contactNotes)
      .leftJoin(user, eq(user.id, contactNotes.createdBy))
      .where(
        and(
          eq(contactNotes.organizationId, orgId),
          eq(contactNotes.contactId, contactId),
          isNull(contactNotes.deletedAt),
        ),
      )

    // Calls
    const callsRows = await db
      .select({
        id: callLog.id,
        startedAt: callLog.startedAt,
        direction: callLog.direction,
        durationSeconds: callLog.durationSeconds,
        notes: callLog.notes,
        actorName: user.name,
        actorEmail: user.email,
      })
      .from(callLog)
      .leftJoin(user, eq(user.id, callLog.userId))
      .where(
        and(
          eq(callLog.organizationId, orgId),
          eq(callLog.contactId, contactId),
          isNull(callLog.deletedAt),
        ),
      )

    // Meetings
    const meetingsRows = await db
      .select({
        id: meetings.id,
        startsAt: meetings.startsAt,
        subject: meetings.subject,
        notes: meetings.notes,
        actorName: user.name,
        actorEmail: user.email,
      })
      .from(meetings)
      .leftJoin(user, eq(user.id, meetings.createdBy))
      .where(
        and(
          eq(meetings.organizationId, orgId),
          eq(meetings.contactId, contactId),
          isNull(meetings.deletedAt),
        ),
      )

    // SMS messages
    const smsRows = await db
      .select({
        id: smsMessages.id,
        sentAt: smsMessages.sentAt,
        direction: smsMessages.direction,
        body: smsMessages.body,
        actorName: user.name,
        actorEmail: user.email,
      })
      .from(smsMessages)
      .leftJoin(user, eq(user.id, smsMessages.sentByUserId))
      .where(
        and(
          eq(smsMessages.organizationId, orgId),
          eq(smsMessages.contactId, contactId),
          isNull(smsMessages.deletedAt),
        ),
      )

    function actor(name: string | null, email: string | null | undefined): string | null {
      return name ?? email ?? null
    }

    const entries: ActivityEntry[] = []

    for (const n of notesRows) {
      entries.push({
        id: `note-${n.id}`,
        kind: "note",
        timestamp: n.createdAt,
        title: "Note added",
        body: n.body,
        actor: actor(n.actorName, n.actorEmail),
      })
    }

    for (const c of callsRows) {
      const dur =
        c.durationSeconds && c.durationSeconds > 0
          ? ` · ${String(Math.round(c.durationSeconds / 60))}m`
          : ""
      entries.push({
        id: `call-${c.id}`,
        kind: "call",
        timestamp: c.startedAt,
        title: `Call (${c.direction})${dur}`,
        body: c.notes,
        actor: actor(c.actorName, c.actorEmail),
      })
    }

    for (const m of meetingsRows) {
      entries.push({
        id: `meeting-${m.id}`,
        kind: "meeting",
        timestamp: m.startsAt,
        title: m.subject ? `Meeting — ${m.subject}` : "Meeting",
        body: m.notes,
        actor: actor(m.actorName, m.actorEmail),
      })
    }

    for (const s of smsRows) {
      entries.push({
        id: `sms-${s.id}`,
        kind: "sms",
        timestamp: s.sentAt,
        title: `SMS (${s.direction})`,
        body: s.body,
        actor: actor(s.actorName, s.actorEmail),
      })
    }

    entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    return entries
  }
}
