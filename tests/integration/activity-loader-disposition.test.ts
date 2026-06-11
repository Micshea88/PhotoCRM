/**
 * Integration tests for `loadContactActivity` — disposition pass-through.
 *
 * Asserts the loader queries `call_log.disposition` and surfaces it on
 * the activity entry as `callDisposition`. Pre-2026-06-11 rows that
 * predate the column (or were logged manually without selecting an
 * outcome) have NULL → entry.callDisposition is null → activity feed
 * renders no badge.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"
import { callLog } from "@/modules/calls/schema"
import { loadContactActivityWithDb } from "@/modules/contacts/activity-loader"

type Db = Parameters<typeof loadContactActivityWithDb>[0]

async function seedContactAndCall(
  db: Db,
  orgId: string,
  userId: string,
  disposition: string | null,
): Promise<{ contactId: string }> {
  const contactId = createId()
  await db.insert(contacts).values({
    id: contactId,
    organizationId: orgId,
    firstName: "Test",
    lastName: "Contact",
    contactType: "Lead",
    createdBy: userId,
    updatedBy: userId,
  })
  await db.insert(callLog).values({
    id: createId(),
    organizationId: orgId,
    contactId,
    userId,
    direction: "outgoing",
    disposition,
    startedAt: new Date("2026-06-11T12:00:00Z"),
    durationSeconds: 30,
    source: "ringcentral",
    createdBy: userId,
    updatedBy: userId,
  })
  return { contactId }
}

describe("loadContactActivity — call entry disposition pass-through", () => {
  it("surfaces the disposition value as entry.callDisposition", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const { contactId } = await seedContactAndCall(db, orgId, userId, "no_answer")

      const entries = await loadContactActivityWithDb(db, orgId, contactId)
      const call = entries.find((e) => e.kind === "call")
      expect(call?.callDisposition).toBe("no_answer")
    })
  })

  it("each canonical disposition value passes through unchanged", async () => {
    const canonical = [
      "completed",
      "no_answer",
      "busy",
      "failed",
      "cancelled",
      "transferred",
      "voicemail",
      "wrong_number",
    ]
    for (const d of canonical) {
      await withTestDb(async (db) => {
        const userId = await createUser(db)
        const orgId = await createOrganization(db, userId)
        await setOrgContext(db, orgId, "owner", userId)
        const { contactId } = await seedContactAndCall(db, orgId, userId, d)

        const entries = await loadContactActivityWithDb(db, orgId, contactId)
        const call = entries.find((e) => e.kind === "call")
        expect(call?.callDisposition).toBe(d)
      })
    }
  })

  it("null disposition (pre-2026-06-11 row) surfaces as null", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const { contactId } = await seedContactAndCall(db, orgId, userId, null)

      const entries = await loadContactActivityWithDb(db, orgId, contactId)
      const call = entries.find((e) => e.kind === "call")
      expect(call?.callDisposition).toBeNull()
    })
  })
})
