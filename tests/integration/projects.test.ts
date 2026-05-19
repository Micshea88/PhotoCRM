import { describe, it, expect } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import {
  projects,
  projectContacts,
  projectPhotographers,
  projectSubEvents,
} from "@/modules/projects/schema"
import { contacts } from "@/modules/contacts/schema"
import { auditLog } from "@/modules/audit/schema"
import { audit } from "@/modules/audit/audit"

describe("projects module — db-level invariants", () => {
  it("creates a project with integer-cents money + writes audit row", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)
      const projectId = createId()

      await db.insert(projects).values({
        id: projectId,
        organizationId: orgId,
        name: "Smith Wedding",
        projectType: "Wedding",
        primaryDate: "2026-08-15",
        anniversaryDate: "2026-08-15",
        packageBasePriceCents: 680000, // $6,800.00
        discountType: "percent",
        discountValue: 1500, // 15.00% in bps
        taxRateBps: 825, // 8.25% in bps
        taxSign: "add",
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
        "projects.created",
        { resourceType: "project", resourceId: projectId },
      )

      const [row] = await db.select().from(projects).where(eq(projects.id, projectId))
      expect(row?.packageBasePriceCents).toBe(680000)
      expect(row?.discountValue).toBe(1500)
      expect(row?.taxRateBps).toBe(825)
      expect(row?.anniversaryDate).toBe("2026-08-15")

      const audits = await db.select().from(auditLog).where(eq(auditLog.organizationId, orgId))
      expect(audits.length).toBe(1)
      expect(audits[0]?.action).toBe("projects.created")
    })
  })

  it("soft-delete + restore round-trip", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)
      const projectId = createId()

      await db.insert(projects).values({
        id: projectId,
        organizationId: orgId,
        name: "P",
        createdBy: userId,
        updatedBy: userId,
      })
      await db
        .update(projects)
        .set({ deletedAt: new Date(), deletedBy: userId })
        .where(eq(projects.id, projectId))

      const visible = await db
        .select()
        .from(projects)
        .where(and(eq(projects.organizationId, orgId), isNull(projects.deletedAt)))
      expect(visible.length).toBe(0)

      await db
        .update(projects)
        .set({ deletedAt: null, deletedBy: null })
        .where(eq(projects.id, projectId))
      const restored = await db
        .select()
        .from(projects)
        .where(and(eq(projects.organizationId, orgId), isNull(projects.deletedAt)))
      expect(restored.length).toBe(1)
    })
  })

  it("hard-deleting a project cascades to all 3 sub-tables", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)
      const projectId = createId()
      const contactId = createId()

      await db.insert(projects).values({
        id: projectId,
        organizationId: orgId,
        name: "P",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(contacts).values({
        id: contactId,
        organizationId: orgId,
        firstName: "Kelly",
        lastName: "Smith",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(projectContacts).values({
        id: createId(),
        organizationId: orgId,
        projectId,
        contactId,
        role: "primary",
        createdBy: userId,
      })
      await db.insert(projectPhotographers).values({
        id: createId(),
        organizationId: orgId,
        projectId,
        userId,
        role: "lead",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(projectSubEvents).values({
        id: createId(),
        organizationId: orgId,
        projectId,
        eventType: "engagement",
        createdBy: userId,
        updatedBy: userId,
      })

      // Hard-delete the project (simulates the purge cron). ON DELETE
      // CASCADE on project_id means all three sub-tables follow.
      await db.delete(projects).where(eq(projects.id, projectId))

      const [cContacts, cPhotographers, cSubEvents] = await Promise.all([
        db.select().from(projectContacts).where(eq(projectContacts.projectId, projectId)),
        db.select().from(projectPhotographers).where(eq(projectPhotographers.projectId, projectId)),
        db.select().from(projectSubEvents).where(eq(projectSubEvents.projectId, projectId)),
      ])
      expect(cContacts.length).toBe(0)
      expect(cPhotographers.length).toBe(0)
      expect(cSubEvents.length).toBe(0)

      // Contact survives (ON DELETE RESTRICT means it wasn't cascade-deleted).
      const contactRow = await db.select().from(contacts).where(eq(contacts.id, contactId))
      expect(contactRow.length).toBe(1)
    })
  })

  it("project_contacts FK to contacts is ON DELETE RESTRICT", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)
      const projectId = createId()
      const contactId = createId()

      await db.insert(projects).values({
        id: projectId,
        organizationId: orgId,
        name: "P",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(contacts).values({
        id: contactId,
        organizationId: orgId,
        firstName: "Kelly",
        lastName: "Smith",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(projectContacts).values({
        id: createId(),
        organizationId: orgId,
        projectId,
        contactId,
        role: "primary",
        createdBy: userId,
      })

      // The contact has an active association — hard-delete must fail
      // due to ON DELETE RESTRICT on project_contacts.contact_id.
      // (Drizzle wraps the pg error so we don't match a specific message
      // pattern; just assert that the delete throws.)
      await expect(db.delete(contacts).where(eq(contacts.id, contactId))).rejects.toThrow()
    })
  })

  it("can store multiple contacts on one project with different roles", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)
      const projectId = createId()
      const primaryId = createId()
      const partnerId = createId()
      const billingId = createId()

      await db.insert(projects).values({
        id: projectId,
        organizationId: orgId,
        name: "Couples Wedding",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(contacts).values([
        {
          id: primaryId,
          organizationId: orgId,
          firstName: "Alice",
          lastName: "A",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: partnerId,
          organizationId: orgId,
          firstName: "Bob",
          lastName: "B",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: billingId,
          organizationId: orgId,
          firstName: "Carol",
          lastName: "C",
          createdBy: userId,
          updatedBy: userId,
        },
      ])
      await db.insert(projectContacts).values([
        {
          id: createId(),
          organizationId: orgId,
          projectId,
          contactId: primaryId,
          role: "primary",
          createdBy: userId,
        },
        {
          id: createId(),
          organizationId: orgId,
          projectId,
          contactId: partnerId,
          role: "partner",
          createdBy: userId,
        },
        {
          id: createId(),
          organizationId: orgId,
          projectId,
          contactId: billingId,
          role: "billing",
          createdBy: userId,
        },
      ])

      const rows = await db
        .select({ role: projectContacts.role, contactId: projectContacts.contactId })
        .from(projectContacts)
        .where(eq(projectContacts.projectId, projectId))
        .orderBy(projectContacts.role)
      expect(rows.length).toBe(3)
      const rolesByContact = Object.fromEntries(rows.map((r) => [r.contactId, r.role]))
      expect(rolesByContact[primaryId]).toBe("primary")
      expect(rolesByContact[partnerId]).toBe("partner")
      expect(rolesByContact[billingId]).toBe("billing")
    })
  })
})
