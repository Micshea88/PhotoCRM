/**
 * Integration test for `findEmailLogByNylasMessageIdAnyOrg` (Task 7).
 *
 * Tests the jsonb `->>'nylasMessageId'` query logic against a real Postgres instance:
 *   - Given an email_log row with externalMetadata.nylasMessageId = "nylas_xxx",
 *     the resolver returns that row's id and organizationId.
 *   - Given no matching row, the resolver returns null.
 *   - Soft-deleted rows are ignored.
 *   - When multiple rows share the same nylasMessageId, the most-recent is returned.
 *
 * Mirrors `tests/integration/resolve-email-log-by-resend-id.test.ts` exactly.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { emailLog } from "@/modules/email-log/schema"
import { findEmailLogByNylasMessageIdAnyOrg } from "@/modules/email-log/queries"

describe("findEmailLogByNylasMessageIdAnyOrg", () => {
  it("returns { id, organizationId } when a matching row exists", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const emailLogId = createId()
      const nylasMessageId = `nylas_test_${createId().slice(0, 8)}`

      await db.insert(emailLog).values({
        id: emailLogId,
        organizationId: orgId,
        direction: "outbound",
        sentAt: new Date(),
        source: "gmail",
        externalMetadata: { nylasMessageId },
      })

      const result = await findEmailLogByNylasMessageIdAnyOrg(db, nylasMessageId)

      expect(result).not.toBeNull()
      expect(result!.id).toBe(emailLogId)
      expect(result!.organizationId).toBe(orgId)
    })
  })

  it("returns null when no email_log has the given nylasMessageId", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Seed a row with a DIFFERENT nylasMessageId.
      await db.insert(emailLog).values({
        id: createId(),
        organizationId: orgId,
        direction: "outbound",
        sentAt: new Date(),
        source: "gmail",
        externalMetadata: { nylasMessageId: `nylas_other_${createId().slice(0, 8)}` },
      })

      const result = await findEmailLogByNylasMessageIdAnyOrg(db, "nylas_nonexistent_xyz_99")

      expect(result).toBeNull()
    })
  })

  it("ignores soft-deleted rows", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const nylasMessageId = `nylas_deleted_${createId().slice(0, 8)}`

      // Insert a soft-deleted row with the target nylasMessageId.
      await db.insert(emailLog).values({
        id: createId(),
        organizationId: orgId,
        direction: "outbound",
        sentAt: new Date(),
        source: "gmail",
        externalMetadata: { nylasMessageId },
        deletedAt: new Date(),
        deletedBy: userId,
      })

      const result = await findEmailLogByNylasMessageIdAnyOrg(db, nylasMessageId)

      expect(result).toBeNull()
    })
  })

  it("returns the most-recent row when multiple rows share the same nylasMessageId", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const nylasMessageId = `nylas_dup_${createId().slice(0, 8)}`
      const olderAt = new Date("2026-01-01T10:00:00Z")
      const newerAt = new Date("2026-06-01T10:00:00Z")

      const olderId = createId()
      const newerId = createId()

      await db.insert(emailLog).values([
        {
          id: olderId,
          organizationId: orgId,
          direction: "outbound",
          sentAt: olderAt,
          source: "gmail",
          externalMetadata: { nylasMessageId },
        },
        {
          id: newerId,
          organizationId: orgId,
          direction: "outbound",
          sentAt: newerAt,
          source: "gmail",
          externalMetadata: { nylasMessageId },
        },
      ])

      const result = await findEmailLogByNylasMessageIdAnyOrg(db, nylasMessageId)

      expect(result!.id).toBe(newerId)
    })
  })
})
