/**
 * Integration tests for `loadContactActivity` — call-entry duration
 * format.
 *
 * Regression guard for the duration-format bug Mike hit 2026-06-10:
 * the loader used to round duration to integer minutes via
 * `Math.round(seconds / 60)`, so a 42-second dialer call rendered as
 * `"Call (outgoing) · 1m"` (or `"0m"` for shorter calls). The fix
 * switches to `M:SS` to match the in-call dialer timer.
 *
 * Contract under test:
 *   - 0 < seconds < 60      → title ends in ` · 0:SS` (padded)
 *   - seconds >= 60         → title ends in ` · M:SS` (padded)
 *   - seconds === 0 / null  → no duration suffix
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
  durationSeconds: number | null,
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
    startedAt: new Date("2026-06-10T12:00:00Z"),
    durationSeconds,
    source: "ringcentral",
    createdBy: userId,
    updatedBy: userId,
  })
  return { contactId }
}

describe("loadContactActivity — call entry duration format", () => {
  it("formats a 42-second call as ' · 0:42' (sub-minute M:SS)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const { contactId } = await seedContactAndCall(db, orgId, userId, 42)

      const entries = await loadContactActivityWithDb(db, orgId, contactId)
      const call = entries.find((e) => e.kind === "call")
      expect(call?.title).toBe("Call (outgoing) · 0:42")
    })
  })

  it("formats a 73-second call as ' · 1:13' (minute-plus M:SS)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const { contactId } = await seedContactAndCall(db, orgId, userId, 73)

      const entries = await loadContactActivityWithDb(db, orgId, contactId)
      const call = entries.find((e) => e.kind === "call")
      expect(call?.title).toBe("Call (outgoing) · 1:13")
    })
  })

  it("pads the seconds component to two digits (5s → ' · 0:05')", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const { contactId } = await seedContactAndCall(db, orgId, userId, 5)

      const entries = await loadContactActivityWithDb(db, orgId, contactId)
      const call = entries.find((e) => e.kind === "call")
      expect(call?.title).toBe("Call (outgoing) · 0:05")
    })
  })

  it("omits the duration suffix when durationSeconds is null", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const { contactId } = await seedContactAndCall(db, orgId, userId, null)

      const entries = await loadContactActivityWithDb(db, orgId, contactId)
      const call = entries.find((e) => e.kind === "call")
      expect(call?.title).toBe("Call (outgoing)")
    })
  })

  it("omits the duration suffix when durationSeconds is 0", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const { contactId } = await seedContactAndCall(db, orgId, userId, 0)

      const entries = await loadContactActivityWithDb(db, orgId, contactId)
      const call = entries.find((e) => e.kind === "call")
      expect(call?.title).toBe("Call (outgoing)")
    })
  })
})
