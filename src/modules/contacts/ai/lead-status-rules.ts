import "server-only"
import { and, eq, isNull, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { contacts } from "../schema"
import { contactNotes } from "../schema"
import { callLog } from "@/modules/calls/schema"
import { meetings } from "@/modules/meetings/schema"
import { smsMessages } from "@/modules/sms-messages/schema"
import type { LeadStatus } from "./lead-status-enum"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Push 3 (C6b CORRECTED) — facts engine for the AI classifier.
 *
 * Separated from classification per memory #28: rules compute FACTS
 * ONLY → Haiku reasons over those facts to pick a status in its own
 * words. The deterministic `fallbackClassifyFromRules` below stays as
 * the fallback vocabulary when ANTHROPIC_API_KEY is missing or Haiku
 * output won't parse.
 *
 * Activity sources actually queried (verified to exist):
 *   - contact_notes (contactNotes)
 *   - call_log (callLog)
 *   - meetings (C6a — meetings)
 *   - sms_messages (C6a — smsMessages)
 *
 * No `emails` table — intentionally omitted (doesn't exist in schema).
 */

/**
 * Facts shape passed to BOTH the Haiku prompt + the rules-fallback.
 * Future fact additions (project dates, opportunity values, etc.)
 * land here without changing the classifier contract.
 */
export interface ContactFacts {
  contactType: string | null
  lifecycleStatus: string | null
  tags: string[]
  /** Total non-deleted activity rows across all activity tables. */
  activityCount: number
  notesCount: number
  callsCount: number
  meetingsCount: number
  smsCount: number
  /** Days since the contact row was created. */
  daysSinceCreated: number
  /** Days since the most recent activity (across all sources). Null
   *  when there has never been any activity. */
  daysSinceLastActivity: number | null
  /** Days since the most recent inbound-direction signal (currently
   *  inbound SMS). Null when no inbound recorded. */
  daysSinceLastInbound: number | null
  /** True when at least one upcoming meeting exists (starts_at > now). */
  hasUpcomingMeeting: boolean
  /** Number of contacts in this org whose referred_by_contact_id
   *  points at this contact. */
  referralsMade: number
  /** Project / event / opportunity counts — placeholders that future
   *  pushes (Events/Opportunities) populate. For V1 they default to 0
   *  here and the classifier degrades gracefully. */
  bookingCount: number
  /** Cents — highest proposal value across this contact's opportunities. */
  highestProposalValue: number
}

/**
 * Returns true when the contact has zero activity rows AND zero
 * future-pushes signal (events/projects). The classifier short-circuits
 * to the deterministic "new contact" floor for these — saves an AI
 * call on the dummy-data state and on legitimately blank contacts.
 */
export function isEmptyContact(facts: ContactFacts): boolean {
  return facts.activityCount === 0 && facts.bookingCount === 0
}

const MS_PER_DAY = 1000 * 60 * 60 * 24
function daysSince(d: Date | null | undefined, now: Date): number | null {
  if (!d) return null
  return Math.floor((now.getTime() - d.getTime()) / MS_PER_DAY)
}

/**
 * Compute the rules-engine facts for a contact. Runs four
 * aggregation queries (notes / calls / meetings / sms) + one
 * referral-count query. Each only touches its own table; nothing
 * here interprets or classifies.
 *
 * Caller is responsible for setting org context (RLS); the queries
 * also include explicit org_id filters for plan clarity.
 */
export async function computeContactFacts(
  db: DbHandle,
  orgId: string,
  contactId: string,
): Promise<ContactFacts | null> {
  const [row] = await db
    .select({
      id: contacts.id,
      contactType: contacts.contactType,
      lifecycleStatus: contacts.lifecycleStatus,
      tags: contacts.tags,
      createdAt: contacts.createdAt,
    })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.organizationId, orgId),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1)
  if (!row) return null

  // Per-source counts + most-recent timestamps. SQL keeps each
  // aggregation independent — drizzle-or-pg can't always merge these
  // into a single CTE without raw SQL, and the overhead is trivial
  // (one row per query, indexed by org + contact).
  const [notesAgg] = await db
    .select({
      count: sql<string>`COUNT(*)`.as("count"),
      maxAt: sql<Date | null>`MAX(${contactNotes.createdAt})`.as("maxAt"),
    })
    .from(contactNotes)
    .where(
      and(
        eq(contactNotes.organizationId, orgId),
        eq(contactNotes.contactId, contactId),
        isNull(contactNotes.deletedAt),
      ),
    )

  const [callsAgg] = await db
    .select({
      count: sql<string>`COUNT(*)`.as("count"),
      maxAt: sql<Date | null>`MAX(${callLog.startedAt})`.as("maxAt"),
    })
    .from(callLog)
    .where(
      and(
        eq(callLog.organizationId, orgId),
        eq(callLog.contactId, contactId),
        isNull(callLog.deletedAt),
      ),
    )

  const [meetingsAgg] = await db
    .select({
      count: sql<string>`COUNT(*)`.as("count"),
      maxAt: sql<Date | null>`MAX(${meetings.startsAt})`.as("maxAt"),
      hasUpcoming: sql<boolean>`BOOL_OR(${meetings.startsAt} > NOW())`.as("hasUpcoming"),
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.organizationId, orgId),
        eq(meetings.contactId, contactId),
        isNull(meetings.deletedAt),
      ),
    )

  const [smsAgg] = await db
    .select({
      count: sql<string>`COUNT(*)`.as("count"),
      maxAt: sql<Date | null>`MAX(${smsMessages.sentAt})`.as("maxAt"),
      maxInboundAt: sql<Date | null>`
        MAX(CASE WHEN ${smsMessages.direction} = 'inbound' THEN ${smsMessages.sentAt} END)
      `.as("maxInboundAt"),
    })
    .from(smsMessages)
    .where(
      and(
        eq(smsMessages.organizationId, orgId),
        eq(smsMessages.contactId, contactId),
        isNull(smsMessages.deletedAt),
      ),
    )

  const [referralsAgg] = await db
    .execute<{ referrals: string }>(
      sql`
    SELECT COUNT(*)::text AS referrals
    FROM contacts
    WHERE organization_id = ${orgId}
      AND referred_by_contact_id = ${contactId}
      AND deleted_at IS NULL
  `,
    )
    .then((r) => r.rows)

  const notesCount = parseInt(notesAgg?.count ?? "0", 10) || 0
  const callsCount = parseInt(callsAgg?.count ?? "0", 10) || 0
  const meetingsCount = parseInt(meetingsAgg?.count ?? "0", 10) || 0
  const smsCount = parseInt(smsAgg?.count ?? "0", 10) || 0
  const activityCount = notesCount + callsCount + meetingsCount + smsCount
  const now = new Date()
  const lastActivityTimestamps = [
    notesAgg?.maxAt ?? null,
    callsAgg?.maxAt ?? null,
    meetingsAgg?.maxAt ?? null,
    smsAgg?.maxAt ?? null,
  ].filter((t): t is Date => t instanceof Date)
  const lastActivity =
    lastActivityTimestamps.length > 0
      ? new Date(Math.max(...lastActivityTimestamps.map((d) => d.getTime())))
      : null

  return {
    contactType: row.contactType,
    lifecycleStatus: row.lifecycleStatus,
    tags: row.tags ?? [],
    activityCount,
    notesCount,
    callsCount,
    meetingsCount,
    smsCount,
    daysSinceCreated: daysSince(row.createdAt, now) ?? 0,
    daysSinceLastActivity: daysSince(lastActivity, now),
    daysSinceLastInbound: daysSince(smsAgg?.maxInboundAt ?? null, now),
    hasUpcomingMeeting: !!meetingsAgg?.hasUpcoming,
    referralsMade: parseInt(referralsAgg?.referrals ?? "0", 10) || 0,
    // Future-push signals. Events / opportunities modules populate
    // these once they ship; for now classifier degrades to the
    // activity-only branches.
    bookingCount: 0,
    highestProposalValue: 0,
  }
}

// ─── Deterministic fallback classifier ──────────────────────────────

/**
 * Push 3 (C6b CORRECTED) — fallback vocabulary classifier.
 *
 * The PRIMARY classifier is `classifyLeadStatus` (Haiku, free-form
 * status). This function is the fallback:
 *   (a) when ANTHROPIC_API_KEY is missing
 *   (b) when Haiku output is unparseable after a stricter-prompt retry
 *
 * Returns one of the 19 canonical statuses from lead-status-enum.ts —
 * the deterministic floor is constrained to the enum even though the
 * AI path is free-form.
 *
 * KEEP THIS FUNCTION INTACT. C6c builds on the same shape.
 */
export interface RuleClassification {
  status: LeadStatus
  reasoning: string
}

export function fallbackClassifyFromRules(facts: ContactFacts): RuleClassification {
  const tagsLower = new Set(facts.tags.map((t) => t.toLowerCase()))
  const isVipTagged = tagsLower.has("vip") || tagsLower.has("vip client")
  const lastActivity = facts.daysSinceLastActivity
  const noActivity90d = lastActivity !== null && lastActivity > 90
  const noActivity30d = lastActivity !== null && lastActivity > 30

  if (facts.contactType === "Vendor") {
    if (noActivity90d) {
      return { status: "Past Vendor", reasoning: "Vendor with no recent activity (>90d)." }
    }
    return { status: "Active Vendor", reasoning: "Vendor with recent activity." }
  }

  if (facts.contactType === "Referral Partner") {
    if (facts.referralsMade >= 5) {
      return {
        status: "Top Referral Source",
        reasoning: `${String(facts.referralsMade)} referrals made.`,
      }
    }
    if (facts.referralsMade >= 1) {
      return {
        status: "Occasional Referral",
        reasoning: `${String(facts.referralsMade)} referral(s) tracked.`,
      }
    }
    if (noActivity90d) {
      return { status: "Past Referral", reasoning: "Marked referral partner; no recent activity." }
    }
    return {
      status: "Occasional Referral",
      reasoning: "Marked referral partner; no referrals tracked yet.",
    }
  }

  if (facts.bookingCount > 0) {
    if (isVipTagged || facts.bookingCount >= 3) {
      return {
        status: "VIP Client",
        reasoning: isVipTagged
          ? "Tagged VIP."
          : `Repeat booker (${String(facts.bookingCount)} bookings).`,
      }
    }
    if (facts.bookingCount >= 2) {
      return {
        status: "Repeat Client",
        reasoning: `${String(facts.bookingCount)} bookings to date.`,
      }
    }
    if (noActivity90d) {
      return { status: "At-Risk Client", reasoning: "1 booking + no contact >90d." }
    }
    if (facts.lifecycleStatus === "Inactive" || facts.contactType === "Past Client") {
      return { status: "Past Client", reasoning: "Marked past client." }
    }
    if (facts.hasUpcomingMeeting || !noActivity30d) {
      return {
        status: facts.hasUpcomingMeeting ? "Active Client" : "Booked Client",
        reasoning: facts.hasUpcomingMeeting
          ? "Upcoming meeting scheduled."
          : "Recently booked, active comms.",
      }
    }
    return { status: "Booked Client", reasoning: "Has a booking on record." }
  }

  if (facts.contactType === "Lead") {
    if (facts.daysSinceLastInbound !== null && facts.daysSinceLastInbound <= 7) {
      return { status: "Hot Lead", reasoning: "Inbound contact within 7d." }
    }
    if (facts.hasUpcomingMeeting) {
      return { status: "Lead in Progress", reasoning: "Has an upcoming meeting/consult." }
    }
    if (lastActivity !== null && lastActivity > 30 && lastActivity <= 90) {
      return { status: "Cold Lead", reasoning: "No contact in 30-90 days." }
    }
    if (lastActivity !== null && lastActivity > 90) {
      return { status: "Unresponsive Lead", reasoning: "No contact in 90+ days." }
    }
    if (facts.lifecycleStatus === "Do Not Contact") {
      return { status: "Dead Lead", reasoning: "Marked Do Not Contact." }
    }
    return { status: "Warm Lead", reasoning: "Active lead, moderate engagement." }
  }

  return {
    status: "Uncategorized",
    reasoning: "Insufficient signal to classify; manual review recommended.",
  }
}
