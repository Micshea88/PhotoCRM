import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"
import { companies } from "@/modules/companies/schema"
import {
  loadCompanyDuplicateCandidates,
  loadContactDuplicateCandidates,
} from "@/modules/duplicates/queries"
import {
  findDuplicateCompanyGroups,
  findDuplicateContactGroups,
} from "@/modules/duplicates/matching"

/**
 * Push 4 (B1) — integration tests for the duplicates detection
 * engine against the live schema. Verifies:
 *
 *   - The query loaders return the right candidate shape (with the
 *     joined company name for contacts).
 *   - Soft-deleted records are excluded from the candidate set.
 *   - Cross-org isolation: a duplicate-pair in org A doesn't surface
 *     when scanning org B (via setOrgContext + the WHERE
 *     organizationId clause; RLS would also block at the policy
 *     layer but we filter explicitly too).
 */

describe("duplicates engine — query loaders", () => {
  it("contacts: candidate loader returns rows with joined primary company name", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const companyId = createId()
      await db.insert(companies).values({
        id: companyId,
        organizationId: orgId,
        name: "Evergreen Planning",
        createdBy: userId,
        updatedBy: userId,
      })
      const aId = createId()
      const bId = createId()
      await db.insert(contacts).values([
        {
          id: aId,
          organizationId: orgId,
          firstName: "Ada",
          lastName: "Lovelace",
          companyId,
          primaryEmail: "shared@example.com",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: bId,
          organizationId: orgId,
          firstName: "Ada",
          lastName: "Lovelace",
          companyId,
          primaryEmail: "SHARED@example.com",
          createdBy: userId,
          updatedBy: userId,
        },
      ])

      const candidates = await loadContactDuplicateCandidates(db, orgId)
      expect(candidates.length).toBe(2)
      const groups = findDuplicateContactGroups(candidates)
      expect(groups.length).toBe(1)
      expect(new Set(groups[0]?.ids)).toEqual(new Set([aId, bId]))
      expect(new Set(groups[0]?.reasons)).toEqual(new Set(["email", "name_and_company"]))
    })
  })

  it("contacts: soft-deleted rows are excluded from the candidate set", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      await db.insert(contacts).values([
        {
          id: createId(),
          organizationId: orgId,
          firstName: "Ada",
          lastName: "Live",
          primaryEmail: "shared@example.com",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: createId(),
          organizationId: orgId,
          firstName: "Ada",
          lastName: "Deleted",
          primaryEmail: "shared@example.com",
          deletedAt: new Date(),
          deletedBy: userId,
          createdBy: userId,
          updatedBy: userId,
        },
      ])

      const candidates = await loadContactDuplicateCandidates(db, orgId)
      expect(candidates.length).toBe(1)
      expect(findDuplicateContactGroups(candidates).length).toBe(0)
    })
  })

  it("contacts: scan only includes the active org's records (cross-org isolation)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgA = await createOrganization(db, userId)
      const orgB = await createOrganization(db, userId)
      // Org A: a real duplicate pair.
      await setOrgContext(db, orgA, "owner", userId)
      await db.insert(contacts).values([
        {
          id: createId(),
          organizationId: orgA,
          firstName: "Org A",
          lastName: "Person",
          primaryEmail: "shared@example.com",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: createId(),
          organizationId: orgA,
          firstName: "Org A2",
          lastName: "Person",
          primaryEmail: "shared@example.com",
          createdBy: userId,
          updatedBy: userId,
        },
      ])
      // Org B: a singleton that shares the email — but Org B's scan
      // shouldn't see Org A's rows.
      await setOrgContext(db, orgB, "owner", userId)
      await db.insert(contacts).values({
        id: createId(),
        organizationId: orgB,
        firstName: "Org B",
        lastName: "Loner",
        primaryEmail: "shared@example.com",
        createdBy: userId,
        updatedBy: userId,
      })

      // Each scan runs as the corresponding org's context — RLS would
      // hide cross-org rows even if the WHERE clause was missing.
      await setOrgContext(db, orgA, "owner", userId)
      const candidatesA = await loadContactDuplicateCandidates(db, orgA)
      const groupsA = findDuplicateContactGroups(candidatesA)
      expect(groupsA.length).toBe(1)
      expect(candidatesA.length).toBe(2)

      await setOrgContext(db, orgB, "owner", userId)
      const candidatesB = await loadContactDuplicateCandidates(db, orgB)
      const groupsB = findDuplicateContactGroups(candidatesB)
      expect(candidatesB.length).toBe(1)
      expect(groupsB.length).toBe(0)
    })
  })

  it("companies: domain duplicates surface (name+phone+industry rules covered by unit tests; the schema's partial-unique on (org, name) blocks DB-level same-name seeding)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const aId = createId()
      const bId = createId()
      await db.insert(companies).values([
        {
          id: aId,
          organizationId: orgId,
          name: "Evergreen Planning",
          website: "https://evergreen.example",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: bId,
          organizationId: orgId,
          name: "Evergreen Events",
          website: "https://www.evergreen.example/about",
          createdBy: userId,
          updatedBy: userId,
        },
      ])

      const candidates = await loadCompanyDuplicateCandidates(db, orgId)
      const groups = findDuplicateCompanyGroups(candidates)
      expect(groups.length).toBe(1)
      expect(new Set(groups[0]?.ids)).toEqual(new Set([aId, bId]))
      expect(new Set(groups[0]?.reasons)).toEqual(new Set(["domain"]))
    })
  })

  it("companies: soft-deleted rows excluded", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      await db.insert(companies).values([
        {
          id: createId(),
          organizationId: orgId,
          name: "Live Co",
          website: "https://example.com",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: createId(),
          organizationId: orgId,
          name: "Dead Co",
          website: "https://example.com",
          deletedAt: new Date(),
          deletedBy: userId,
          createdBy: userId,
          updatedBy: userId,
        },
      ])
      const candidates = await loadCompanyDuplicateCandidates(db, orgId)
      expect(candidates.length).toBe(1)
      expect(findDuplicateCompanyGroups(candidates).length).toBe(0)
    })
  })
})
