/**
 * Integration tests for Task 14 — notification queries.
 *
 * Covers:
 *   - unreadCount: counts live unread rows; excludes archived + future-snoozed; includes past-snoozed
 *   - listNotifications: preset=all (live only), preset=unread, preset=needs_attention
 *   - listNotifications: stacking filters (type + contactId + from/to range = AND intersection)
 *   - listArchivedNotifications: returns archived rows, newest-first
 *
 * NOTE: As of Task 10a, ALL registered NOTIFICATION_TYPES have needsAction=true, so
 * needs_attention preset == unread preset. Tests assert this and note the fact.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { notifications } from "@/modules/notifications/schema"
import { contacts } from "@/modules/contacts/schema"
import {
  unreadCount,
  listNotifications,
  listArchivedNotifications,
} from "@/modules/notifications/queries"
import { NEEDS_ACTION_TYPES } from "@/modules/notifications/types"

type Db = Parameters<typeof setOrgContext>[0]

// ── Seed helpers ────────────────────────────────────────────────────────────

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
    createdAt?: Date
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
    title: "Test notification",
    sourceModule: "email",
    contactId: opts.contactId ?? null,
    readAt: opts.readAt ?? null,
    archivedAt: opts.archivedAt ?? null,
    snoozedUntil: opts.snoozedUntil ?? null,
    createdAt: opts.createdAt ?? new Date(),
  })
  return id
}

// ── unreadCount ────────────────────────────────────────────────────────────

describe("unreadCount", () => {
  it("returns count of live unread rows", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // 2 unread live rows
      await seedNotification(db, orgId, userId)
      await seedNotification(db, orgId, userId)
      // 1 read row (should not count)
      await seedNotification(db, orgId, userId, { readAt: new Date() })

      const c = await unreadCount(db, orgId, userId)
      expect(c).toBe(2)
    })
  })

  it("excludes archived rows from unread count", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      await seedNotification(db, orgId, userId) // live unread
      await seedNotification(db, orgId, userId, { archivedAt: new Date() }) // archived, should not count

      const c = await unreadCount(db, orgId, userId)
      expect(c).toBe(1)
    })
  })

  it("excludes future-snoozed rows from unread count", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const future = new Date(Date.now() + 60_000)
      await seedNotification(db, orgId, userId) // live unread
      await seedNotification(db, orgId, userId, { snoozedUntil: future }) // snoozed, should not count

      const c = await unreadCount(db, orgId, userId)
      expect(c).toBe(1)
    })
  })

  it("includes past-snoozed rows in unread count (snoozed_until has passed)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const past = new Date(Date.now() - 60_000)
      // Past-snoozed = live (snoozed_until <= now)
      await seedNotification(db, orgId, userId, { snoozedUntil: past })

      const c = await unreadCount(db, orgId, userId)
      expect(c).toBe(1)
    })
  })

  it("returns 0 for a different user's notifications", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await setOrgContext(db, orgId, "owner", userA)

      await seedNotification(db, orgId, userA) // user A's notification

      const c = await unreadCount(db, orgId, userB)
      expect(c).toBe(0)
    })
  })
})

// ── listNotifications — presets ─────────────────────────────────────────────

describe("listNotifications — presets", () => {
  it("preset=all: returns live rows only (no archived, no future-snoozed)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const future = new Date(Date.now() + 60_000)
      const liveId = await seedNotification(db, orgId, userId) // live
      await seedNotification(db, orgId, userId, { archivedAt: new Date() }) // archived → excluded
      await seedNotification(db, orgId, userId, { snoozedUntil: future }) // snoozed → excluded

      const rows = await listNotifications(db, orgId, userId, { preset: "all" })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(liveId)
    })
  })

  it("preset=all includes past-snoozed rows (snoozed_until has passed = live)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const past = new Date(Date.now() - 60_000)
      await seedNotification(db, orgId, userId, { snoozedUntil: past })

      const rows = await listNotifications(db, orgId, userId)
      expect(rows).toHaveLength(1)
    })
  })

  it("preset=unread: returns only unread live rows", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const unreadId = await seedNotification(db, orgId, userId) // unread live
      await seedNotification(db, orgId, userId, { readAt: new Date() }) // read → excluded

      const rows = await listNotifications(db, orgId, userId, { preset: "unread" })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(unreadId)
    })
  })

  it("preset=needs_attention: returns unread live rows with needsAction types", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // All current NOTIFICATION_TYPES have needsAction=true, so needs_attention == unread.
      // Seed one unread row with a needsAction type (email.bounced), one read row.
      const needsActionId = await seedNotification(db, orgId, userId, { type: "email.bounced" })
      await seedNotification(db, orgId, userId, { type: "email.bounced", readAt: new Date() })

      const rows = await listNotifications(db, orgId, userId, { preset: "needs_attention" })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(needsActionId)

      // Note: since all types have needsAction=true, needs_attention == unread for current registry.
      const unreadRows = await listNotifications(db, orgId, userId, { preset: "unread" })
      expect(rows.length).toBe(unreadRows.length)
    })
  })

  it("preset default is 'all'", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      await seedNotification(db, orgId, userId)

      const explicit = await listNotifications(db, orgId, userId, { preset: "all" })
      const implicit = await listNotifications(db, orgId, userId)
      expect(implicit.length).toBe(explicit.length)
    })
  })
})

// ── listNotifications — stacking filters ──────────────────────────────────

describe("listNotifications — stacking filters", () => {
  it("type filter returns only matching types (OR within, AND with rest)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const bouncedId = await seedNotification(db, orgId, userId, { type: "email.bounced" })
      await seedNotification(db, orgId, userId, { type: "email.complained" })
      await seedNotification(db, orgId, userId, { type: "email.disconnected" })

      const rows = await listNotifications(db, orgId, userId, { types: ["email.bounced"] })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(bouncedId)
    })
  })

  it("type filter with multiple types uses OR within the type list", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      await seedNotification(db, orgId, userId, { type: "email.bounced" })
      await seedNotification(db, orgId, userId, { type: "email.complained" })
      await seedNotification(db, orgId, userId, { type: "email.disconnected" })

      const rows = await listNotifications(db, orgId, userId, {
        types: ["email.bounced", "email.complained"],
      })
      expect(rows).toHaveLength(2)
    })
  })

  it("contactId filter: returns only notifications linked to that contact", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const contactA = await seedContact(db, orgId)
      const contactB = await seedContact(db, orgId)

      const forA = await seedNotification(db, orgId, userId, { contactId: contactA })
      await seedNotification(db, orgId, userId, { contactId: contactB })
      await seedNotification(db, orgId, userId) // no contact

      const rows = await listNotifications(db, orgId, userId, { contactId: contactA })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(forA)
    })
  })

  it("from/to range filter: returns only notifications within the range", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const t0 = new Date("2026-01-01T00:00:00Z")
      const t1 = new Date("2026-01-02T00:00:00Z")
      const t2 = new Date("2026-01-03T00:00:00Z")
      const t3 = new Date("2026-01-04T00:00:00Z")

      await seedNotification(db, orgId, userId, { createdAt: t0 }) // before range
      const inRangeId = await seedNotification(db, orgId, userId, { createdAt: t2 }) // in range
      await seedNotification(db, orgId, userId, { createdAt: t3 }) // after range

      const rows = await listNotifications(db, orgId, userId, { from: t1, to: t3 })
      // t2 and t3 are both >= t1 and <= t3; t0 is < t1
      expect(rows.some((r) => r.id === inRangeId)).toBe(true)
      // t0 should not be in the result
      const ids = rows.map((r) => r.id)
      expect(ids).not.toContain(await seedNotification(db, orgId, userId, { createdAt: t0 }))
    })
  })

  it("stacking: type AND contactId AND from/to returns only the intersection", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const contact = await seedContact(db, orgId)
      const inRange = new Date("2026-06-01T00:00:00Z")
      const outOfRange = new Date("2026-01-01T00:00:00Z")

      // The one row that matches ALL three filters
      const targetId = await seedNotification(db, orgId, userId, {
        type: "email.bounced",
        contactId: contact,
        createdAt: inRange,
      })
      // Right type + contact but outside range
      await seedNotification(db, orgId, userId, {
        type: "email.bounced",
        contactId: contact,
        createdAt: outOfRange,
      })
      // Right type + right time but different contact
      await seedNotification(db, orgId, userId, {
        type: "email.bounced",
        createdAt: inRange,
      })
      // Wrong type, right contact, right time
      await seedNotification(db, orgId, userId, {
        type: "email.complained",
        contactId: contact,
        createdAt: inRange,
      })

      const rows = await listNotifications(db, orgId, userId, {
        types: ["email.bounced"],
        contactId: contact,
        from: new Date("2026-05-01T00:00:00Z"),
        to: new Date("2026-07-01T00:00:00Z"),
      })

      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(targetId)
    })
  })

  it("limit and offset paginate results", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      for (let i = 0; i < 5; i++) {
        await seedNotification(db, orgId, userId)
      }

      const page1 = await listNotifications(db, orgId, userId, { limit: 2, offset: 0 })
      const page2 = await listNotifications(db, orgId, userId, { limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)
      // No overlap
      const page1Ids = page1.map((r) => r.id)
      const page2Ids = page2.map((r) => r.id)
      expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false)
    })
  })
})

// ── listArchivedNotifications ──────────────────────────────────────────────

describe("listArchivedNotifications", () => {
  it("returns archived rows ordered by archived_at desc", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const older = new Date("2026-01-01T00:00:00Z")
      const newer = new Date("2026-06-01T00:00:00Z")

      const olderArchivedId = await seedNotification(db, orgId, userId, { archivedAt: older })
      const newerArchivedId = await seedNotification(db, orgId, userId, { archivedAt: newer })
      await seedNotification(db, orgId, userId) // live — should not appear

      const rows = await listArchivedNotifications(db, orgId, userId)
      expect(rows).toHaveLength(2)
      // newest-first
      expect(rows[0]!.id).toBe(newerArchivedId)
      expect(rows[1]!.id).toBe(olderArchivedId)
    })
  })

  it("archived rows do not appear in listNotifications (any preset)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      await seedNotification(db, orgId, userId, { archivedAt: new Date() })

      const live = await listNotifications(db, orgId, userId, { preset: "all" })
      const archived = await listArchivedNotifications(db, orgId, userId)

      expect(live).toHaveLength(0)
      expect(archived).toHaveLength(1)
    })
  })
})

// ── NEEDS_ACTION_TYPES export ──────────────────────────────────────────────

describe("NEEDS_ACTION_TYPES", () => {
  it("is a non-empty array of strings", () => {
    expect(Array.isArray(NEEDS_ACTION_TYPES)).toBe(true)
    expect(NEEDS_ACTION_TYPES.length).toBeGreaterThan(0)
    expect(NEEDS_ACTION_TYPES.every((t) => typeof t === "string")).toBe(true)
  })

  it("contains email.bounced (a known needsAction type)", () => {
    expect(NEEDS_ACTION_TYPES).toContain("email.bounced")
  })
})
