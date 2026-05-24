/**
 * Push 2c.4 part 2 — bulkUpdateContactFields server-side coverage.
 *
 * Single-dispatch action: takes ids + a discriminated update payload,
 * applies the right SQL mutation, emits one audit row per affected
 * contact with bulk: true metadata. These integration tests exercise
 * the SQL path for each branch the wizard drawer can produce.
 *
 * Per repo convention (see dashboard-queries.test.ts header), tests
 * inline SQL rather than invoking the server action through the
 * next-safe-action wrapper — the wrapper opens its own connection
 * via the pool which would bypass the test's BEGIN/ROLLBACK
 * envelope. The action's SQL shape is what we're pinning here.
 */

import { describe, it, expect } from "vitest"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"

describe("contacts.bulk_update_fields — SQL shapes per discriminator", () => {
  it("text field (firstName): all selected rows updated to the same value", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const ids = [createId(), createId(), createId()]
      for (const id of ids) {
        await db.insert(contacts).values({
          id,
          organizationId: orgId,
          firstName: "Old",
          lastName: "Surname",
        })
      }

      await db
        .update(contacts)
        .set({ firstName: "New", updatedAt: new Date(), updatedBy: userId })
        .where(
          and(
            inArray(contacts.id, ids),
            eq(contacts.organizationId, orgId),
            isNull(contacts.deletedAt),
          ),
        )

      const rows = await db
        .select({ firstName: contacts.firstName })
        .from(contacts)
        .where(inArray(contacts.id, ids))
      expect(rows.every((r) => r.firstName === "New")).toBe(true)
    })
  })

  it("enum field (contactType): all rows pick up the new value", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const id1 = createId()
      const id2 = createId()
      await db.insert(contacts).values([
        { id: id1, organizationId: orgId, firstName: "A", lastName: "B", contactType: "Lead" },
        {
          id: id2,
          organizationId: orgId,
          firstName: "C",
          lastName: "D",
          contactType: "Active Client",
        },
      ])

      await db
        .update(contacts)
        .set({ contactType: "Vendor", updatedAt: new Date(), updatedBy: userId })
        .where(
          and(
            inArray(contacts.id, [id1, id2]),
            eq(contacts.organizationId, orgId),
            isNull(contacts.deletedAt),
          ),
        )

      const rows = await db
        .select({ contactType: contacts.contactType })
        .from(contacts)
        .where(inArray(contacts.id, [id1, id2]))
      expect(rows.every((r) => r.contactType === "Vendor")).toBe(true)
    })
  })

  it("mailing_address jsonb_set: street1 update preserves other sub-fields", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const id = createId()
      await db.insert(contacts).values({
        id,
        organizationId: orgId,
        firstName: "A",
        lastName: "B",
        mailingAddress: { street1: "Old St", city: "Boston", state: "MA", zip: "02110" },
      })

      // The action uses jsonb_set on the column. Same SQL shape here.
      await db
        .update(contacts)
        .set({
          mailingAddress: sql`jsonb_set(COALESCE(${contacts.mailingAddress}, '{}'::jsonb), ARRAY['street1'], to_jsonb('New Ave'::text), true)`,
          updatedAt: new Date(),
          updatedBy: userId,
        })
        .where(eq(contacts.id, id))

      const [row] = await db
        .select({ mailingAddress: contacts.mailingAddress })
        .from(contacts)
        .where(eq(contacts.id, id))
      expect(row?.mailingAddress).toEqual({
        street1: "New Ave",
        city: "Boston",
        state: "MA",
        zip: "02110",
      })
    })
  })

  it("tagsAdd: union of existing tags + new tags, no duplicates", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const id = createId()
      await db.insert(contacts).values({
        id,
        organizationId: orgId,
        firstName: "A",
        lastName: "B",
        tags: ["existing", "vip"],
      })

      const newTags = ["vip", "new-tag"]
      const tagLiterals = sql.join(
        newTags.map((t) => sql`${t}`),
        sql`, `,
      )
      await db
        .update(contacts)
        .set({
          tags: sql`(
            SELECT ARRAY(SELECT DISTINCT t FROM unnest(
              COALESCE(${contacts.tags}, '{}'::text[]) || ARRAY[${tagLiterals}]::text[]
            ) AS t)
          )`,
          updatedAt: new Date(),
          updatedBy: userId,
        })
        .where(eq(contacts.id, id))

      const [row] = await db
        .select({ tags: contacts.tags })
        .from(contacts)
        .where(eq(contacts.id, id))
      // Order isn't guaranteed by DISTINCT — sort for the assertion.
      expect([...(row?.tags ?? [])].sort()).toEqual(["existing", "new-tag", "vip"])
    })
  })

  it("tagsRemove: removes only the listed tags, leaves others intact", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const id = createId()
      await db.insert(contacts).values({
        id,
        organizationId: orgId,
        firstName: "A",
        lastName: "B",
        tags: ["one", "two", "three"],
      })

      const toRemove = ["two"]
      const tagLiterals = sql.join(
        toRemove.map((t) => sql`${t}`),
        sql`, `,
      )
      await db
        .update(contacts)
        .set({
          tags: sql`(
            SELECT ARRAY(SELECT t FROM unnest(COALESCE(${contacts.tags}, '{}'::text[])) AS t
            WHERE NOT (t = ANY(ARRAY[${tagLiterals}]::text[])))
          )`,
          updatedAt: new Date(),
          updatedBy: userId,
        })
        .where(eq(contacts.id, id))

      const [row] = await db
        .select({ tags: contacts.tags })
        .from(contacts)
        .where(eq(contacts.id, id))
      expect([...(row?.tags ?? [])].sort()).toEqual(["one", "three"])
    })
  })

  it("tagsReplace: replaces entire tag set with the provided array", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const id = createId()
      await db.insert(contacts).values({
        id,
        organizationId: orgId,
        firstName: "A",
        lastName: "B",
        tags: ["existing-a", "existing-b"],
      })

      const newSet = ["replaced"]
      await db
        .update(contacts)
        .set({ tags: newSet, updatedAt: new Date(), updatedBy: userId })
        .where(eq(contacts.id, id))

      const [row] = await db
        .select({ tags: contacts.tags })
        .from(contacts)
        .where(eq(contacts.id, id))
      expect(row?.tags).toEqual(["replaced"])
    })
  })

  it("only-non-deleted rows are touched (deleted_at IS NULL filter)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const liveId = createId()
      const deletedId = createId()
      await db.insert(contacts).values([
        { id: liveId, organizationId: orgId, firstName: "Live", lastName: "Row" },
        {
          id: deletedId,
          organizationId: orgId,
          firstName: "Dead",
          lastName: "Row",
          deletedAt: new Date(),
        },
      ])

      const updated = await db
        .update(contacts)
        .set({ firstName: "Touched", updatedAt: new Date(), updatedBy: userId })
        .where(
          and(
            inArray(contacts.id, [liveId, deletedId]),
            eq(contacts.organizationId, orgId),
            isNull(contacts.deletedAt),
          ),
        )
        .returning({ id: contacts.id })
      expect(updated.map((r) => r.id)).toEqual([liveId])
    })
  })
})
