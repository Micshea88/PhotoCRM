/**
 * Integration tests for Task 11 — delivery-event → notification wiring.
 *
 * Verifies that `recordDeliveryEventInTx` emits in-app notifications for
 * critical delivery events (bounced / complained / failed) and does NOT emit
 * for non-critical events (delivered / sent).
 *
 * Uses withTestDb so every test runs inside a rolled-back transaction.
 * setOrgContext sets app.current_org (required by all org-scoped tables) and
 * app.current_role (required for member_role INSERT).
 *
 * Covers:
 *   1. bounced event  → notifications for sender + admin, correct fields
 *   2. delivered event → no notifications
 *   3. dedup: sender is also an admin → one notification row, not two
 */
import { describe, it, expect } from "vitest"
import { eq, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { emailLog } from "@/modules/email-log/schema"
import { notifications } from "@/modules/notifications/schema"
import { memberRole } from "@/modules/rbac/schema"
import { contacts } from "@/modules/contacts/schema"
import { recordDeliveryEventInTx } from "@/modules/email-delivery/ingest"

type Db = Parameters<typeof setOrgContext>[0]

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function seedContact(db: Db, orgId: string): Promise<string> {
  const id = createId()
  await db.insert(contacts).values({
    id,
    organizationId: orgId,
    firstName: "Alice",
    lastName: "Testcontact",
  })
  return id
}

async function seedEmailLog(
  db: Db,
  orgId: string,
  opts: {
    userId?: string | null
    contactId?: string | null
    subject?: string | null
    deliveryStatus?: string
  } = {},
): Promise<string> {
  const id = createId()
  await db.insert(emailLog).values({
    id,
    organizationId: orgId,
    userId: opts.userId ?? null,
    contactId: opts.contactId ?? null,
    subject: opts.subject ?? null,
    direction: "outbound",
    sentAt: new Date("2026-07-04T10:00:00Z"),
    source: "resend",
    deliveryStatus: opts.deliveryStatus ?? "sent",
  })
  return id
}

/** Inserts a member_role row. Requires app.current_org + app.current_role='owner'|'admin'. */
async function seedMemberRole(db: Db, orgId: string, userId: string, role: string): Promise<void> {
  await db.insert(memberRole).values({
    id: createId(),
    organizationId: orgId,
    userId,
    role,
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("delivery-notification wiring (Task 11)", () => {
  it("bounced event: creates email.bounced notifications for sender and admin", async () => {
    await withTestDb(async (db) => {
      // Seed org + sender as owner
      const senderId = await createUser(db)
      const orgId = await createOrganization(db, senderId)
      await setOrgContext(db, orgId, "owner", senderId)

      // Seed a separate admin user
      const adminId = await createUser(db)

      // Seed member_role rows (member_role INSERT requires role=owner/admin in context)
      await seedMemberRole(db, orgId, senderId, "owner")
      await seedMemberRole(db, orgId, adminId, "admin")

      // Seed contact + email_log with userId, contactId, subject
      const contactId = await seedContact(db, orgId)
      const emailLogId = await seedEmailLog(db, orgId, {
        userId: senderId,
        contactId,
        subject: "Hello World",
      })

      const result = await recordDeliveryEventInTx(db, {
        organizationId: orgId,
        emailLogId,
        path: "resend",
        type: "bounced",
        bounceClass: "hard",
        detail: { reason: "5.1.1 User unknown" },
        providerEventId: `svix-${createId()}`,
        occurredAt: new Date("2026-07-04T11:00:00Z"),
      })
      expect(result).toEqual({ recorded: true })

      // ── Sender's notification ──────────────────────────────────────────────
      await db.execute(sql`SELECT set_config('app.current_user_id', ${senderId}, true)`)
      const senderNotifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, senderId))

      expect(senderNotifs).toHaveLength(1)
      const sn = senderNotifs[0]!
      expect(sn.type).toBe("email.bounced")
      expect(sn.tier).toBe("critical")
      expect(sn.contactId).toBe(contactId)
      expect(sn.title).toBe("Email couldn't be delivered")
      expect(sn.body).toContain("Hello World")
      expect(sn.body).toContain("5.1.1 User unknown")
      expect(sn.payload).toMatchObject({ emailLogId })
      expect(sn.sourceModule).toBe("email")
      expect(sn.linkPath).toBe(`/contacts/${contactId}`)

      // ── Admin's notification ───────────────────────────────────────────────
      await db.execute(sql`SELECT set_config('app.current_user_id', ${adminId}, true)`)
      const adminNotifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, adminId))

      expect(adminNotifs).toHaveLength(1)
      const an = adminNotifs[0]!
      expect(an.type).toBe("email.bounced")
      expect(an.tier).toBe("critical")
      expect(an.contactId).toBe(contactId)
      expect(an.payload).toMatchObject({ emailLogId })
    })
  })

  it("delivered event: creates NO notification", async () => {
    await withTestDb(async (db) => {
      const senderId = await createUser(db)
      const orgId = await createOrganization(db, senderId)
      await setOrgContext(db, orgId, "owner", senderId)
      await seedMemberRole(db, orgId, senderId, "owner")

      const emailLogId = await seedEmailLog(db, orgId, { userId: senderId })

      const result = await recordDeliveryEventInTx(db, {
        organizationId: orgId,
        emailLogId,
        path: "resend",
        type: "delivered",
        providerEventId: `svix-${createId()}`,
        occurredAt: new Date("2026-07-04T11:00:00Z"),
      })
      expect(result).toEqual({ recorded: true })

      // Verify no notification rows were created for the sender
      await db.execute(sql`SELECT set_config('app.current_user_id', ${senderId}, true)`)
      const notifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.organizationId, orgId))
      expect(notifs).toHaveLength(0)
    })
  })

  it("dedup: sender who is also the admin gets exactly one notification", async () => {
    await withTestDb(async (db) => {
      const senderId = await createUser(db)
      const orgId = await createOrganization(db, senderId)
      await setOrgContext(db, orgId, "owner", senderId)

      // Sender IS the owner — they appear in both "sender" and "admin" recipient sets
      await seedMemberRole(db, orgId, senderId, "owner")

      const emailLogId = await seedEmailLog(db, orgId, { userId: senderId })

      await recordDeliveryEventInTx(db, {
        organizationId: orgId,
        emailLogId,
        path: "resend",
        type: "bounced",
        providerEventId: `svix-${createId()}`,
        occurredAt: new Date("2026-07-04T11:00:00Z"),
      })

      await db.execute(sql`SELECT set_config('app.current_user_id', ${senderId}, true)`)
      const notifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, senderId))

      // Deduped → exactly one row, not two
      expect(notifs).toHaveLength(1)
    })
  })

  it("complained event: creates email.complained notification with correct title/body", async () => {
    await withTestDb(async (db) => {
      const senderId = await createUser(db)
      const orgId = await createOrganization(db, senderId)
      await setOrgContext(db, orgId, "owner", senderId)
      await seedMemberRole(db, orgId, senderId, "owner")

      const emailLogId = await seedEmailLog(db, orgId, {
        userId: senderId,
        subject: "My Campaign",
      })

      await recordDeliveryEventInTx(db, {
        organizationId: orgId,
        emailLogId,
        path: "resend",
        type: "complained",
        providerEventId: `svix-${createId()}`,
        occurredAt: new Date("2026-07-04T11:00:00Z"),
      })

      await db.execute(sql`SELECT set_config('app.current_user_id', ${senderId}, true)`)
      const notifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, senderId))

      expect(notifs).toHaveLength(1)
      const n = notifs[0]!
      expect(n.type).toBe("email.complained")
      expect(n.title).toBe("Spam complaint")
      expect(n.body).toContain("My Campaign")
      expect(n.body).toContain("spam")
    })
  })

  it("failed event: creates email.send_failed notification with correct title/body", async () => {
    await withTestDb(async (db) => {
      const senderId = await createUser(db)
      const orgId = await createOrganization(db, senderId)
      await setOrgContext(db, orgId, "owner", senderId)
      await seedMemberRole(db, orgId, senderId, "owner")

      const emailLogId = await seedEmailLog(db, orgId, {
        userId: senderId,
        subject: "Important Update",
      })

      await recordDeliveryEventInTx(db, {
        organizationId: orgId,
        emailLogId,
        path: "resend",
        type: "failed",
        detail: { error: "Rate limit exceeded" },
        providerEventId: `svix-${createId()}`,
        occurredAt: new Date("2026-07-04T11:00:00Z"),
      })

      await db.execute(sql`SELECT set_config('app.current_user_id', ${senderId}, true)`)
      const notifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, senderId))

      expect(notifs).toHaveLength(1)
      const n = notifs[0]!
      expect(n.type).toBe("email.send_failed")
      expect(n.title).toBe("Email failed to send")
      expect(n.body).toContain("Important Update")
      expect(n.body).toContain("Rate limit exceeded")
    })
  })

  it("no recipients: email_log with no userId and no org admins → no notifications", async () => {
    await withTestDb(async (db) => {
      const ownerId = await createUser(db)
      const orgId = await createOrganization(db, ownerId)
      await setOrgContext(db, orgId, "owner", ownerId)
      // No member_role rows → no owner/admin recipients
      // No userId on the email_log → no sender

      const emailLogId = await seedEmailLog(db, orgId, {
        userId: null,
        // No member_role rows seeded
      })

      const result = await recordDeliveryEventInTx(db, {
        organizationId: orgId,
        emailLogId,
        path: "resend",
        type: "bounced",
        providerEventId: `svix-${createId()}`,
        occurredAt: new Date("2026-07-04T11:00:00Z"),
      })

      expect(result).toEqual({ recorded: true })

      // No notifications because recipient list was empty
      await db.execute(sql`SELECT set_config('app.current_user_id', ${ownerId}, true)`)
      const notifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.organizationId, orgId))
      expect(notifs).toHaveLength(0)
    })
  })
})
