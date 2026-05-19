import { describe, it, expect } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { projectTemplates, projectTemplateTaskItems } from "@/modules/project-templates/schema"
import { auditLog } from "@/modules/audit/schema"
import { audit } from "@/modules/audit/audit"

describe("project-templates module — db-level invariants", () => {
  it("creates a template + task items with relative offsets", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const templateId = createId()
      await db.insert(projectTemplates).values({
        id: templateId,
        organizationId: orgId,
        name: "Wedding default",
        projectType: "Wedding",
        defaultWorkflowIds: ["wf1", "wf2"],
        createdBy: userId,
        updatedBy: userId,
      })
      // T−90 send welcome, T−7 confirm timeline, T+2 back up files
      const itemA = createId()
      const itemB = createId()
      const itemC = createId()
      await db.insert(projectTemplateTaskItems).values([
        {
          id: itemA,
          organizationId: orgId,
          projectTemplateId: templateId,
          stageName: "Pre-shoot",
          title: "Send welcome packet",
          relativeOffsetDays: -90,
          assigneeRole: "Lead Photographer",
          order: 0,
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: itemB,
          organizationId: orgId,
          projectTemplateId: templateId,
          stageName: "Pre-shoot",
          title: "Confirm timeline",
          relativeOffsetDays: -7,
          assigneeRole: "Lead Photographer",
          blockedByTemplateItemId: itemA,
          order: 1,
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: itemC,
          organizationId: orgId,
          projectTemplateId: templateId,
          stageName: "Post",
          title: "Back up files",
          relativeOffsetDays: 2,
          assigneeRole: "Editor",
          order: 2,
          createdBy: userId,
          updatedBy: userId,
        },
      ])
      await audit(
        {
          db,
          organizationId: orgId,
          actorUserId: userId,
          ipAddress: "127.0.0.1",
          userAgent: "vitest",
        },
        "project_templates.created",
        { resourceType: "project_template", resourceId: templateId },
      )

      const items = await db
        .select({
          title: projectTemplateTaskItems.title,
          relativeOffsetDays: projectTemplateTaskItems.relativeOffsetDays,
          stageName: projectTemplateTaskItems.stageName,
          blockedByTemplateItemId: projectTemplateTaskItems.blockedByTemplateItemId,
          order: projectTemplateTaskItems.order,
        })
        .from(projectTemplateTaskItems)
        .where(eq(projectTemplateTaskItems.projectTemplateId, templateId))
        .orderBy(projectTemplateTaskItems.order)
      expect(items.length).toBe(3)
      expect(items[0]).toMatchObject({
        title: "Send welcome packet",
        relativeOffsetDays: -90,
      })
      expect(items[1]?.blockedByTemplateItemId).toBe(itemA)
      expect(items[2]?.relativeOffsetDays).toBe(2)

      const audits = await db.select().from(auditLog).where(eq(auditLog.organizationId, orgId))
      expect(audits.length).toBe(1)
    })
  })

  it("hard-deleting a template cascades to task items", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const templateId = createId()
      await db.insert(projectTemplates).values({
        id: templateId,
        organizationId: orgId,
        name: "T",
        projectType: "Wedding",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(projectTemplateTaskItems).values({
        id: createId(),
        organizationId: orgId,
        projectTemplateId: templateId,
        stageName: "S",
        title: "Item",
        relativeOffsetDays: 0,
        createdBy: userId,
        updatedBy: userId,
      })

      // Hard-delete template — items cascade.
      await db.delete(projectTemplates).where(eq(projectTemplates.id, templateId))
      const remaining = await db
        .select()
        .from(projectTemplateTaskItems)
        .where(eq(projectTemplateTaskItems.projectTemplateId, templateId))
      expect(remaining.length).toBe(0)
    })
  })

  it("blockedByTemplateItemId self-reference goes ON DELETE SET NULL", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const templateId = createId()
      const itemA = createId()
      const itemB = createId()
      await db.insert(projectTemplates).values({
        id: templateId,
        organizationId: orgId,
        name: "T",
        projectType: "Wedding",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(projectTemplateTaskItems).values([
        {
          id: itemA,
          organizationId: orgId,
          projectTemplateId: templateId,
          stageName: "S",
          title: "A",
          relativeOffsetDays: 0,
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: itemB,
          organizationId: orgId,
          projectTemplateId: templateId,
          stageName: "S",
          title: "B",
          relativeOffsetDays: 1,
          blockedByTemplateItemId: itemA,
          createdBy: userId,
          updatedBy: userId,
        },
      ])
      // Hard-delete A; B's blocker pointer should null out.
      await db.delete(projectTemplateTaskItems).where(eq(projectTemplateTaskItems.id, itemA))
      const [row] = await db
        .select({ blockedBy: projectTemplateTaskItems.blockedByTemplateItemId })
        .from(projectTemplateTaskItems)
        .where(eq(projectTemplateTaskItems.id, itemB))
      expect(row?.blockedBy).toBeNull()
    })
  })

  it("soft-delete + restore round-trip preserves items", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const templateId = createId()
      await db.insert(projectTemplates).values({
        id: templateId,
        organizationId: orgId,
        name: "T",
        projectType: "Wedding",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(projectTemplateTaskItems).values({
        id: createId(),
        organizationId: orgId,
        projectTemplateId: templateId,
        stageName: "S",
        title: "Item",
        relativeOffsetDays: 0,
        createdBy: userId,
        updatedBy: userId,
      })

      await db
        .update(projectTemplates)
        .set({ deletedAt: new Date(), deletedBy: userId })
        .where(eq(projectTemplates.id, templateId))
      // Items survive — soft-delete does not cascade.
      const itemsAfterSoft = await db
        .select()
        .from(projectTemplateTaskItems)
        .where(eq(projectTemplateTaskItems.projectTemplateId, templateId))
      expect(itemsAfterSoft.length).toBe(1)

      // Restore the template; items still there.
      await db
        .update(projectTemplates)
        .set({ deletedAt: null, deletedBy: null })
        .where(eq(projectTemplates.id, templateId))
      const itemsAfterRestore = await db
        .select()
        .from(projectTemplateTaskItems)
        .where(eq(projectTemplateTaskItems.projectTemplateId, templateId))
      expect(itemsAfterRestore.length).toBe(1)
    })
  })
})
