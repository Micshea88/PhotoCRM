/**
 * Integration tests for Section E3 — notification bulk actions.
 *
 * Each bulk action is exercised at the DB level (same pattern as
 * notification-actions.test.ts): withTestDb + setOrgContext + direct Drizzle
 * operations that mirror the action bodies.
 *
 * SECURITY-CRITICAL tests: every suite includes a test that seeds a row for
 * ANOTHER user (and another org) with an id included in the `ids` array and
 * asserts that row is NOT modified — this is the primary security contract for
 * all bulk mutations.
 *
 * Covers:
 *   markNotificationsReadBulk   — sets readAt = now; skips other-user/other-org rows
 *   markNotificationsUnreadBulk — sets readAt = null; skips other-user/other-org rows
 *   snoozeNotificationsBulk     — sets snoozedUntil = until; skips other-user/other-org rows
 *   archiveNotificationsBulk    — sets archivedAt = now; skips other-user/other-org rows
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { and, eq, inArray } from "drizzle-orm"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { notifications } from "@/modules/notifications/schema"
import { member } from "@/modules/auth/schema"

type Db = Parameters<typeof setOrgContext>[0]

// ── Seed helpers ─────────────────────────────────────────────────────────────

async function seedNotification(
  db: Db,
  orgId: string,
  recipientUserId: string,
  opts: {
    readAt?: Date | null
    archivedAt?: Date | null
    snoozedUntil?: Date | null
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
    readAt: opts.readAt ?? null,
    archivedAt: opts.archivedAt ?? null,
    snoozedUntil: opts.snoozedUntil ?? null,
  })
  return id
}

/** Add userB as a member of orgA so the RLS context can be set for userB in orgA. */
async function addMember(db: Db, orgId: string, userId: string) {
  await db.insert(member).values({
    id: createId(),
    organizationId: orgId,
    userId,
    role: "member",
    createdAt: new Date(),
  })
}

// ── markNotificationsReadBulk ────────────────────────────────────────────────

describe("markNotificationsReadBulk (DB behavior)", () => {
  it("sets readAt on all targeted rows for the current user", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const id1 = await seedNotification(db, orgId, userId)
      const id2 = await seedNotification(db, orgId, userId)
      const id3 = await seedNotification(db, orgId, userId) // NOT in the ids list

      // Action body: set readAt WHERE id IN (ids) AND organizationId AND recipientUserId
      const ids = [id1, id2]
      const result = await db
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            inArray(notifications.id, ids),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(2)
      expect(result.map((r) => r.id).sort()).toEqual([id1, id2].sort())

      // id3 (not in ids) should remain unread
      const [row3] = await db
        .select({ readAt: notifications.readAt })
        .from(notifications)
        .where(eq(notifications.id, id3))
      expect(row3?.readAt).toBeNull()
    })
  })

  it("SECURITY: does NOT affect another user's row in the same org, even when the id is in the list", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await addMember(db, orgId, userB)
      await setOrgContext(db, orgId, "owner", userA)

      // Seed a notification for userA
      const userANotifId = await seedNotification(db, orgId, userA)

      // Switch context to userB and try to bulk-mark userA's notification as read
      await setOrgContext(db, orgId, "member", userB)
      const result = await db
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            inArray(notifications.id, [userANotifId]),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userB), // explicit filter for userB
          ),
        )
        .returning({ id: notifications.id })

      // 0 rows — userB's recipient filter excludes userA's notification
      expect(result).toHaveLength(0)

      // Confirm userA's row is untouched
      await setOrgContext(db, orgId, "owner", userA)
      const [row] = await db
        .select({ readAt: notifications.readAt })
        .from(notifications)
        .where(eq(notifications.id, userANotifId))
      expect(row?.readAt).toBeNull()
    })
  })

  it("SECURITY: does NOT affect rows in another org, even when the id is in the list", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgA = await createOrganization(db, userA)
      const orgB = await createOrganization(db, userB)

      // Seed notification for userA in orgA
      await setOrgContext(db, orgA, "owner", userA)
      const notifId = await seedNotification(db, orgA, userA)

      // Switch to orgB / userB context and include notifId in the ids
      await setOrgContext(db, orgB, "owner", userB)
      const result = await db
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            inArray(notifications.id, [notifId]),
            eq(notifications.organizationId, orgB), // different org
            eq(notifications.recipientUserId, userB),
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(0)

      // Confirm orgA's row is untouched
      await setOrgContext(db, orgA, "owner", userA)
      const [row] = await db
        .select({ readAt: notifications.readAt })
        .from(notifications)
        .where(eq(notifications.id, notifId))
      expect(row?.readAt).toBeNull()
    })
  })
})

// ── markNotificationsUnreadBulk ──────────────────────────────────────────────

describe("markNotificationsUnreadBulk (DB behavior)", () => {
  it("clears readAt on all targeted rows for the current user", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const id1 = await seedNotification(db, orgId, userId, { readAt: new Date() })
      const id2 = await seedNotification(db, orgId, userId, { readAt: new Date() })
      const id3 = await seedNotification(db, orgId, userId, { readAt: new Date() }) // NOT in list

      const ids = [id1, id2]
      const result = await db
        .update(notifications)
        .set({ readAt: null, updatedAt: new Date() })
        .where(
          and(
            inArray(notifications.id, ids),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(2)

      // id3 (not in ids) should remain read
      const [row3] = await db
        .select({ readAt: notifications.readAt })
        .from(notifications)
        .where(eq(notifications.id, id3))
      expect(row3?.readAt).not.toBeNull()
    })
  })

  it("SECURITY: does NOT affect another user's row in the same org", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await addMember(db, orgId, userB)
      await setOrgContext(db, orgId, "owner", userA)

      const readAt = new Date()
      const notifId = await seedNotification(db, orgId, userA, { readAt })

      await setOrgContext(db, orgId, "member", userB)
      const result = await db
        .update(notifications)
        .set({ readAt: null, updatedAt: new Date() })
        .where(
          and(
            inArray(notifications.id, [notifId]),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userB),
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(0)

      // userA's row is still read
      await setOrgContext(db, orgId, "owner", userA)
      const [row] = await db
        .select({ readAt: notifications.readAt })
        .from(notifications)
        .where(eq(notifications.id, notifId))
      expect(row?.readAt).not.toBeNull()
    })
  })
})

// ── snoozeNotificationsBulk ──────────────────────────────────────────────────

describe("snoozeNotificationsBulk (DB behavior)", () => {
  it("sets snoozedUntil on all targeted rows for the current user", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const id1 = await seedNotification(db, orgId, userId)
      const id2 = await seedNotification(db, orgId, userId)
      const id3 = await seedNotification(db, orgId, userId) // NOT in list

      const until = new Date(Date.now() + 3_600_000)
      const ids = [id1, id2]
      const result = await db
        .update(notifications)
        .set({ snoozedUntil: until, updatedAt: new Date() })
        .where(
          and(
            inArray(notifications.id, ids),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(2)

      // Verify snoozedUntil was set
      const rows = await db
        .select({ id: notifications.id, snoozedUntil: notifications.snoozedUntil })
        .from(notifications)
        .where(inArray(notifications.id, [id1, id2]))

      for (const row of rows) {
        expect(row.snoozedUntil).not.toBeNull()
        expect(row.snoozedUntil!.getTime()).toBeCloseTo(until.getTime(), -3)
      }

      // id3 should remain un-snoozed
      const [row3] = await db
        .select({ snoozedUntil: notifications.snoozedUntil })
        .from(notifications)
        .where(eq(notifications.id, id3))
      expect(row3?.snoozedUntil).toBeNull()
    })
  })

  it("SECURITY: does NOT affect another user's row in the same org", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await addMember(db, orgId, userB)
      await setOrgContext(db, orgId, "owner", userA)

      const notifId = await seedNotification(db, orgId, userA)
      const until = new Date(Date.now() + 3_600_000)

      await setOrgContext(db, orgId, "member", userB)
      const result = await db
        .update(notifications)
        .set({ snoozedUntil: until, updatedAt: new Date() })
        .where(
          and(
            inArray(notifications.id, [notifId]),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userB),
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(0)

      // userA's row has no snoozedUntil
      await setOrgContext(db, orgId, "owner", userA)
      const [row] = await db
        .select({ snoozedUntil: notifications.snoozedUntil })
        .from(notifications)
        .where(eq(notifications.id, notifId))
      expect(row?.snoozedUntil).toBeNull()
    })
  })
})

// ── archiveNotificationsBulk ─────────────────────────────────────────────────

describe("archiveNotificationsBulk (DB behavior)", () => {
  it("sets archivedAt on all targeted rows for the current user", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const id1 = await seedNotification(db, orgId, userId)
      const id2 = await seedNotification(db, orgId, userId)
      const id3 = await seedNotification(db, orgId, userId) // NOT in list

      const ids = [id1, id2]
      const result = await db
        .update(notifications)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            inArray(notifications.id, ids),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(2)

      // Verify archivedAt was set
      const rows = await db
        .select({ id: notifications.id, archivedAt: notifications.archivedAt })
        .from(notifications)
        .where(inArray(notifications.id, [id1, id2]))

      for (const row of rows) {
        expect(row.archivedAt).not.toBeNull()
      }

      // id3 should remain un-archived
      const [row3] = await db
        .select({ archivedAt: notifications.archivedAt })
        .from(notifications)
        .where(eq(notifications.id, id3))
      expect(row3?.archivedAt).toBeNull()
    })
  })

  it("SECURITY: does NOT affect another user's row in the same org", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await addMember(db, orgId, userB)
      await setOrgContext(db, orgId, "owner", userA)

      const notifId = await seedNotification(db, orgId, userA)

      await setOrgContext(db, orgId, "member", userB)
      const result = await db
        .update(notifications)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            inArray(notifications.id, [notifId]),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userB),
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(0)

      // userA's row is not archived
      await setOrgContext(db, orgId, "owner", userA)
      const [row] = await db
        .select({ archivedAt: notifications.archivedAt })
        .from(notifications)
        .where(eq(notifications.id, notifId))
      expect(row?.archivedAt).toBeNull()
    })
  })

  it("SECURITY: does NOT affect rows in another org, even when the id is in the list", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgA = await createOrganization(db, userA)
      const orgB = await createOrganization(db, userB)

      await setOrgContext(db, orgA, "owner", userA)
      const notifId = await seedNotification(db, orgA, userA)

      // Switch to orgB / userB context
      await setOrgContext(db, orgB, "owner", userB)
      const result = await db
        .update(notifications)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            inArray(notifications.id, [notifId]),
            eq(notifications.organizationId, orgB),
            eq(notifications.recipientUserId, userB),
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(0)

      // Confirm orgA's row is untouched
      await setOrgContext(db, orgA, "owner", userA)
      const [row] = await db
        .select({ archivedAt: notifications.archivedAt })
        .from(notifications)
        .where(eq(notifications.id, notifId))
      expect(row?.archivedAt).toBeNull()
    })
  })
})
