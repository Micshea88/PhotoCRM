import { describe, it, expect } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { opportunities } from "@/modules/opportunities/schema"
import { projects } from "@/modules/projects/schema"
import { pipelines, pipelineStages } from "@/modules/pipelines/schema"
import { auditLog } from "@/modules/audit/schema"
import { audit } from "@/modules/audit/audit"

describe("opportunities module — db-level invariants", () => {
  it("creates an opportunity tied to project + pipeline + stage", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const projectId = createId()
      const pipelineId = createId()
      const stageId = createId()
      await db.insert(projects).values({
        id: projectId,
        organizationId: orgId,
        name: "Smith Wedding",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(pipelines).values({
        id: pipelineId,
        organizationId: orgId,
        name: "Sales",
        type: "sales",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(pipelineStages).values({
        id: stageId,
        organizationId: orgId,
        pipelineId,
        name: "New Inquiry",
        order: 0,
        probability: 10,
        createdBy: userId,
        updatedBy: userId,
      })

      const oppId = createId()
      await db.insert(opportunities).values({
        id: oppId,
        organizationId: orgId,
        projectId,
        pipelineId,
        stageId,
        valueCents: 680000,
        probabilityBps: 1000, // 10% in bps (matches stage default if seeded as 1000)
        status: "open",
        ownerUserId: userId,
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
        "opportunities.created",
        { resourceType: "opportunity", resourceId: oppId },
      )

      const [row] = await db.select().from(opportunities).where(eq(opportunities.id, oppId))
      expect(row?.valueCents).toBe(680000)
      expect(row?.probabilityBps).toBe(1000)
      expect(row?.status).toBe("open")
      expect(row?.stageChangedAt).not.toBeNull()

      const audits = await db.select().from(auditLog).where(eq(auditLog.organizationId, orgId))
      expect(audits.length).toBe(1)
      expect(audits[0]?.action).toBe("opportunities.created")
    })
  })

  it("one project can have multiple opportunities in different pipelines", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const projectId = createId()
      await db.insert(projects).values({
        id: projectId,
        organizationId: orgId,
        name: "Smith Wedding",
        createdBy: userId,
        updatedBy: userId,
      })

      const salesPipelineId = createId()
      const productionPipelineId = createId()
      const salesStageId = createId()
      const productionStageId = createId()

      await db.insert(pipelines).values([
        {
          id: salesPipelineId,
          organizationId: orgId,
          name: "Sales",
          type: "sales",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: productionPipelineId,
          organizationId: orgId,
          name: "Production",
          type: "production",
          createdBy: userId,
          updatedBy: userId,
        },
      ])
      await db.insert(pipelineStages).values([
        {
          id: salesStageId,
          organizationId: orgId,
          pipelineId: salesPipelineId,
          name: "New Inquiry",
          order: 0,
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: productionStageId,
          organizationId: orgId,
          pipelineId: productionPipelineId,
          name: "Booked",
          order: 0,
          createdBy: userId,
          updatedBy: userId,
        },
      ])

      await db.insert(opportunities).values([
        {
          id: createId(),
          organizationId: orgId,
          projectId,
          pipelineId: salesPipelineId,
          stageId: salesStageId,
          status: "won",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: createId(),
          organizationId: orgId,
          projectId,
          pipelineId: productionPipelineId,
          stageId: productionStageId,
          status: "open",
          createdBy: userId,
          updatedBy: userId,
        },
      ])

      const all = await db
        .select()
        .from(opportunities)
        .where(eq(opportunities.projectId, projectId))
      expect(all.length).toBe(2)
      const byPipeline = Object.fromEntries(all.map((o) => [o.pipelineId, o.status]))
      expect(byPipeline[salesPipelineId]).toBe("won")
      expect(byPipeline[productionPipelineId]).toBe("open")
    })
  })

  it("hard-deleting a project cascades opportunities", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const projectId = createId()
      const pipelineId = createId()
      const stageId = createId()
      await db.insert(projects).values({
        id: projectId,
        organizationId: orgId,
        name: "P",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(pipelines).values({
        id: pipelineId,
        organizationId: orgId,
        name: "Sales",
        type: "sales",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(pipelineStages).values({
        id: stageId,
        organizationId: orgId,
        pipelineId,
        name: "X",
        order: 0,
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(opportunities).values({
        id: createId(),
        organizationId: orgId,
        projectId,
        pipelineId,
        stageId,
        createdBy: userId,
        updatedBy: userId,
      })

      await db.delete(projects).where(eq(projects.id, projectId))
      const remaining = await db
        .select()
        .from(opportunities)
        .where(eq(opportunities.projectId, projectId))
      expect(remaining.length).toBe(0)
    })
  })

  it("pipeline_id FK is ON DELETE RESTRICT when opportunity exists", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const projectId = createId()
      const pipelineId = createId()
      const stageId = createId()
      await db.insert(projects).values({
        id: projectId,
        organizationId: orgId,
        name: "P",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(pipelines).values({
        id: pipelineId,
        organizationId: orgId,
        name: "Sales",
        type: "sales",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(pipelineStages).values({
        id: stageId,
        organizationId: orgId,
        pipelineId,
        name: "X",
        order: 0,
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(opportunities).values({
        id: createId(),
        organizationId: orgId,
        projectId,
        pipelineId,
        stageId,
        createdBy: userId,
        updatedBy: userId,
      })

      // RESTRICT means you can't purge a pipeline with active opportunities.
      // Drizzle wraps the pg FK violation; just assert that it throws.
      await expect(db.delete(pipelines).where(eq(pipelines.id, pipelineId))).rejects.toThrow()
    })
  })

  it("stage move: stage_changed_at updates", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const projectId = createId()
      const pipelineId = createId()
      const stage1Id = createId()
      const stage2Id = createId()
      const oppId = createId()

      await db.insert(projects).values({
        id: projectId,
        organizationId: orgId,
        name: "P",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(pipelines).values({
        id: pipelineId,
        organizationId: orgId,
        name: "Sales",
        type: "sales",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(pipelineStages).values([
        {
          id: stage1Id,
          organizationId: orgId,
          pipelineId,
          name: "Stage1",
          order: 0,
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: stage2Id,
          organizationId: orgId,
          pipelineId,
          name: "Stage2",
          order: 1,
          createdBy: userId,
          updatedBy: userId,
        },
      ])
      const initialChanged = new Date("2026-01-01T00:00:00.000Z")
      await db.insert(opportunities).values({
        id: oppId,
        organizationId: orgId,
        projectId,
        pipelineId,
        stageId: stage1Id,
        stageChangedAt: initialChanged,
        createdBy: userId,
        updatedBy: userId,
      })

      // Move to stage 2 — bump stage_changed_at to NOW().
      await db
        .update(opportunities)
        .set({ stageId: stage2Id, stageChangedAt: new Date() })
        .where(eq(opportunities.id, oppId))

      const [row] = await db.select().from(opportunities).where(eq(opportunities.id, oppId))
      expect(row?.stageId).toBe(stage2Id)
      expect(row?.stageChangedAt && row.stageChangedAt > initialChanged).toBe(true)
    })
  })

  it("soft-delete + restore round-trip", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const projectId = createId()
      const pipelineId = createId()
      const stageId = createId()
      const oppId = createId()

      await db.insert(projects).values({
        id: projectId,
        organizationId: orgId,
        name: "P",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(pipelines).values({
        id: pipelineId,
        organizationId: orgId,
        name: "Sales",
        type: "sales",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(pipelineStages).values({
        id: stageId,
        organizationId: orgId,
        pipelineId,
        name: "X",
        order: 0,
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(opportunities).values({
        id: oppId,
        organizationId: orgId,
        projectId,
        pipelineId,
        stageId,
        createdBy: userId,
        updatedBy: userId,
      })

      await db
        .update(opportunities)
        .set({ deletedAt: new Date(), deletedBy: userId })
        .where(eq(opportunities.id, oppId))
      const visible = await db
        .select()
        .from(opportunities)
        .where(and(eq(opportunities.organizationId, orgId), isNull(opportunities.deletedAt)))
      expect(visible.length).toBe(0)

      await db
        .update(opportunities)
        .set({ deletedAt: null, deletedBy: null })
        .where(eq(opportunities.id, oppId))
      const restored = await db
        .select()
        .from(opportunities)
        .where(and(eq(opportunities.organizationId, orgId), isNull(opportunities.deletedAt)))
      expect(restored.length).toBe(1)
    })
  })
})
