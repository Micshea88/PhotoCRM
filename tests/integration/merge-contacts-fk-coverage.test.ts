/**
 * A2 — contact merge must re-home EVERY FK child of `contacts`.
 *
 * Two failure classes this guards against:
 *  1. A child table's rows are orphaned onto the soft-deleted loser after a
 *     merge — the original bug: `email_log`, `tasks`, `notifications`, and
 *     `ai_usage_log` were all silently dropped from the winner's feed.
 *  2. A NEW child table is added to the schema but nobody adds a re-home to
 *     `executeContactMerge` — the exact rot that already happened twice
 *     (`tasks` 2026-06-18, `notifications` 2026-07-05, both added after the
 *     hand-written re-home block, both missed).
 *
 * The rot-guard enumerates FK children of `contacts` from the LIVE catalog
 * (`pg_constraint`) and asserts the set matches COVERED exactly. COVERED is
 * NOT the engine's source of truth — it is asserted equal to the catalog, so
 * it cannot silently drift the way a hand-written re-home list does: a new or
 * removed child FK turns this test red until BOTH the engine and this map are
 * updated in the same PR.
 */
import { describe, it, expect } from "vitest"
import { and, eq, inArray, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext, type TestDb } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"
import { emailLog } from "@/modules/email-log/schema"
import { tasks } from "@/modules/tasks/schema"
import { notifications } from "@/modules/notifications/schema"
import { aiUsageLog } from "@/modules/contacts/ai/ai-usage-schema"
import { executeContactMerge } from "@/modules/duplicates/merge-engine"

/**
 * Every FK column that references `contacts` in the live schema, keyed
 * `"<table>.<column>"`, with a one-line note on how `executeContactMerge`
 * re-homes it. Asserted equal to the live catalog by the rot-guard test.
 */
const COVERED: Record<string, string> = {
  "contact_company_associations.contact_id": "M2M dedup + repoint",
  "project_contacts.contact_id": "M2M dedup + repoint",
  "contact_notes.contact_id": "repoint",
  "call_log.contact_id": "repoint",
  "meetings.contact_id": "repoint",
  "sms_messages.contact_id": "repoint",
  "opportunities.contact_id": "repoint",
  "payment_installments.billing_contact_id": "repoint",
  "projects.referred_by_contact_id": "repoint (referral)",
  "contacts.referred_by_contact_id": "repoint self-ref referral + null-self",
  "email_log.contact_id": "repoint (A2)",
  "tasks.contact_id": "repoint (A2)",
  "notifications.contact_id": "repoint (A2)",
  "ai_usage_log.contact_id": "repoint (A2)",
}

async function liveContactFkChildren(db: TestDb): Promise<Set<string>> {
  const result = await db.execute<{ key: string }>(sql`
    SELECT con.conrelid::regclass::text || '.' || att.attname AS key
    FROM pg_constraint con
    JOIN pg_class ref ON ref.oid = con.confrelid
    JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
    WHERE con.contype = 'f' AND ref.relname = 'contacts'
  `)
  // regclass renders bare when the object is on the search_path but may
  // schema-qualify otherwise; normalise a leading "public." either way.
  return new Set(result.rows.map((r) => r.key.replace(/^public\./, "")))
}

async function seedContact(db: TestDb, orgId: string, userId: string): Promise<string> {
  const id = createId()
  await db.insert(contacts).values({
    id,
    organizationId: orgId,
    firstName: "F",
    lastName: "L",
    contactType: "Lead",
    createdBy: userId,
    updatedBy: userId,
  })
  return id
}

describe("A2 — contact merge FK-child coverage", () => {
  it("the live FK children of contacts exactly match the COVERED map (rot-guard)", async () => {
    await withTestDb(async (db) => {
      const live = await liveContactFkChildren(db)
      const declared = new Set(Object.keys(COVERED))

      const missingFromMap = [...live].filter((k) => !declared.has(k))
      const staleInMap = [...declared].filter((k) => !live.has(k))

      // A non-empty diff means the schema and the merge engine have drifted.
      // `missingFromMap`: a new FK child exists that executeContactMerge may
      // silently orphan — add a repoint there AND a COVERED entry here.
      // `staleInMap`: a child FK was removed — drop its COVERED entry.
      expect({ missingFromMap, staleInMap }).toEqual({ missingFromMap: [], staleInMap: [] })
    })
  })

  it("re-homes email_log, tasks, notifications, ai_usage_log from loser to winner", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const winnerId = await seedContact(db, orgId, userId)
      const loserId = await seedContact(db, orgId, userId)

      // One child row per formerly-missed table, all pointing at the LOSER.
      await db.insert(emailLog).values({
        id: createId(),
        organizationId: orgId,
        direction: "outbound",
        sentAt: new Date(),
        source: "test",
        contactId: loserId,
      })
      await db.insert(tasks).values({
        id: createId(),
        organizationId: orgId,
        title: "Follow up",
        contactId: loserId,
      })
      await db.insert(notifications).values({
        id: createId(),
        organizationId: orgId,
        recipientUserId: userId,
        type: "system",
        category: "system",
        tier: "standard",
        title: "Ping",
        sourceModule: "contacts",
        contactId: loserId,
      })
      await db.insert(aiUsageLog).values({
        id: createId(),
        organizationId: orgId,
        feature: "contacts.classifier",
        model: "haiku",
        ok: "true",
        contactId: loserId,
      })

      await executeContactMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        {
          winnerId,
          loserIds: [loserId],
          fieldChoices: {},
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )

      // Invariant: zero child rows still reference the loser.
      const emailLoser = await db.select().from(emailLog).where(eq(emailLog.contactId, loserId))
      const taskLoser = await db.select().from(tasks).where(eq(tasks.contactId, loserId))
      const notifLoser = await db
        .select()
        .from(notifications)
        .where(eq(notifications.contactId, loserId))
      const aiLoser = await db.select().from(aiUsageLog).where(eq(aiUsageLog.contactId, loserId))
      expect(emailLoser).toHaveLength(0)
      expect(taskLoser).toHaveLength(0)
      expect(notifLoser).toHaveLength(0)
      expect(aiLoser).toHaveLength(0)

      // LAW 7: the winner's feed now CONTAINS the loser's records.
      const emailWinner = await db.select().from(emailLog).where(eq(emailLog.contactId, winnerId))
      const taskWinner = await db.select().from(tasks).where(eq(tasks.contactId, winnerId))
      const notifWinner = await db
        .select()
        .from(notifications)
        .where(eq(notifications.contactId, winnerId))
      const aiWinner = await db.select().from(aiUsageLog).where(eq(aiUsageLog.contactId, winnerId))
      expect(emailWinner).toHaveLength(1)
      expect(taskWinner).toHaveLength(1)
      expect(notifWinner).toHaveLength(1)
      expect(aiWinner).toHaveLength(1)
    })
  })

  it("re-homes rows across multiple losers in one merge", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const winnerId = await seedContact(db, orgId, userId)
      const loserA = await seedContact(db, orgId, userId)
      const loserB = await seedContact(db, orgId, userId)

      for (const loser of [loserA, loserB]) {
        await db.insert(tasks).values({
          id: createId(),
          organizationId: orgId,
          title: `Task for ${loser}`,
          contactId: loser,
        })
      }

      await executeContactMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        {
          winnerId,
          loserIds: [loserA, loserB],
          fieldChoices: {},
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )

      const orphaned = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.organizationId, orgId), inArray(tasks.contactId, [loserA, loserB])))
      const onWinner = await db.select().from(tasks).where(eq(tasks.contactId, winnerId))
      expect(orphaned).toHaveLength(0)
      expect(onWinner).toHaveLength(2)
    })
  })
})
