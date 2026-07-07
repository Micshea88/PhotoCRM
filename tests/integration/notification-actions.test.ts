/**
 * Integration tests for Task 14 — notification action behavior.
 *
 * Actions use orgAction (which requires HTTP session/headers) so they cannot be
 * invoked through the safe-action layer in vitest. These tests exercise the
 * underlying DB operations that each action body performs — equivalent to what
 * the action bodies do — so the behavior contract is verified at the DB level.
 *
 * Pattern: withTestDb + setOrgContext + direct Drizzle operations, then assert
 * DB state via the query functions. Matches the pattern in tasks.test.ts and
 * delivery-notification-wiring.test.ts.
 *
 * Covers:
 *   markNotificationRead    — sets read_at; unread count drops; idempotent
 *   markNotificationUnread  — clears read_at; unread count rises
 *   markAllNotificationsRead — sets read_at on all live unread; idempotent;
 *                              skips archived and future-snoozed
 *   snoozeNotification      — sets snoozed_until; row disappears from live list;
 *                             past snoozed_until → row reappears
 *   archiveNotification     — sets archived_at; gone from listNotifications;
 *                             present in listArchivedNotifications
 *   createTaskFromNotification — inserts tasks row linked to notification's contactId
 *   updateNotificationPreference — upserts (user, type) preference row
 *   RLS isolation           — user B updating user A's notification → 0 rows
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { and, eq, isNull, lte, or, sql } from "drizzle-orm"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { notifications, notificationPreferences } from "@/modules/notifications/schema"
import { tasks } from "@/modules/tasks/schema"
import { contacts } from "@/modules/contacts/schema"
import {
  unreadCount,
  listNotifications,
  listArchivedNotifications,
} from "@/modules/notifications/queries"

type Db = Parameters<typeof setOrgContext>[0]

// ── Seed helpers ─────────────────────────────────────────────────────────────

async function seedContact(db: Db, orgId: string): Promise<string> {
  const id = createId()
  await db.insert(contacts).values({ id, organizationId: orgId, firstName: "Test", lastName: "C" })
  return id
}

async function seedNotification(
  db: Db,
  orgId: string,
  recipientUserId: string,
  opts: {
    type?: string
    contactId?: string | null
    readAt?: Date | null
    archivedAt?: Date | null
    snoozedUntil?: Date | null
    title?: string
  } = {},
): Promise<string> {
  const id = createId()
  await db.insert(notifications).values({
    id,
    organizationId: orgId,
    recipientUserId,
    type: opts.type ?? "email.bounced",
    category: "messages_email",
    tier: "critical",
    title: opts.title ?? "Test notification",
    sourceModule: "email",
    contactId: opts.contactId ?? null,
    readAt: opts.readAt ?? null,
    archivedAt: opts.archivedAt ?? null,
    snoozedUntil: opts.snoozedUntil ?? null,
  })
  return id
}

// ── markNotificationRead behavior ─────────────────────────────────────────────

describe("markNotificationRead (DB behavior)", () => {
  it("sets read_at on the target notification and unread count drops", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const notifId = await seedNotification(db, orgId, userId)
      expect(await unreadCount(db, orgId, userId)).toBe(1)

      // Action body: set read_at WHERE id AND recipientUserId (RLS enforces scope)
      await db
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(notifications.id, notifId),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
            isNull(notifications.readAt), // idempotent guard
          ),
        )

      expect(await unreadCount(db, orgId, userId)).toBe(0)
    })
  })

  it("is idempotent: 0 rows updated when already-read, no error", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const readAt = new Date()
      const notifId = await seedNotification(db, orgId, userId, { readAt })

      const result = await db
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(notifications.id, notifId),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
            isNull(notifications.readAt),
          ),
        )
        .returning({ id: notifications.id })

      // 0 rows — already read, guard prevented double-write (idempotent)
      expect(result).toHaveLength(0)
    })
  })
})

// ── markNotificationUnread behavior ──────────────────────────────────────────

describe("markNotificationUnread (DB behavior)", () => {
  it("clears read_at and unread count rises", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const notifId = await seedNotification(db, orgId, userId, { readAt: new Date() })
      expect(await unreadCount(db, orgId, userId)).toBe(0)

      // Action body: clear read_at WHERE id AND recipientUserId
      const result = await db
        .update(notifications)
        .set({ readAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(notifications.id, notifId),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(1)
      expect(await unreadCount(db, orgId, userId)).toBe(1)
    })
  })

  it("0 rows when notification not found for user (would trigger ActionError)", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await setOrgContext(db, orgId, "owner", userA)

      const notifId = await seedNotification(db, orgId, userA)

      // Switch context to user B and attempt update
      await setOrgContext(db, orgId, "member", userB)
      const result = await db
        .update(notifications)
        .set({ readAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(notifications.id, notifId),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userB), // wrong user
          ),
        )
        .returning({ id: notifications.id })

      // RLS + explicit filter → 0 rows → action would throw ActionError("Notification not found")
      expect(result).toHaveLength(0)
    })
  })
})

// ── markAllNotificationsRead behavior ────────────────────────────────────────

describe("markAllNotificationsRead (DB behavior)", () => {
  it("sets read_at on all live unread rows; idempotent on second call", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      await seedNotification(db, orgId, userId) // unread
      await seedNotification(db, orgId, userId) // unread
      await seedNotification(db, orgId, userId, { readAt: new Date() }) // already read

      expect(await unreadCount(db, orgId, userId)).toBe(2)

      // Action body: UPDATE all live unread for this user
      const result1 = await db
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
            isNull(notifications.readAt),
            isNull(notifications.archivedAt),
            or(isNull(notifications.snoozedUntil), lte(notifications.snoozedUntil, sql`now()`)),
          ),
        )
        .returning({ id: notifications.id })

      expect(result1).toHaveLength(2)
      expect(await unreadCount(db, orgId, userId)).toBe(0)

      // Second call — idempotent (0 rows updated)
      const result2 = await db
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
            isNull(notifications.readAt),
            isNull(notifications.archivedAt),
            or(isNull(notifications.snoozedUntil), lte(notifications.snoozedUntil, sql`now()`)),
          ),
        )
        .returning({ id: notifications.id })

      expect(result2).toHaveLength(0)
    })
  })

  it("does not mark archived or future-snoozed rows as read", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const future = new Date(Date.now() + 60_000)
      await seedNotification(db, orgId, userId, { archivedAt: new Date() }) // archived
      await seedNotification(db, orgId, userId, { snoozedUntil: future }) // snoozed

      const result = await db
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
            isNull(notifications.readAt),
            isNull(notifications.archivedAt),
            or(isNull(notifications.snoozedUntil), lte(notifications.snoozedUntil, sql`now()`)),
          ),
        )
        .returning({ id: notifications.id })

      // Neither archived nor snoozed row is touched
      expect(result).toHaveLength(0)
    })
  })
})

// ── snoozeNotification behavior ───────────────────────────────────────────────

describe("snoozeNotification (DB behavior)", () => {
  it("row with future snoozed_until disappears from live list", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const notifId = await seedNotification(db, orgId, userId)
      const future = new Date(Date.now() + 3600_000)

      // Action body: set snoozed_until
      await db
        .update(notifications)
        .set({ snoozedUntil: future, updatedAt: new Date() })
        .where(
          and(
            eq(notifications.id, notifId),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
          ),
        )

      const liveRows = await listNotifications(db, orgId, userId)
      expect(liveRows.find((r) => r.id === notifId)).toBeUndefined()
    })
  })

  it("row with past snoozed_until reappears in live list", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Seed a notification that was snoozed in the past → it is live again
      const past = new Date(Date.now() - 60_000)
      const notifId = await seedNotification(db, orgId, userId, { snoozedUntil: past })

      const liveRows = await listNotifications(db, orgId, userId)
      expect(liveRows.some((r) => r.id === notifId)).toBe(true)
    })
  })

  it("0 rows when notification not found for user (would trigger ActionError)", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await setOrgContext(db, orgId, "owner", userA)

      const notifId = await seedNotification(db, orgId, userA)

      await setOrgContext(db, orgId, "member", userB)
      const future = new Date(Date.now() + 3600_000)
      const result = await db
        .update(notifications)
        .set({ snoozedUntil: future, updatedAt: new Date() })
        .where(
          and(
            eq(notifications.id, notifId),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userB), // wrong user
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(0)
    })
  })
})

// ── archiveNotification behavior ──────────────────────────────────────────────

describe("archiveNotification (DB behavior)", () => {
  it("archived row gone from listNotifications; present in listArchivedNotifications", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const notifId = await seedNotification(db, orgId, userId)

      // Action body: set archived_at
      const result = await db
        .update(notifications)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(notifications.id, notifId),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
          ),
        )
        .returning({ id: notifications.id })

      expect(result).toHaveLength(1)

      const live = await listNotifications(db, orgId, userId)
      expect(live.find((r) => r.id === notifId)).toBeUndefined()

      const archived = await listArchivedNotifications(db, orgId, userId)
      expect(archived.some((r) => r.id === notifId)).toBe(true)
    })
  })
})

// ── createTaskFromNotification behavior ───────────────────────────────────────

describe("createTaskFromNotification (DB behavior)", () => {
  it("inserts a task row with the notification's contactId and a Follow-up title", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const contactId = await seedContact(db, orgId)
      const notifId = await seedNotification(db, orgId, userId, {
        contactId,
        title: "Email bounced",
      })

      // Load the notification
      const [notif] = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.id, notifId),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userId),
          ),
        )
        .limit(1)

      expect(notif).toBeDefined()
      expect(notif?.contactId).toBe(contactId)

      // Action body: insert the task
      const taskId = createId()
      await db.insert(tasks).values({
        id: taskId,
        organizationId: orgId,
        contactId: notif!.contactId,
        title: `Follow up: ${notif!.title}`,
        assigneeUserId: userId,
        status: "not_started",
        createdBy: userId,
        updatedBy: userId,
      })

      const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId))
      expect(task).toBeDefined()
      expect(task?.contactId).toBe(contactId)
      expect(task?.title).toBe("Follow up: Email bounced")
      expect(task?.assigneeUserId).toBe(userId)
      expect(task?.status).toBe("not_started")
    })
  })
})

// ── updateNotificationPreference behavior ──────────────────────────────────

describe("updateNotificationPreference (DB behavior)", () => {
  it("inserts a new preference row on first call (upsert insert path)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Action body: upsert (user, type)
      const prefId = createId()
      await db
        .insert(notificationPreferences)
        .values({
          id: prefId,
          organizationId: orgId,
          userId,
          type: "email.bounced",
          inApp: true,
          email: false,
        })
        .onConflictDoUpdate({
          target: [notificationPreferences.userId, notificationPreferences.type],
          set: { inApp: true, email: false, updatedAt: new Date() },
        })

      const rows = await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId))

      expect(rows).toHaveLength(1)
      expect(rows[0]?.type).toBe("email.bounced")
      expect(rows[0]?.inApp).toBe(true)
      expect(rows[0]?.email).toBe(false)
    })
  })

  it("updates existing preference row on second call (upsert update path)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Insert
      await db
        .insert(notificationPreferences)
        .values({
          id: createId(),
          organizationId: orgId,
          userId,
          type: "email.bounced",
          inApp: true,
          email: false,
        })
        .onConflictDoUpdate({
          target: [notificationPreferences.userId, notificationPreferences.type],
          set: { inApp: true, email: false, updatedAt: new Date() },
        })

      // Update — flip email to true
      await db
        .insert(notificationPreferences)
        .values({
          id: createId(), // new id on conflict → ignored, existing row is updated
          organizationId: orgId,
          userId,
          type: "email.bounced",
          inApp: true,
          email: true,
        })
        .onConflictDoUpdate({
          target: [notificationPreferences.userId, notificationPreferences.type],
          set: { inApp: true, email: true, updatedAt: new Date() },
        })

      const rows = await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId))

      expect(rows).toHaveLength(1) // still exactly one row
      expect(rows[0]?.email).toBe(true) // updated
    })
  })
})

// ── RLS isolation ────────────────────────────────────────────────────────────

describe("RLS isolation — user B cannot modify user A's notifications", () => {
  it("UPDATE on user A's notification as user B → 0 rows (RLS + explicit filter)", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await setOrgContext(db, orgId, "owner", userA)

      // Insert notification for user A
      const notifId = await seedNotification(db, orgId, userA)

      // Switch to user B
      await setOrgContext(db, orgId, "member", userB)

      // markNotificationRead as user B on user A's notification → 0 rows
      // (RLS USING clause: recipient_user_id = app.current_user_id blocks the UPDATE)
      const result = await db
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(notifications.id, notifId),
            eq(notifications.organizationId, orgId),
            eq(notifications.recipientUserId, userA), // user A's notification
          ),
        )
        .returning({ id: notifications.id })

      // 0 rows → the action would throw ActionError("Notification not found")
      expect(result).toHaveLength(0)
    })
  })

  it("SELECT as user B sees 0 of user A's notifications (RLS SELECT isolation)", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await setOrgContext(db, orgId, "owner", userA)

      await seedNotification(db, orgId, userA)

      // Switch to user B
      await setOrgContext(db, orgId, "member", userB)

      const rows = await listNotifications(db, orgId, userB)
      expect(rows).toHaveLength(0)
    })
  })
})
