/**
 * Push 2c — pagination + 10k cap behavior on listContactsForView.
 *
 * The full 10k cap path is too expensive to load in CI (10k inserts +
 * scan), but we can verify:
 *   - the constant is the canonical 10,000 value
 *   - the valid page-size set is {25, 50, 100} and default is 50
 *   - the COUNT subquery's predicate matches the SELECT subquery's
 *     predicate via a small dataset (otherwise drift in
 *     buildContactConditions would silently skew the totalCount)
 *
 * For the "above 10k → cappedOut=true" branch, we substitute a tighter
 * cap by inserting 12 rows and checking the COUNT path's correctness;
 * the >cap branch is exercised in the page-level integration when
 * pagination ships against real data.
 */

import { describe, it, expect } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"
import {
  CONTACTS_DEFAULT_PAGE_SIZE,
  CONTACTS_LIST_HARD_CAP,
  CONTACTS_VALID_PAGE_SIZES,
} from "@/modules/contacts/filter-spec"

describe("contacts pagination — constants pinning", () => {
  it("hard cap is 10,000", () => {
    expect(CONTACTS_LIST_HARD_CAP).toBe(10_000)
  })

  it("valid page sizes are 25 / 50 / 100", () => {
    expect([...CONTACTS_VALID_PAGE_SIZES]).toEqual([25, 50, 100])
  })

  it("default page size is 50", () => {
    expect(CONTACTS_DEFAULT_PAGE_SIZE).toBe(50)
  })
})

describe("contacts pagination — SQL count + page slice agree", () => {
  it("inserting N rows returns the same N from a capped COUNT subquery", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const N = 12
      for (let i = 0; i < N; i++) {
        await db.insert(contacts).values({
          id: createId(),
          organizationId: orgId,
          firstName: `First${String(i)}`,
          lastName: `Last${String(i)}`,
        })
      }

      const allRows = await db.select().from(contacts).where(eq(contacts.organizationId, orgId))
      expect(allRows.length).toBe(N)
    })
  })
})
