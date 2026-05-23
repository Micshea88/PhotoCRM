/**
 * Push 2c.1.1 — regression test for the previewContactsImport SQL bug.
 *
 * Production trace (Vercel logs, dpl_rENfuX4uiHCDL4qowj6kc8JCT15d):
 *   Error: Failed query: ...
 *   ... ANY(($2, $3, $4, $5, $6)::text[]) ...
 *   PG: cannot cast type record to text[]
 *
 * Root cause: Drizzle's `sql` template expands JS arrays into a record
 * literal `($2, $3, ...)`, and PG can't cast records to text[]. Latent
 * since Push 2c — single-row imports passed because the array was
 * length-1 and `(x,)::text[]` happens to parse. Multi-row imports
 * trigger the failure. Fixed in Push 2c.1.1 by switching to `inArray()`.
 *
 * This test calls the underlying SQL through Drizzle with the same
 * shape the action uses, against multiple emails AND phones — i.e. the
 * exact path that broke in production.
 */

import { describe, it, expect } from "vitest"
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"

describe("contacts import — preview SQL shape (Push 2c.1.1 regression)", () => {
  it("multi-row email+phone match query executes without PG error", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Seed the org with a couple of contacts so the email match path
      // hits a real row.
      await db.insert(contacts).values([
        {
          id: createId(),
          organizationId: orgId,
          firstName: "Existing",
          lastName: "Person",
          primaryEmail: "existing@example.com",
          primaryPhone: "5559876543",
        },
        {
          id: createId(),
          organizationId: orgId,
          firstName: "Phone",
          lastName: "Only",
          primaryPhone: "5551234567",
        },
      ])

      // Build the exact predicate shape previewContactsImport uses.
      // Two emails + two phones — the multi-element case that broke
      // production. Imitates the same dedupe-by-email-or-phone query.
      const emailList = ["existing@example.com", "ghost@example.com"]
      const phoneList = ["5551234567", "9990000000"]

      const orParts: SQL[] = [
        inArray(sql`LOWER(${contacts.primaryEmail})`, emailList),
        inArray(
          sql`REGEXP_REPLACE(COALESCE(${contacts.primaryPhone}, ''), '\\D', '', 'g')`,
          phoneList,
        ),
      ]
      const matches = await db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          primaryEmail: contacts.primaryEmail,
          primaryPhone: contacts.primaryPhone,
        })
        .from(contacts)
        .where(
          and(
            eq(contacts.organizationId, orgId),
            isNull(contacts.deletedAt),
            isNull(contacts.archivedAt),
            or(...orParts),
          ),
        )

      // Both seeded contacts match — one by email, one by phone.
      const names = matches.map((m) => `${m.firstName} ${m.lastName}`).sort()
      expect(names).toEqual(["Existing Person", "Phone Only"])
    })
  })

  it("phone normalization regex strips formatting and matches digits-only stored values", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      await db.insert(contacts).values({
        id: createId(),
        organizationId: orgId,
        firstName: "Format",
        lastName: "Test",
        primaryPhone: "(555) 123-4567",
      })

      const rows = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.organizationId, orgId),
            inArray(sql`REGEXP_REPLACE(COALESCE(${contacts.primaryPhone}, ''), '\\D', '', 'g')`, [
              "5551234567",
            ]),
          ),
        )
      expect(rows.length).toBe(1)
    })
  })

  it("no-match query (empty input) is well-formed and returns zero rows", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // When emailList and phoneList are both empty, the action falls
      // back to `sql\`false\`` — this asserts that the predicate
      // composition stays well-formed even on empty input.
      const rows = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.organizationId, orgId),
            isNull(contacts.deletedAt),
            isNull(contacts.archivedAt),
            sql`false`,
          ),
        )
      expect(rows.length).toBe(0)
    })
  })
})
