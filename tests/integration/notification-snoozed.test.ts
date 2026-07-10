/**
 * Integration tests for E2 — Snoozed tab.
 *
 * Covers:
 *   listSnoozedNotifications — returns only currently-snoozed rows (snoozedUntil > now)
 *     • cross-user isolation: user B's snoozed rows NOT returned for user A
 *     • cross-org isolation: org B's snoozed rows NOT returned for org A context
 *     • past-due snooze NOT returned (it's live again)
 *     • archivedAt rows NOT returned even if snoozedUntil is in the future
 *     • ordering: snoozedUntil ASC (soonest-to-wake first)
 *   unsnoozeNotification (DB layer) — clears snoozedUntil; recipient-scoped
 *     • sets snoozedUntil to null for the target row
 *     • does NOT affect another user's row (isolation)
 *     • after unsnooze, row appears in listNotifications (live) not listSnoozedNotifications
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { and, eq } from "drizzle-orm"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { notifications } from "@/modules/notifications/schema"
import { listSnoozedNotifications, listNotifications } from "@/modules/notifications/queries"

type Db = Parameters<typeof setOrgContext>[0]

// ── Seed helpers ─────────────────────────────────────────────────────────────

async function seedNotification(
  db: Db,
  orgId: string,
  recipientUserId: string,
  opts: {
    archivedAt?: Date | null
    snoozedUntil?: Date | null
    createdAt?: Date
  } = {},
): Promise<string> {
  const id = createId()
  await db.insert(notifications).values({
    id,
    organizationId: orgId,
    recipientUserId,
    type: "email.bounced",
    category: "messages_email",
    tier: "critical",
    title: "Test notification",
    sourceModule: "email",
    contactId: null,
    readAt: null,
    archivedAt: opts.archivedAt ?? null,
    snoozedUntil: opts.snoozedUntil ?? null,
    createdAt: opts.createdAt ?? new Date(),
  })
  return id
}

// ── listSnoozedNotifications ──────────────────────────────────────────────────

describe("listSnoozedNotifications", () => {
  it("returns only currently-snoozed rows (snoozedUntil in the future)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const future = new Date(Date.now() + 60_000)
      const snoozedId = await seedNotification(db, orgId, userId, { snoozedUntil: future })
      // Live (not snoozed) — should NOT appear
      await seedNotification(db, orgId, userId)
      // Archived — should NOT appear
      await seedNotification(db, orgId, userId, { archivedAt: new Date() })

      const rows = await listSnoozedNotifications(db, orgId, userId)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(snoozedId)
    })
  })

  it("does NOT return a row whose snoozedUntil has already elapsed (it is live again)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const past = new Date(Date.now() - 60_000)
      // Past snooze → row is live again, should NOT appear in snoozed list
      await seedNotification(db, orgId, userId, { snoozedUntil: past })

      const rows = await listSnoozedNotifications(db, orgId, userId)
      expect(rows).toHaveLength(0)
    })
  })

  it("does NOT return archived rows even when snoozedUntil is in the future", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const future = new Date(Date.now() + 60_000)
      // Both archived AND snoozed — should NOT appear (archived wins)
      await seedNotification(db, orgId, userId, {
        archivedAt: new Date(),
        snoozedUntil: future,
      })

      const rows = await listSnoozedNotifications(db, orgId, userId)
      expect(rows).toHaveLength(0)
    })
  })

  it("returns rows ordered by snoozedUntil ASC (soonest-to-wake first)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const soonest = new Date(Date.now() + 30_000)
      const middle = new Date(Date.now() + 120_000)
      const latest = new Date(Date.now() + 600_000)

      const latestId = await seedNotification(db, orgId, userId, { snoozedUntil: latest })
      const soonestId = await seedNotification(db, orgId, userId, { snoozedUntil: soonest })
      const middleId = await seedNotification(db, orgId, userId, { snoozedUntil: middle })

      const rows = await listSnoozedNotifications(db, orgId, userId)
      expect(rows).toHaveLength(3)
      expect(rows[0]!.id).toBe(soonestId)
      expect(rows[1]!.id).toBe(middleId)
      expect(rows[2]!.id).toBe(latestId)
    })
  })

  it("cross-user isolation: does NOT return another user's snoozed rows", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await setOrgContext(db, orgId, "owner", userA)

      const future = new Date(Date.now() + 60_000)
      // Seed a snoozed notification for user B
      await seedNotification(db, orgId, userB, { snoozedUntil: future })

      // Query for user A — should see nothing
      const rows = await listSnoozedNotifications(db, orgId, userA)
      expect(rows).toHaveLength(0)
    })
  })

  it("cross-org isolation: does NOT return another org's snoozed rows", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgA = await createOrganization(db, userA)
      const orgB = await createOrganization(db, userB)

      const future = new Date(Date.now() + 60_000)
      // Seed a snoozed notification in org B (must set org B context for RLS to allow insert)
      await setOrgContext(db, orgB, "owner", userB)
      await seedNotification(db, orgB, userB, { snoozedUntil: future })

      // Switch to org A context and query — should see nothing
      await setOrgContext(db, orgA, "owner", userA)
      const rows = await listSnoozedNotifications(db, orgA, userA)
      expect(rows).toHaveLength(0)
    })
  })
})

// ── unsnoozeNotification (DB behavior) ───────────────────────────────────────

describe("unsnoozeNotification (DB behavior)", () => {
  it("clears snoozedUntil on the target notification", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const future = new Date(Date.now() + 60_000)
      const notifId = await seedNotification(db, orgId, userId, { snoozedUntil: future })

      // Verify it's in the snoozed list
      const before = await listSnoozedNotifications(db, orgId, userId)
      expect(before).toHaveLength(1)

      // Simulate unsnooze action body (scoped to org + recipient)
      const result = await db
        .update(notifications)
        .set({ snoozedUntil: null, updatedAt: new Date() })
        .where(
          and(
            eq(notifications.id, notifId),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
          ),
        )
        .returning({ id: notifications.id, snoozedUntil: notifications.snoozedUntil })

      expect(result[0]!.id).toBe(notifId)
      expect(result[0]!.snoozedUntil).toBeNull()

      // Now absent from snoozed list and present in live list
      const snoozedAfter = await listSnoozedNotifications(db, orgId, userId)
      expect(snoozedAfter).toHaveLength(0)

      const liveAfter = await listNotifications(db, orgId, userId)
      expect(liveAfter.some((r) => r.id === notifId)).toBe(true)
    })
  })

  it("does NOT affect another user's snoozed notification (recipient-scoped)", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await setOrgContext(db, orgId, "owner", userA)

      const future = new Date(Date.now() + 60_000)
      // User B has a snoozed notification
      const notifBId = await seedNotification(db, orgId, userB, { snoozedUntil: future })

      // User A tries to unsnooze user B's notification — should affect 0 rows
      const result = await db
        .update(notifications)
        .set({ snoozedUntil: null, updatedAt: new Date() })
        .where(
          and(
            eq(notifications.id, notifBId),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userA), // wrong user
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(0)

      // User B's notification is still snoozed
      await setOrgContext(db, orgId, "owner", userB)
      const stillSnoozed = await listSnoozedNotifications(db, orgId, userB)
      expect(stillSnoozed).toHaveLength(1)
      expect(stillSnoozed[0]!.id).toBe(notifBId)
    })
  })

  it("after unsnooze the row is absent from snoozed and visible in live", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const future = new Date(Date.now() + 60_000)
      const notifId = await seedNotification(db, orgId, userId, { snoozedUntil: future })

      // Unsnooze
      await db
        .update(notifications)
        .set({ snoozedUntil: null, updatedAt: new Date() })
        .where(
          and(
            eq(notifications.id, notifId),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
          ),
        )

      const snoozedRows = await listSnoozedNotifications(db, orgId, userId)
      expect(snoozedRows.some((r) => r.id === notifId)).toBe(false)

      const liveRows = await listNotifications(db, orgId, userId)
      expect(liveRows.some((r) => r.id === notifId)).toBe(true)
    })
  })
})
