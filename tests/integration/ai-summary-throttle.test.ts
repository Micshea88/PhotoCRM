/**
 * AI-summary regen throttle (race protection). `refreshContactAiSummary` claims
 * a regen slot via an atomic compare-and-set on `ai_last_regen_attempt_at` with
 * a 1-minute window: two simultaneous page loads → only one wins, the other is
 * throttled. This exercises that exact CAS at the DB level (raw, app bypassed),
 * which is what guarantees only one Haiku call fires per contact per minute.
 */
import { describe, it, expect } from "vitest"
import { sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"

type Db = Parameters<typeof setOrgContext>[0]

// The exact claim used by refreshContactAiSummary.
function claim(db: Db, orgId: string, contactId: string) {
  return db.execute(sql`
    UPDATE contacts SET ai_last_regen_attempt_at = now()
    WHERE id = ${contactId} AND organization_id = ${orgId} AND deleted_at IS NULL
      AND (ai_last_regen_attempt_at IS NULL
           OR ai_last_regen_attempt_at < now() - interval '1 minute')
    RETURNING id
  `)
}

describe("AI summary regen throttle — atomic CAS on ai_last_regen_attempt_at", () => {
  it("first claim wins, a second claim within the minute is throttled", async () => {
    await withTestDb(async (db: Db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const cid = createId()
      await db.insert(contacts).values({
        id: cid,
        organizationId: orgId,
        firstName: "Race",
        lastName: "Contact",
        contactType: "Lead",
        createdBy: userId,
        updatedBy: userId,
      })

      const first = await claim(db, orgId, cid)
      expect(first.rows.length).toBe(1) // won the slot

      const second = await claim(db, orgId, cid)
      expect(second.rows.length).toBe(0) // throttled — already claimed this minute
    })
  })

  it("a stale attempt (older than 1 minute) can be re-claimed", async () => {
    await withTestDb(async (db: Db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const cid = createId()
      await db.insert(contacts).values({
        id: cid,
        organizationId: orgId,
        firstName: "Stale",
        lastName: "Attempt",
        contactType: "Lead",
        aiLastRegenAttemptAt: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
        createdBy: userId,
        updatedBy: userId,
      })

      const again = await claim(db, orgId, cid)
      expect(again.rows.length).toBe(1) // window elapsed → re-claimable
    })
  })
})
