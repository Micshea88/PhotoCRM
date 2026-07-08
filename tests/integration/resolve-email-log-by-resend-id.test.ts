/**
 * Integration test for `findEmailLogByResendEmailIdAnyOrg` (Task 6 Part 2).
 *
 * Tests the jsonb `->>` query logic against a real Postgres instance:
 *   - Given an email_log row with externalMetadata.resendEmailId = "re_x",
 *     the resolver returns that row's id and organizationId.
 *   - Given no matching row, the resolver returns null.
 *
 * Cross-org (RLS bypass) note: in production the base pool role is
 * `neondb_owner` (BYPASSRLS), so FORCE ROW LEVEL SECURITY is bypassed and
 * the query finds rows across all orgs without any GUC. In dev the pool
 * connects as `pathway_app` (NOBYPASSRLS), which IS subject to FORCE RLS.
 * This test therefore sets the org GUC before inserting and querying so it
 * works in both environments — we're verifying the query logic (jsonb operator,
 * returned fields, null on miss), not testing the RLS bypass which is a
 * production-only property.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { emailLog } from "@/modules/email-log/schema"
import { findEmailLogByResendEmailIdAnyOrg } from "@/modules/email-log/queries"

describe("findEmailLogByResendEmailIdAnyOrg", () => {
  it("returns { id, organizationId } when a matching row exists", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const emailLogId = createId()
      const resendEmailId = `re_test_${createId().slice(0, 8)}`

      await db.insert(emailLog).values({
        id: emailLogId,
        organizationId: orgId,
        direction: "outbound",
        sentAt: new Date(),
        source: "resend",
        externalMetadata: { resendEmailId },
      })

      const result = await findEmailLogByResendEmailIdAnyOrg(db, resendEmailId)

      expect(result).not.toBeNull()
      expect(result!.id).toBe(emailLogId)
      expect(result!.organizationId).toBe(orgId)
    })
  })

  it("returns null when no email_log has the given resendEmailId", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Seed a row with a DIFFERENT resendEmailId.
      await db.insert(emailLog).values({
        id: createId(),
        organizationId: orgId,
        direction: "outbound",
        sentAt: new Date(),
        source: "resend",
        externalMetadata: { resendEmailId: `re_other_${createId().slice(0, 8)}` },
      })

      const result = await findEmailLogByResendEmailIdAnyOrg(db, "re_nonexistent_xyz_99")

      expect(result).toBeNull()
    })
  })

  it("ignores soft-deleted rows", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const resendEmailId = `re_deleted_${createId().slice(0, 8)}`

      // Insert a soft-deleted row with the target resendEmailId.
      await db.insert(emailLog).values({
        id: createId(),
        organizationId: orgId,
        direction: "outbound",
        sentAt: new Date(),
        source: "resend",
        externalMetadata: { resendEmailId },
        deletedAt: new Date(),
        deletedBy: userId,
      })

      const result = await findEmailLogByResendEmailIdAnyOrg(db, resendEmailId)

      expect(result).toBeNull()
    })
  })

  it("returns the most-recent row when multiple rows share the same resendEmailId", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const resendEmailId = `re_dup_${createId().slice(0, 8)}`
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
          source: "resend",
          externalMetadata: { resendEmailId },
        },
        {
          id: newerId,
          organizationId: orgId,
          direction: "outbound",
          sentAt: newerAt,
          source: "resend",
          externalMetadata: { resendEmailId },
        },
      ])

      const result = await findEmailLogByResendEmailIdAnyOrg(db, resendEmailId)

      expect(result!.id).toBe(newerId)
    })
  })
})
