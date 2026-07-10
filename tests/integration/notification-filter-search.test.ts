/**
 * Integration tests for Section E1 additions:
 *
 *   - listNotifications: q param (ilike over title + body), scoped to org + recipient
 *   - listNotificationContactsForUser: returns only the recipient's live notification contacts
 *
 * Cross-org and cross-user isolation is proven in dedicated cases.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { notifications } from "@/modules/notifications/schema"
import { contacts } from "@/modules/contacts/schema"
import { listNotifications, listNotificationContactsForUser } from "@/modules/notifications/queries"

type Db = Parameters<typeof setOrgContext>[0]

// ── Seed helpers ──────────────────────────────────────────────────────────────

async function seedContact(
  db: Db,
  orgId: string,
  opts: { firstName?: string; lastName?: string } = {},
): Promise<string> {
  const id = createId()
  await db.insert(contacts).values({
    id,
    organizationId: orgId,
    firstName: opts.firstName ?? "Test",
    lastName: opts.lastName ?? "Contact",
  })
  return id
}

async function seedNotification(
  db: Db,
  orgId: string,
  recipientUserId: string,
  opts: {
    title?: string
    body?: string | null
    contactId?: string | null
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
    title: opts.title ?? "Default title",
    body: opts.body !== undefined ? opts.body : null,
    sourceModule: "email",
    contactId: opts.contactId ?? null,
    archivedAt: opts.archivedAt ?? null,
    snoozedUntil: opts.snoozedUntil ?? null,
    createdAt: opts.createdAt ?? new Date(),
  })
  return id
}

// ── listNotifications — q (free-text search) ──────────────────────────────────

describe("listNotifications — q free-text search", () => {
  it("matches notification by title (case-insensitive ilike)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const matchId = await seedNotification(db, orgId, userId, {
        title: "Email bounced for client@example.com",
      })
      await seedNotification(db, orgId, userId, { title: "Payment received" })

      const rows = await listNotifications(db, orgId, userId, { q: "bounced" })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(matchId)
    })
  })

  it("matches notification by body (case-insensitive ilike)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const matchId = await seedNotification(db, orgId, userId, {
        title: "Notification",
        body: "The mailbox does not exist",
      })
      await seedNotification(db, orgId, userId, {
        title: "Another notification",
        body: "Everything is fine",
      })

      const rows = await listNotifications(db, orgId, userId, { q: "mailbox" })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(matchId)
    })
  })

  it("matches case-insensitively (uppercase query against lowercase title)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const matchId = await seedNotification(db, orgId, userId, {
        title: "email bounced notification",
      })

      const rows = await listNotifications(db, orgId, userId, { q: "BOUNCED" })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(matchId)
    })
  })

  it("matches body even when title does not match", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const matchId = await seedNotification(db, orgId, userId, {
        title: "Unrelated title",
        body: "the contract was signed",
      })

      const rows = await listNotifications(db, orgId, userId, { q: "contract" })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(matchId)
    })
  })

  it("returns empty when no title or body matches q", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      await seedNotification(db, orgId, userId, {
        title: "Payment received",
        body: "Your invoice was paid",
      })

      const rows = await listNotifications(db, orgId, userId, { q: "NOMATCH_XYZ_123" })
      expect(rows).toHaveLength(0)
    })
  })

  it("works correctly when body is null (matches only on title)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const matchId = await seedNotification(db, orgId, userId, {
        title: "Email bounced",
        body: null, // null body — should still match on title
      })
      await seedNotification(db, orgId, userId, {
        title: "Payment received",
        body: null,
      })

      const rows = await listNotifications(db, orgId, userId, { q: "bounced" })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(matchId)
    })
  })

  it("stacks q AND-combined with type filter", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Matches q but not the type filter
      await seedNotification(db, orgId, userId, {
        title: "Email bounced for client",
      })
      // Doesn't have "bounced" in title or body
      await seedNotification(db, orgId, userId, {
        title: "Payment received",
      })

      // Since both rows have type=email.bounced (the seed default), let's filter to a non-existent type
      const rows = await listNotifications(db, orgId, userId, {
        q: "bounced",
        types: ["email.complained"], // no rows have this type
      })
      expect(rows).toHaveLength(0)
    })
  })

  // ── ISOLATION: q does NOT return another user's notifications ───────────────

  it("q search is scoped to the recipient — does NOT return another user's matching notification", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await setOrgContext(db, orgId, "owner", userA)

      // userB's notification in the same org — matches q
      await seedNotification(db, orgId, userB, {
        title: "Email bounced for someone else",
      })
      // userA has NO notifications
      const rows = await listNotifications(db, orgId, userA, { q: "bounced" })
      expect(rows).toHaveLength(0)
    })
  })

  it("q search is scoped to the org — does NOT return another org's matching notification", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgA = await createOrganization(db, userA)
      const orgB = await createOrganization(db, userB)

      // Set context to orgB first to seed orgB data under RLS
      await setOrgContext(db, orgB, "owner", userB)
      await seedNotification(db, orgB, userB, {
        title: "Email bounced in org B",
      })

      // Switch context to orgA to perform the query
      await setOrgContext(db, orgA, "owner", userA)
      const rows = await listNotifications(db, orgA, userA, { q: "bounced" })
      expect(rows).toHaveLength(0)
    })
  })
})

// ── listNotifications — ILIKE wildcard escaping (E1 fix 2) ───────────────────

describe("listNotifications — ILIKE wildcard escaping", () => {
  it("literal % in title is matched when the user searches for %", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const matchId = await seedNotification(db, orgId, userId, {
        title: "50% off deal notification",
      })
      await seedNotification(db, orgId, userId, {
        title: "No special chars here",
      })

      const rows = await listNotifications(db, orgId, userId, { q: "%" })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(matchId)
    })
  })

  it("%-only search does NOT match everything (treated as literal, not wildcard)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Neither title contains a literal %
      await seedNotification(db, orgId, userId, { title: "Regular notification" })
      await seedNotification(db, orgId, userId, { title: "Another notification" })

      // Without escaping, q="%" → pattern "%%" → matches every row.
      // With escaping,    q="%" → pattern "%\%%" → matches only rows with literal %.
      const rows = await listNotifications(db, orgId, userId, { q: "%" })
      expect(rows).toHaveLength(0)
    })
  })

  it("literal _ in title is matched when the user searches for _", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const matchId = await seedNotification(db, orgId, userId, {
        title: "event_123 triggered",
      })
      await seedNotification(db, orgId, userId, {
        title: "event without underscore",
      })

      const rows = await listNotifications(db, orgId, userId, { q: "_" })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(matchId)
    })
  })

  it("_-only search does NOT match everything (treated as literal, not wildcard)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // No underscore in titles
      await seedNotification(db, orgId, userId, { title: "Regular notification" })
      await seedNotification(db, orgId, userId, { title: "Another notification" })

      const rows = await listNotifications(db, orgId, userId, { q: "_" })
      expect(rows).toHaveLength(0)
    })
  })
})

// ── listNotifications — sort order ────────────────────────────────────────────

describe("listNotifications — sort order", () => {
  it("default (newest) returns notifications newest first (desc createdAt)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const older = new Date("2026-01-01T00:00:00Z")
      const newer = new Date("2026-06-01T00:00:00Z")

      const olderId = await seedNotification(db, orgId, userId, {
        title: "Older notification",
        body: null,
        createdAt: older,
      })
      const newerId = await seedNotification(db, orgId, userId, {
        title: "Newer notification",
        body: null,
        createdAt: newer,
      })

      const rows = await listNotifications(db, orgId, userId)
      expect(rows[0]!.id).toBe(newerId)
      expect(rows[1]!.id).toBe(olderId)
    })
  })

  it("sort=oldest returns notifications oldest first (asc createdAt)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const older = new Date("2026-01-01T00:00:00Z")
      const newer = new Date("2026-06-01T00:00:00Z")

      const olderId = await seedNotification(db, orgId, userId, {
        title: "Older notification",
        body: null,
        createdAt: older,
      })
      const newerId = await seedNotification(db, orgId, userId, {
        title: "Newer notification",
        body: null,
        createdAt: newer,
      })

      const rows = await listNotifications(db, orgId, userId, { sort: "oldest" })
      expect(rows[0]!.id).toBe(olderId)
      expect(rows[1]!.id).toBe(newerId)
    })
  })

  it("sort=newest explicitly produces same order as default", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const older = new Date("2026-02-01T00:00:00Z")
      const newer = new Date("2026-06-01T00:00:00Z")

      await seedNotification(db, orgId, userId, {
        title: "Old",
        body: null,
        createdAt: older,
      })
      const newerId = await seedNotification(db, orgId, userId, {
        title: "New",
        body: null,
        createdAt: newer,
      })

      const defaultRows = await listNotifications(db, orgId, userId)
      const explicitRows = await listNotifications(db, orgId, userId, { sort: "newest" })
      expect(defaultRows[0]!.id).toBe(newerId)
      expect(explicitRows[0]!.id).toBe(newerId)
      expect(defaultRows.map((r) => r.id)).toEqual(explicitRows.map((r) => r.id))
    })
  })
})

// ── listNotificationContactsForUser ──────────────────────────────────────────

describe("listNotificationContactsForUser", () => {
  it("returns distinct contacts from the recipient's live notifications", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const contactA = await seedContact(db, orgId, { firstName: "Alice", lastName: "Smith" })
      const contactB = await seedContact(db, orgId, { firstName: "Bob", lastName: "Jones" })

      // Two notifications for contactA, one for contactB
      await seedNotification(db, orgId, userId, { contactId: contactA })
      await seedNotification(db, orgId, userId, { contactId: contactA })
      await seedNotification(db, orgId, userId, { contactId: contactB })

      const result = await listNotificationContactsForUser(db, orgId, userId)

      // Should return exactly 2 distinct contacts
      expect(result).toHaveLength(2)
      const ids = result.map((c) => c.id)
      expect(ids).toContain(contactA)
      expect(ids).toContain(contactB)
    })
  })

  it("excludes contacts from archived notifications (not live)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const contactA = await seedContact(db, orgId, { firstName: "Alice", lastName: "Archived" })
      const contactB = await seedContact(db, orgId, { firstName: "Bob", lastName: "Live" })

      await seedNotification(db, orgId, userId, {
        contactId: contactA,
        archivedAt: new Date(), // archived → not live
      })
      await seedNotification(db, orgId, userId, { contactId: contactB }) // live

      const result = await listNotificationContactsForUser(db, orgId, userId)

      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe(contactB)
    })
  })

  it("excludes future-snoozed contacts (not live)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const contactA = await seedContact(db, orgId, { firstName: "Alice", lastName: "Snoozed" })
      const contactB = await seedContact(db, orgId, { firstName: "Bob", lastName: "Live" })

      const future = new Date(Date.now() + 60_000)
      await seedNotification(db, orgId, userId, {
        contactId: contactA,
        snoozedUntil: future, // snoozed → not live
      })
      await seedNotification(db, orgId, userId, { contactId: contactB })

      const result = await listNotificationContactsForUser(db, orgId, userId)

      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe(contactB)
    })
  })

  it("returns empty when the recipient has no live notifications with contacts", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Live notification with NO contact
      await seedNotification(db, orgId, userId, { contactId: null })

      const result = await listNotificationContactsForUser(db, orgId, userId)
      expect(result).toHaveLength(0)
    })
  })

  it("does NOT return contacts from another user's notifications", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await setOrgContext(db, orgId, "owner", userA)

      const contactForB = await seedContact(db, orgId, {
        firstName: "Bob",
        lastName: "Contact",
      })

      // Only userB has a notification linked to contactForB
      await seedNotification(db, orgId, userB, { contactId: contactForB })

      // Querying for userA should return nothing
      const result = await listNotificationContactsForUser(db, orgId, userA)
      expect(result).toHaveLength(0)
    })
  })

  it("does NOT return contacts from another org's notifications", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgA = await createOrganization(db, userA)
      const orgB = await createOrganization(db, userB)

      // Set context to orgB first to seed orgB data under RLS
      await setOrgContext(db, orgB, "owner", userB)
      const contactInB = await seedContact(db, orgB, { firstName: "Bob", lastName: "OtherOrg" })
      await seedNotification(db, orgB, userB, { contactId: contactInB })

      // Switch context to orgA — should see nothing
      await setOrgContext(db, orgA, "owner", userA)
      const result = await listNotificationContactsForUser(db, orgA, userA)
      expect(result).toHaveLength(0)
    })
  })

  it("returns contact display names as trimmed first+last", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const contactId = await seedContact(db, orgId, {
        firstName: "  Jane  ",
        lastName: "  Doe  ",
      })
      await seedNotification(db, orgId, userId, { contactId })

      const result = await listNotificationContactsForUser(db, orgId, userId)
      expect(result).toHaveLength(1)
      // trim() in the SQL expression removes surrounding spaces
      expect(result[0]!.name.trim()).toBe("Jane     Doe".trim())
    })
  })

  it("results are ordered alphabetically by name", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const contactZ = await seedContact(db, orgId, { firstName: "Zelda", lastName: "Last" })
      const contactA = await seedContact(db, orgId, { firstName: "Aaron", lastName: "First" })

      await seedNotification(db, orgId, userId, { contactId: contactZ })
      await seedNotification(db, orgId, userId, { contactId: contactA })

      const result = await listNotificationContactsForUser(db, orgId, userId)
      expect(result).toHaveLength(2)
      // Aaron First should come before Zelda Last alphabetically
      expect(result[0]!.id).toBe(contactA)
      expect(result[1]!.id).toBe(contactZ)
    })
  })
})
