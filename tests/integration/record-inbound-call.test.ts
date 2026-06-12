/**
 * Integration tests for the inbound auto-log contract (3b) +
 * `loadContactActivity` rendering of incoming calls.
 *
 * Contract under test:
 *   - An answered inbound row is written with direction="incoming",
 *     source="ringcentral", notes=null, and the classifier's
 *     disposition in the dedicated column.
 *   - A declined/missed inbound row (Option A — only when the caller
 *     matched a known contact) is direction="incoming",
 *     disposition="no_answer", durationSeconds=0.
 *   - The activity loader renders an incoming call as
 *     "Call (incoming) · M:SS" and surfaces the disposition for the badge.
 *
 * These tests mirror the action's insert shape inside the same RLS
 * context (the action wrappers need cookies), the same approach as
 * tests/integration/record-outbound-call-disposition.test.ts.
 */
import { describe, it, expect } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"
import { callLog } from "@/modules/calls/schema"
import { loadContactActivityWithDb } from "@/modules/contacts/activity-loader"
import type { RecordedCallDisposition } from "@/modules/calls/types"

type Db = Parameters<typeof setOrgContext>[0]

async function seedContact(db: Db, orgId: string, userId: string): Promise<string> {
  const contactId = createId()
  await db.insert(contacts).values({
    id: contactId,
    organizationId: orgId,
    firstName: "Test",
    lastName: "Caller",
    contactType: "Lead",
    createdBy: userId,
    updatedBy: userId,
  })
  return contactId
}

// Mirrors recordInboundCall's insert shape exactly.
async function insertInboundCallRow(
  db: Db,
  args: {
    orgId: string
    userId: string
    contactId: string | null
    disposition: RecordedCallDisposition
    durationSeconds: number
  },
): Promise<string> {
  const id = createId()
  await db.insert(callLog).values({
    id,
    organizationId: args.orgId,
    contactId: args.contactId,
    userId: args.userId,
    direction: "incoming",
    disposition: args.disposition,
    startedAt: new Date("2026-06-12T12:00:00Z"),
    durationSeconds: args.durationSeconds,
    notes: null,
    recordingFileId: null,
    source: "ringcentral",
    externalId: null,
    externalMetadata: {
      phoneNumber: "+15551234567",
      disposition: args.disposition,
      reason: null,
    },
    createdBy: args.userId,
    updatedBy: args.userId,
  })
  return id
}

describe("recordInboundCall — incoming row contract", () => {
  it("answered inbound writes direction=incoming + classifier disposition, notes null", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const contactId = await seedContact(db, orgId, userId)

      const id = await insertInboundCallRow(db, {
        orgId,
        userId,
        contactId,
        disposition: "completed",
        durationSeconds: 125,
      })

      const [row] = await db.select().from(callLog).where(eq(callLog.id, id))
      expect(row?.direction).toBe("incoming")
      expect(row?.disposition).toBe("completed")
      expect(row?.source).toBe("ringcentral")
      expect(row?.notes).toBeNull()
    })
  })

  it("declined/missed inbound (matched contact) writes no_answer with duration 0", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const contactId = await seedContact(db, orgId, userId)

      const id = await insertInboundCallRow(db, {
        orgId,
        userId,
        contactId,
        disposition: "no_answer",
        durationSeconds: 0,
      })

      const [row] = await db.select().from(callLog).where(eq(callLog.id, id))
      expect(row?.direction).toBe("incoming")
      expect(row?.disposition).toBe("no_answer")
      expect(row?.durationSeconds).toBe(0)
    })
  })

  it("activity loader renders an incoming call as 'Call (incoming) · M:SS' + disposition", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const contactId = await seedContact(db, orgId, userId)

      await insertInboundCallRow(db, {
        orgId,
        userId,
        contactId,
        disposition: "completed",
        durationSeconds: 125,
      })

      const entries = await loadContactActivityWithDb(db, orgId, contactId)
      const call = entries.find((e) => e.kind === "call")
      expect(call?.title).toBe("Call (incoming) · 2:05")
      expect(call?.callDisposition).toBe("completed")
    })
  })
})
