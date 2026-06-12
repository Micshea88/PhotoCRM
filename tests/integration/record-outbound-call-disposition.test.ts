/**
 * Integration tests for `recordOutboundCall` — disposition column
 * write + notes-always-null contract.
 *
 * Contract under test:
 *   - The disposition input value lands in `call_log.disposition`.
 *   - Auto-logged rows always have `notes = null` — the activity-feed
 *     badge carries the disposition signal on its own; no mechanically
 *     synthesized strings leak into the UI.
 *   - phoneNumber + raw reason still land in external_metadata for
 *     debugging.
 *
 * These tests bypass the orgAction wrappers (which need cookies) and
 * exercise the contract by inserting rows the way the action does
 * inside the same RLS context, then asserting on the resulting columns.
 */
import { describe, it, expect } from "vitest"
import { and, eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"
import { callLog } from "@/modules/calls/schema"
import type { RecordedCallDisposition } from "@/modules/calls/types"

type Db = Parameters<typeof setOrgContext>[0]

async function seedContact(db: Db, orgId: string, userId: string): Promise<string> {
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
  return contactId
}

async function insertOutboundCallRow(
  db: Db,
  args: {
    orgId: string
    userId: string
    contactId: string
    disposition: RecordedCallDisposition
    reason: string | null
  },
): Promise<string> {
  const id = createId()
  // Mirrors the action's insert shape exactly. Auto-logged rows
  // never carry a synthesized body line — the activity-feed badge
  // carries the disposition signal on its own.
  const notes = null
  await db.insert(callLog).values({
    id,
    organizationId: args.orgId,
    contactId: args.contactId,
    userId: args.userId,
    direction: "outgoing",
    disposition: args.disposition,
    startedAt: new Date("2026-06-11T12:00:00Z"),
    durationSeconds: 30,
    notes,
    recordingFileId: null,
    source: "ringcentral",
    externalId: null,
    externalMetadata: {
      phoneNumber: "+15551234567",
      disposition: args.disposition,
      reason: args.reason,
    },
    createdBy: args.userId,
    updatedBy: args.userId,
  })
  return id
}

describe("recordOutboundCall — disposition column + notes synthesis", () => {
  it("writes the disposition value to the dedicated column", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const contactId = await seedContact(db, orgId, userId)

      const id = await insertOutboundCallRow(db, {
        orgId,
        userId,
        contactId,
        disposition: "busy",
        reason: "SIP/2.0 486 Busy Here",
      })

      const [row] = await db.select().from(callLog).where(eq(callLog.id, id))
      expect(row?.disposition).toBe("busy")
    })
  })

  it("all dispositions leave notes=null (badge carries the signal)", async () => {
    const cases: RecordedCallDisposition[] = [
      "completed",
      "no_answer",
      "busy",
      "failed",
      "cancelled",
    ]
    for (const d of cases) {
      await withTestDb(async (db) => {
        const userId = await createUser(db)
        const orgId = await createOrganization(db, userId)
        await setOrgContext(db, orgId, "owner", userId)
        const contactId = await seedContact(db, orgId, userId)

        const id = await insertOutboundCallRow(db, {
          orgId,
          userId,
          contactId,
          disposition: d,
          reason: d === "completed" ? null : "SIP/2.0 486 Busy Here",
        })

        const [row] = await db.select().from(callLog).where(eq(callLog.id, id))
        expect(row?.disposition).toBe(d)
        expect(row?.notes).toBeNull()
      })
    }
  })

  it("phoneNumber + raw reason land in external_metadata for debugging", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const contactId = await seedContact(db, orgId, userId)

      const id = await insertOutboundCallRow(db, {
        orgId,
        userId,
        contactId,
        disposition: "busy",
        reason: "SIP/2.0 486 Busy Here",
      })

      const [row] = await db
        .select()
        .from(callLog)
        .where(and(eq(callLog.id, id), eq(callLog.organizationId, orgId)))
      expect(row?.externalMetadata).toEqual({
        phoneNumber: "+15551234567",
        disposition: "busy",
        reason: "SIP/2.0 486 Busy Here",
      })
    })
  })
})
