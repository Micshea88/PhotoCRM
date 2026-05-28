/**
 * Push 3 (C4) — pre-write dedup hard block integration tests.
 *
 * Covers:
 *   - findDedupConflict detects matches on primary/secondary email + phone
 *   - phone normalization (digits-only) collapses "(555) 123-4567" vs "5551234567"
 *   - Cross-field matches: new primary_email matches another contact's secondary_email
 *   - excludeContactId: updateContact's self-skip works
 *   - Soft-deleted rows don't block new creates (partial index WHERE deleted_at IS NULL)
 *   - Companies CAN duplicate main_phone (no constraint — carve-out)
 *   - Partial unique indexes exist as expected (migration 0034)
 */
import { describe, it, expect } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"
import { companies } from "@/modules/companies/schema"
import { findDedupConflict } from "@/modules/contacts/dedup-preflight"

async function insertContact(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  orgId: string,
  userId: string,
  patch: Partial<typeof contacts.$inferInsert>,
) {
  const id = patch.id ?? createId()
  await db.insert(contacts).values({
    id,
    organizationId: orgId,
    firstName: patch.firstName ?? "Test",
    lastName: patch.lastName ?? "Contact",
    primaryEmail: patch.primaryEmail ?? null,
    secondaryEmail: patch.secondaryEmail ?? null,
    primaryPhone: patch.primaryPhone ?? null,
    secondaryPhone: patch.secondaryPhone ?? null,
    deletedAt: patch.deletedAt ?? null,
    createdBy: userId,
    updatedBy: userId,
  })
  return id
}

describe("findDedupConflict — primary email", () => {
  it("matches when new primary_email equals existing primary_email (case-insensitive)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const existingId = await insertContact(db, orgId, userId, {
        primaryEmail: "Alice@Example.com",
      })

      const conflict = await findDedupConflict(db, orgId, {
        primaryEmail: "ALICE@example.com",
      })
      expect(conflict).not.toBeNull()
      expect(conflict?.matchedContactId).toBe(existingId)
      expect(conflict?.matchedField).toBe("primaryEmail")
    })
  })

  it("matches when new primary_email equals existing secondary_email (cross-field)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const existingId = await insertContact(db, orgId, userId, {
        primaryEmail: "primary@example.com",
        secondaryEmail: "work@example.com",
      })

      const conflict = await findDedupConflict(db, orgId, {
        primaryEmail: "work@example.com",
      })
      expect(conflict).not.toBeNull()
      expect(conflict?.matchedContactId).toBe(existingId)
      expect(conflict?.matchedField).toBe("primaryEmail")
    })
  })

  it("no conflict when emails differ", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      await insertContact(db, orgId, userId, { primaryEmail: "alice@example.com" })

      const conflict = await findDedupConflict(db, orgId, {
        primaryEmail: "bob@example.com",
      })
      expect(conflict).toBeNull()
    })
  })
})

describe("findDedupConflict — phone normalization", () => {
  it("matches phones across different formats (digits-only)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const existingId = await insertContact(db, orgId, userId, {
        primaryPhone: "5551234567",
      })

      const conflict = await findDedupConflict(db, orgId, {
        primaryPhone: "(555) 123-4567",
      })
      expect(conflict).not.toBeNull()
      expect(conflict?.matchedContactId).toBe(existingId)
      expect(conflict?.matchedField).toBe("primaryPhone")
    })
  })

  it("matches when new primary_phone equals existing secondary_phone", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const existingId = await insertContact(db, orgId, userId, {
        primaryPhone: "5550001111",
        secondaryPhone: "5552223333",
      })

      // No +1 prefix: normalizePhone keeps every digit. With +1 the
      // canonical form would be 11 chars; without it, 10. Both
      // formats are reasonable; in V1 the form stores whatever the
      // user typed and the index normalizes consistently.
      const conflict = await findDedupConflict(db, orgId, {
        primaryPhone: "(555) 222-3333",
      })
      expect(conflict).not.toBeNull()
      expect(conflict?.matchedContactId).toBe(existingId)
      expect(conflict?.matchedField).toBe("primaryPhone")
    })
  })
})

describe("findDedupConflict — excludeContactId (self-skip for updates)", () => {
  it("skips self when excludeContactId is passed", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const id = await insertContact(db, orgId, userId, {
        primaryEmail: "me@example.com",
      })

      const conflict = await findDedupConflict(db, orgId, {
        primaryEmail: "me@example.com",
        excludeContactId: id,
      })
      expect(conflict).toBeNull()
    })
  })

  it("still matches when ANOTHER contact owns the email even with excludeContactId set", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const aliceId = await insertContact(db, orgId, userId, {
        primaryEmail: "alice@example.com",
      })
      const bobId = await insertContact(db, orgId, userId, {
        primaryEmail: "bob@example.com",
      })

      // Updating Bob to use Alice's email → conflict on Alice, not self-skip.
      const conflict = await findDedupConflict(db, orgId, {
        primaryEmail: "alice@example.com",
        excludeContactId: bobId,
      })
      expect(conflict).not.toBeNull()
      expect(conflict?.matchedContactId).toBe(aliceId)
    })
  })
})

describe("findDedupConflict — soft-deleted rows ignored", () => {
  it("soft-deleted contact's email does NOT block a new create", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      await insertContact(db, orgId, userId, {
        primaryEmail: "recycled@example.com",
        deletedAt: new Date(),
      })

      const conflict = await findDedupConflict(db, orgId, {
        primaryEmail: "recycled@example.com",
      })
      expect(conflict).toBeNull()
    })
  })
})

describe("findDedupConflict — no input", () => {
  it("returns null when all inputs are null/empty", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const conflict = await findDedupConflict(db, orgId, {
        primaryEmail: null,
        secondaryEmail: "   ",
        primaryPhone: null,
        secondaryPhone: "",
      })
      expect(conflict).toBeNull()
    })
  })
})

describe("companies — main_phone carve-out", () => {
  it("two companies CAN coexist with the same main_phone (no DB constraint)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Insert two companies with the same main_phone — must succeed.
      await db.insert(companies).values([
        {
          id: createId(),
          organizationId: orgId,
          name: "Studio A",
          mainPhone: "5551234567",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: createId(),
          organizationId: orgId,
          name: "Studio B",
          mainPhone: "5551234567",
          createdBy: userId,
          updatedBy: userId,
        },
      ])
      const rows = await db
        .select()
        .from(companies)
        .where(and(eq(companies.organizationId, orgId), eq(companies.mainPhone, "5551234567")))
      expect(rows.length).toBe(2)
    })
  })
})

describe("partial unique indexes (migration 0034)", () => {
  it("both partial unique indexes exist on contacts", async () => {
    await withTestDb(async (db) => {
      const result = await db.execute<{ indexname: string }>(sql`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'contacts'
          AND indexname IN ('contacts_org_lower_email_uidx', 'contacts_org_normalized_phone_uidx')
        ORDER BY indexname
      `)
      const names = result.rows.map((r) => r.indexname).sort()
      expect(names).toEqual(["contacts_org_lower_email_uidx", "contacts_org_normalized_phone_uidx"])
    })
  })
})
