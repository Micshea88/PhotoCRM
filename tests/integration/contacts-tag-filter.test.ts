/**
 * Push 4 followup — tag-filter integration test.
 *
 * Repro for the production 500 (digest 1359390504): selecting Tags =
 * "Photographer" on /contacts throws. Every other filter
 * (contactType / lifecycleStatus / ownerUserId / companyId /
 * leadSource / created date) works. The throw is specific to the
 * tag-filter SQL path.
 *
 * What this asserts (the regression that was missing):
 *   1. listContactsForView with `filters.tags = ["Photographer"]`
 *      MUST NOT throw against the live schema (contacts.tags text[]
 *      array of tag NAME strings — no separate tag table).
 *   2. Tag filter actually filters: contacts with the tag appear,
 *      contacts without it don't.
 *   3. A no-match tag returns [] cleanly (no error).
 *   4. Tag filter composes with another filter (e.g. tag +
 *      contactType).
 *
 * The UI on app/(app)/contacts/page.tsx sends `filters.tags` as a
 * `string[]` of tag NAMES (parsed from the URL searchParam:
 * `?tags=Photographer,Vendor` → `["Photographer","Vendor"]`).
 * This test pins that exact wire shape.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"
import { listContactsForViewWithDb } from "@/modules/contacts/filter-spec"

describe("contacts tag filter — wire-shape regression", () => {
  it("filtering by tags=['Photographer'] does not throw + returns matching contacts", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const photographerId = createId()
      const vendorId = createId()
      await db.insert(contacts).values([
        {
          id: photographerId,
          organizationId: orgId,
          firstName: "Ada",
          lastName: "Lovelace",
          tags: ["Photographer", "Wedding"],
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: vendorId,
          organizationId: orgId,
          firstName: "Grace",
          lastName: "Hopper",
          tags: ["Vendor"],
          createdBy: userId,
          updatedBy: userId,
        },
      ])

      // The UI parses `?tags=Photographer` to ["Photographer"] —
      // a JS string[] of tag NAMES.
      const result = await listContactsForViewWithDb(db, { tags: ["Photographer"] })
      const ids = result.rows.map((r) => r.contact.id)
      expect(ids).toContain(photographerId)
      expect(ids).not.toContain(vendorId)
    })
  })

  it("multi-tag filter (tags=['Photographer','Vendor']) returns the OVERLAP set", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const photographerId = createId()
      const vendorId = createId()
      const otherId = createId()
      await db.insert(contacts).values([
        {
          id: photographerId,
          organizationId: orgId,
          firstName: "Ada",
          lastName: "Lovelace",
          tags: ["Photographer"],
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: vendorId,
          organizationId: orgId,
          firstName: "Grace",
          lastName: "Hopper",
          tags: ["Vendor"],
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: otherId,
          organizationId: orgId,
          firstName: "Linus",
          lastName: "Torvalds",
          tags: ["Other"],
          createdBy: userId,
          updatedBy: userId,
        },
      ])

      const result = await listContactsForViewWithDb(db, {
        tags: ["Photographer", "Vendor"],
      })
      const ids = result.rows.map((r) => r.contact.id)
      expect(ids).toEqual(expect.arrayContaining([photographerId, vendorId]))
      expect(ids).not.toContain(otherId)
    })
  })

  it("no-match tag returns [] cleanly (no throw)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      await db.insert(contacts).values({
        id: createId(),
        organizationId: orgId,
        firstName: "Ada",
        lastName: "Lovelace",
        tags: ["Photographer"],
        createdBy: userId,
        updatedBy: userId,
      })

      const result = await listContactsForViewWithDb(db, { tags: ["NoSuchTag"] })
      expect(result.rows).toEqual([])
    })
  })

  it("tag filter composes with another filter (tags + contactType)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const photoVendorId = createId()
      const photoLeadId = createId()
      await db.insert(contacts).values([
        {
          id: photoVendorId,
          organizationId: orgId,
          firstName: "V",
          lastName: "One",
          tags: ["Photographer"],
          contactType: "Vendor",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: photoLeadId,
          organizationId: orgId,
          firstName: "L",
          lastName: "One",
          tags: ["Photographer"],
          contactType: "Lead",
          createdBy: userId,
          updatedBy: userId,
        },
      ])

      const result = await listContactsForViewWithDb(db, {
        tags: ["Photographer"],
        contactType: "Vendor",
      })
      const ids = result.rows.map((r) => r.contact.id)
      expect(ids).toContain(photoVendorId)
      expect(ids).not.toContain(photoLeadId)
    })
  })
})
