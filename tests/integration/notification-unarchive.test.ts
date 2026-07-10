/**
 * Integration tests for Section E5 — unarchive actions.
 *
 * Covers:
 *   unarchiveNotification     — clears archivedAt; NOT_FOUND when row absent;
 *                               recipient+org scoped (other-user / other-org rows
 *                               with the same id in the list → UNCHANGED)
 *   unarchiveNotificationsBulk — clears archivedAt on all targeted rows;
 *                               skips other-user / other-org rows
 *
 * Pattern: withTestDb + setOrgContext + direct Drizzle operations mirroring
 * the action bodies. Matches notification-bulk-actions.test.ts.
 *
 * SECURITY-CRITICAL: every suite includes tests that seed a row for ANOTHER
 * user (and another org) with an id included in the `ids` array and asserts
 * that row is NOT modified.
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
    archivedAt?: Date | null
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
    archivedAt: opts.archivedAt ?? null,
  })
  return id
}

/** Add a user as a member of an org so the RLS context can be set for them. */
async function addMember(db: Db, orgId: string, userId: string) {
  await db.insert(member).values({
    id: createId(),
    organizationId: orgId,
    userId,
    role: "member",
    createdAt: new Date(),
  })
}

// ── unarchiveNotification ────────────────────────────────────────────────────

describe("unarchiveNotification (DB behavior)", () => {
  it("clears archivedAt on the targeted row", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const id = await seedNotification(db, orgId, userId, { archivedAt: new Date() })

      // Action body: set archivedAt = null WHERE id AND org AND recipient
      const result = await db
        .update(notifications)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(notifications.id, id),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe(id)

      // Confirm archivedAt is null
      const [row] = await db
        .select({ archivedAt: notifications.archivedAt })
        .from(notifications)
        .where(eq(notifications.id, id))
      expect(row?.archivedAt).toBeNull()
    })
  })

  it("returns 0 rows (NOT_FOUND equivalent) when the id does not exist for this user", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const result = await db
        .update(notifications)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(notifications.id, "nonexistent-id"),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(0)
    })
  })

  it("SECURITY: does NOT affect another user's archived row in the same org", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await addMember(db, orgId, userB)
      await setOrgContext(db, orgId, "owner", userA)

      const archivedAt = new Date()
      const notifId = await seedNotification(db, orgId, userA, { archivedAt })

      // Switch to userB context and try to unarchive userA's notification
      await setOrgContext(db, orgId, "member", userB)
      const result = await db
        .update(notifications)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(notifications.id, notifId),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userB), // explicit filter for userB
          ),
        )
        .returning({ id: notifications.id })

      // 0 rows — userB's recipient filter excludes userA's notification
      expect(result).toHaveLength(0)

      // Confirm userA's row is still archived
      await setOrgContext(db, orgId, "owner", userA)
      const [row] = await db
        .select({ archivedAt: notifications.archivedAt })
        .from(notifications)
        .where(eq(notifications.id, notifId))
      expect(row?.archivedAt).not.toBeNull()
    })
  })

  it("SECURITY: does NOT affect rows in another org, even when the id matches", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgA = await createOrganization(db, userA)
      const orgB = await createOrganization(db, userB)

      // Seed an archived notification for userA in orgA
      await setOrgContext(db, orgA, "owner", userA)
      const notifId = await seedNotification(db, orgA, userA, { archivedAt: new Date() })

      // Switch to orgB / userB context and try to unarchive
      await setOrgContext(db, orgB, "owner", userB)
      const result = await db
        .update(notifications)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(notifications.id, notifId),
            eq(notifications.organizationId, orgB), // different org
            eq(notifications.recipientUserId, userB),
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(0)

      // Confirm orgA's row is still archived
      await setOrgContext(db, orgA, "owner", userA)
      const [row] = await db
        .select({ archivedAt: notifications.archivedAt })
        .from(notifications)
        .where(eq(notifications.id, notifId))
      expect(row?.archivedAt).not.toBeNull()
    })
  })
})

// ── unarchiveNotificationsBulk ───────────────────────────────────────────────

describe("unarchiveNotificationsBulk (DB behavior)", () => {
  it("clears archivedAt on all targeted rows for the current user", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const id1 = await seedNotification(db, orgId, userId, { archivedAt: new Date() })
      const id2 = await seedNotification(db, orgId, userId, { archivedAt: new Date() })
      const id3 = await seedNotification(db, orgId, userId, { archivedAt: new Date() }) // NOT in list

      const ids = [id1, id2]
      const result = await db
        .update(notifications)
        .set({ archivedAt: null, updatedAt: new Date() })
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

      // Verify archivedAt is cleared on targeted rows
      const rows = await db
        .select({ id: notifications.id, archivedAt: notifications.archivedAt })
        .from(notifications)
        .where(inArray(notifications.id, [id1, id2]))

      for (const row of rows) {
        expect(row.archivedAt).toBeNull()
      }

      // id3 (not in ids) should still be archived
      const [row3] = await db
        .select({ archivedAt: notifications.archivedAt })
        .from(notifications)
        .where(eq(notifications.id, id3))
      expect(row3?.archivedAt).not.toBeNull()
    })
  })

  it("SECURITY: does NOT affect another user's archived row in the same org, even when its id is in the list", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await addMember(db, orgId, userB)
      await setOrgContext(db, orgId, "owner", userA)

      // Seed an archived notification for userA
      const notifId = await seedNotification(db, orgId, userA, { archivedAt: new Date() })

      // Switch context to userB and try to bulk-unarchive userA's notification
      await setOrgContext(db, orgId, "member", userB)
      const result = await db
        .update(notifications)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(
          and(
            inArray(notifications.id, [notifId]),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userB), // explicit filter for userB
          ),
        )
        .returning({ id: notifications.id })

      // 0 rows — userB's recipient filter excludes userA's notification
      expect(result).toHaveLength(0)

      // Confirm userA's row is still archived
      await setOrgContext(db, orgId, "owner", userA)
      const [row] = await db
        .select({ archivedAt: notifications.archivedAt })
        .from(notifications)
        .where(eq(notifications.id, notifId))
      expect(row?.archivedAt).not.toBeNull()
    })
  })

  it("SECURITY: does NOT affect rows in another org, even when the id is in the list", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgA = await createOrganization(db, userA)
      const orgB = await createOrganization(db, userB)

      // Seed an archived notification for userA in orgA
      await setOrgContext(db, orgA, "owner", userA)
      const notifId = await seedNotification(db, orgA, userA, { archivedAt: new Date() })

      // Switch to orgB / userB context and include notifId in the ids
      await setOrgContext(db, orgB, "owner", userB)
      const result = await db
        .update(notifications)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(
          and(
            inArray(notifications.id, [notifId]),
            eq(notifications.organizationId, orgB), // different org
            eq(notifications.recipientUserId, userB),
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(0)

      // Confirm orgA's row is still archived
      await setOrgContext(db, orgA, "owner", userA)
      const [row] = await db
        .select({ archivedAt: notifications.archivedAt })
        .from(notifications)
        .where(eq(notifications.id, notifId))
      expect(row?.archivedAt).not.toBeNull()
    })
  })
})
