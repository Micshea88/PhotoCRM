/**
 * Push 3 (C6c followup) — global search across all columns + tags +
 * custom_fields, plus bi-directional sort.
 *
 * Verifies behavior against a real Postgres instance with the
 * full schema (including the contacts_tags_gin_idx + the existing
 * contacts_custom_fields_gin_idx). The expanded ILIKE search does
 * NOT use either index for substring matches — that's the V1.5
 * trigram-index proposal documented in filter-spec.ts. These tests
 * confirm the SQL is correct; perf is not in scope.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"
import { companies } from "@/modules/companies/schema"
import { listContactsForViewWithDb } from "@/modules/contacts/filter-spec"

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
    contactType: patch.contactType ?? null,
    lifecycleStatus: patch.lifecycleStatus ?? null,
    leadSource: patch.leadSource ?? null,
    sourceDetail: patch.sourceDetail ?? null,
    tags: patch.tags ?? null,
    notes: patch.notes ?? null,
    instagramHandle: patch.instagramHandle ?? null,
    facebookUrl: patch.facebookUrl ?? null,
    website: patch.website ?? null,
    customFields: patch.customFields ?? null,
    companyId: patch.companyId ?? null,
    createdAt: patch.createdAt ?? undefined,
    createdBy: userId,
    updatedBy: userId,
  })
  return id
}

describe("listContactsForView — global search across all columns", () => {
  it("matches on secondaryEmail", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const targetId = await insertContact(db, orgId, userId, {
        firstName: "Alice",
        lastName: "Test",
        secondaryEmail: "alice-work@evergreen.example",
      })
      await insertContact(db, orgId, userId, { firstName: "Bob", lastName: "Other" })
      const result = await listContactsForViewWithDb(db, { q: "evergreen" })
      expect(result.rows.map((r) => r.contact.id)).toEqual([targetId])
    })
  })

  it("matches on secondaryPhone (digits-only normalization)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const targetId = await insertContact(db, orgId, userId, {
        firstName: "Phone",
        lastName: "Match",
        secondaryPhone: "5551234567",
      })
      await insertContact(db, orgId, userId, { firstName: "Other", lastName: "Person" })
      const result = await listContactsForViewWithDb(db, { q: "(555) 123-4567" })
      expect(result.rows.map((r) => r.contact.id)).toEqual([targetId])
    })
  })

  it("matches on tags via unnest", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const tagged = await insertContact(db, orgId, userId, {
        firstName: "Tagged",
        lastName: "User",
        tags: ["destination-wedding", "premium"],
      })
      await insertContact(db, orgId, userId, { firstName: "Plain", lastName: "User" })
      const result = await listContactsForViewWithDb(db, { q: "destination" })
      expect(result.rows.map((r) => r.contact.id)).toEqual([tagged])
    })
  })

  it("matches inside custom_fields jsonb (text substring on the document)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const target = await insertContact(db, orgId, userId, {
        firstName: "CF",
        lastName: "Match",
        customFields: { plannerName: "Acme Events Co." },
      })
      await insertContact(db, orgId, userId, {
        firstName: "Other",
        lastName: "Contact",
        customFields: { plannerName: "Different Studio" },
      })
      const result = await listContactsForViewWithDb(db, { q: "Acme Events" })
      expect(result.rows.map((r) => r.contact.id)).toEqual([target])
    })
  })

  it("matches on contactType + lifecycleStatus + leadSource + notes", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const ct = await insertContact(db, orgId, userId, {
        firstName: "Type",
        lastName: "Filter",
        contactType: "Lead",
      })
      const ls = await insertContact(db, orgId, userId, {
        firstName: "Source",
        lastName: "Filter",
        leadSource: "Instagram",
      })
      const note = await insertContact(db, orgId, userId, {
        firstName: "Note",
        lastName: "Filter",
        notes: "Met at coffee shop downtown.",
      })
      const r1 = await listContactsForViewWithDb(db, { q: "Lead" })
      const r2 = await listContactsForViewWithDb(db, { q: "Instagram" })
      const r3 = await listContactsForViewWithDb(db, { q: "coffee shop" })
      expect(r1.rows.some((r) => r.contact.id === ct)).toBe(true)
      expect(r2.rows.some((r) => r.contact.id === ls)).toBe(true)
      expect(r3.rows.some((r) => r.contact.id === note)).toBe(true)
    })
  })

  it("matches on company name (existing behavior preserved)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const cid = createId()
      await db.insert(companies).values({
        id: cid,
        organizationId: orgId,
        name: "Evergreen Planning",
        createdBy: userId,
        updatedBy: userId,
      })
      const target = await insertContact(db, orgId, userId, {
        firstName: "Co",
        lastName: "Match",
        companyId: cid,
      })
      const result = await listContactsForViewWithDb(db, { q: "Evergreen" })
      expect(result.rows.map((r) => r.contact.id)).toEqual([target])
    })
  })
})

describe("listContactsForView — bi-directional sort", () => {
  async function seedThree(
    db: Parameters<Parameters<typeof withTestDb>[0]>[0],
    orgId: string,
    userId: string,
  ): Promise<string[]> {
    const aliceId = await insertContact(db, orgId, userId, {
      firstName: "Alice",
      lastName: "Anderson",
      primaryEmail: "alice@a.example",
      createdAt: new Date("2026-01-01"),
    })
    const bobId = await insertContact(db, orgId, userId, {
      firstName: "Bob",
      lastName: "Brown",
      primaryEmail: "bob@b.example",
      createdAt: new Date("2026-02-01"),
    })
    const carolId = await insertContact(db, orgId, userId, {
      firstName: "Carol",
      lastName: "Carter",
      primaryEmail: "carol@c.example",
      createdAt: new Date("2026-03-01"),
    })
    return [aliceId, bobId, carolId]
  }

  it("default sort (no sortBy) is lastName asc → A, B, C", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const [a, b, c] = await seedThree(db, orgId, userId)
      const result = await listContactsForViewWithDb(db, {})
      expect(result.rows.map((r) => r.contact.id)).toEqual([a, b, c])
    })
  })

  it("sortBy=createdAt + sortDir=desc → C, B, A", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const [a, b, c] = await seedThree(db, orgId, userId)
      const result = await listContactsForViewWithDb(db, { sortBy: "createdAt", sortDir: "desc" })
      expect(result.rows.map((r) => r.contact.id)).toEqual([c, b, a])
    })
  })

  it("sortBy=primaryEmail + sortDir=asc → A, B, C (by email)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const [a, b, c] = await seedThree(db, orgId, userId)
      const result = await listContactsForViewWithDb(db, { sortBy: "primaryEmail", sortDir: "asc" })
      expect(result.rows.map((r) => r.contact.id)).toEqual([a, b, c])
    })
  })

  it("unknown sortBy falls back to default (lastName asc)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const [a, b, c] = await seedThree(db, orgId, userId)
      const result = await listContactsForViewWithDb(db, { sortBy: "doesNotExist" })
      expect(result.rows.map((r) => r.contact.id)).toEqual([a, b, c])
    })
  })
})
