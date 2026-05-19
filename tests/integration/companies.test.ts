import { describe, it, expect } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { companies } from "@/modules/companies/schema"
import { auditLog } from "@/modules/audit/schema"
import { audit } from "@/modules/audit/audit"

/**
 * Behavioural tests for the companies module's db-level invariants:
 * insert, soft-delete, restore, audit row writes, partial-unique
 * recycle-by-name. Tests connect as pathway_app (RLS-subject) and use
 * `setOrgContext` to pass the policy's WITH CHECK clause — same shape as
 * production runtime, just driven by an explicit org id rather than from
 * a session.
 *
 * The orgAction wrapper (auth + session + RLS context auto-setup) is NOT
 * exercised here — that needs cookies and route handlers, which is the
 * E2E suite's job in Phase 10. These tests cover the queries/audit
 * primitives that the action body actually calls.
 *
 * Cross-org isolation (RLS enforcement) is covered by companies-rls.test.ts
 * via raw pg with the app layer bypassed.
 */

describe("companies module — db-level invariants", () => {
  it("creates a company scoped to its org and writes an audit row", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)
      const companyId = createId()

      await db.insert(companies).values({
        id: companyId,
        organizationId: orgId,
        name: "Evergreen Planning",
        website: "https://evergreen.example",
        category: "Wedding Planner",
        createdBy: userId,
        updatedBy: userId,
      })

      await audit(
        {
          db,
          organizationId: orgId,
          actorUserId: userId,
          ipAddress: "127.0.0.1",
          userAgent: "vitest",
        },
        "companies.created",
        { resourceType: "company", resourceId: companyId, metadata: { name: "Evergreen" } },
      )

      const rows = await db
        .select()
        .from(companies)
        .where(and(eq(companies.organizationId, orgId), isNull(companies.deletedAt)))
      expect(rows.length).toBe(1)
      expect(rows[0]?.name).toBe("Evergreen Planning")

      const audits = await db.select().from(auditLog).where(eq(auditLog.organizationId, orgId))
      expect(audits.length).toBe(1)
      expect(audits[0]?.action).toBe("companies.created")
      expect(audits[0]?.resourceId).toBe(companyId)
    })
  })

  it("soft-delete sets deletedAt and is filtered from default reads", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)
      const companyId = createId()

      await db.insert(companies).values({
        id: companyId,
        organizationId: orgId,
        name: "To soft-delete",
        createdBy: userId,
        updatedBy: userId,
      })

      await db
        .update(companies)
        .set({ deletedAt: new Date(), deletedBy: userId })
        .where(eq(companies.id, companyId))

      const visible = await db
        .select()
        .from(companies)
        .where(and(eq(companies.organizationId, orgId), isNull(companies.deletedAt)))
      expect(visible.length).toBe(0)

      const all = await db.select().from(companies).where(eq(companies.organizationId, orgId))
      expect(all.length).toBe(1)
      expect(all[0]?.deletedAt).not.toBeNull()
    })
  })

  it("restore unsets deletedAt", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)
      const companyId = createId()

      await db.insert(companies).values({
        id: companyId,
        organizationId: orgId,
        name: "To restore",
        deletedAt: new Date(),
        deletedBy: userId,
        createdBy: userId,
        updatedBy: userId,
      })

      await db
        .update(companies)
        .set({ deletedAt: null, deletedBy: null })
        .where(eq(companies.id, companyId))

      const visible = await db
        .select()
        .from(companies)
        .where(and(eq(companies.organizationId, orgId), isNull(companies.deletedAt)))
      expect(visible.length).toBe(1)
    })
  })

  it("partial unique index permits same name after soft-delete-and-recreate", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)
      const NAME = "Bloom & Flora"

      const firstId = createId()
      await db.insert(companies).values({
        id: firstId,
        organizationId: orgId,
        name: NAME,
        createdBy: userId,
        updatedBy: userId,
      })

      await db
        .update(companies)
        .set({ deletedAt: new Date(), deletedBy: userId })
        .where(eq(companies.id, firstId))

      const secondId = createId()
      await db.insert(companies).values({
        id: secondId,
        organizationId: orgId,
        name: NAME,
        createdBy: userId,
        updatedBy: userId,
      })

      const visible = await db
        .select()
        .from(companies)
        .where(and(eq(companies.organizationId, orgId), isNull(companies.deletedAt)))
      expect(visible.length).toBe(1)
      expect(visible[0]?.id).toBe(secondId)
    })
  })
})
