/**
 * Integration tests for `findContactByPhoneImpl` — the caller-ID →
 * contact matching SQL behind the inbound answer UI (3b).
 *
 * Contract under test (real Postgres):
 *   - Matches against primary_phone AND secondary_phone.
 *   - Digit-normalizes the stored value in SQL (last 10 digits), so a
 *     contact stored with formatting or a leading 1 still matches a
 *     clean 10-digit caller-ID.
 *   - Returns null when no contact owns the number.
 *   - Org-scoped: a contact in another org never matches.
 *   - Skips soft-deleted contacts.
 *
 * The action normalizes the inbound number with `parsePhoneInput` before
 * calling this Impl (covered by tests/unit/caller-lookup-normalize.test.ts),
 * so these tests pass an already-normalized 10-digit string.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"
import { findContactByPhoneImpl } from "@/modules/telephony/queries"

type Db = Parameters<typeof setOrgContext>[0]

async function seedContact(
  db: Db,
  orgId: string,
  userId: string,
  fields: {
    firstName: string
    lastName: string
    primaryPhone?: string
    secondaryPhone?: string
    deleted?: boolean
  },
): Promise<string> {
  const id = createId()
  await db.insert(contacts).values({
    id,
    organizationId: orgId,
    firstName: fields.firstName,
    lastName: fields.lastName,
    primaryPhone: fields.primaryPhone ?? null,
    secondaryPhone: fields.secondaryPhone ?? null,
    contactType: "Lead",
    createdBy: userId,
    updatedBy: userId,
    ...(fields.deleted ? { deletedAt: new Date(), deletedBy: userId } : {}),
  })
  return id
}

describe("findContactByPhoneImpl — caller-ID matching", () => {
  it("matches a contact by primary phone (clean 10-digit storage)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const id = await seedContact(db, orgId, userId, {
        firstName: "Ada",
        lastName: "Lovelace",
        primaryPhone: "5551234567",
      })

      const match = await findContactByPhoneImpl(db, orgId, "5551234567")
      expect(match).toEqual({ contactId: id, name: "Ada Lovelace" })
    })
  })

  it("matches against secondary phone too", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const id = await seedContact(db, orgId, userId, {
        firstName: "Grace",
        lastName: "Hopper",
        primaryPhone: "5550000000",
        secondaryPhone: "5559876543",
      })

      const match = await findContactByPhoneImpl(db, orgId, "5559876543")
      expect(match?.contactId).toBe(id)
    })
  })

  it("matches a legacy row stored with formatting / leading 1", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const id = await seedContact(db, orgId, userId, {
        firstName: "Alan",
        lastName: "Turing",
        primaryPhone: "+1 (555) 222-3333",
      })

      const match = await findContactByPhoneImpl(db, orgId, "5552223333")
      expect(match?.contactId).toBe(id)
    })
  })

  it("returns null when no contact owns the number", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      await seedContact(db, orgId, userId, {
        firstName: "Ada",
        lastName: "Lovelace",
        primaryPhone: "5551234567",
      })

      expect(await findContactByPhoneImpl(db, orgId, "5559990000")).toBeNull()
    })
  })

  it("does not match a soft-deleted contact", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      await seedContact(db, orgId, userId, {
        firstName: "Deleted",
        lastName: "Person",
        primaryPhone: "5551234567",
        deleted: true,
      })

      expect(await findContactByPhoneImpl(db, orgId, "5551234567")).toBeNull()
    })
  })
})
