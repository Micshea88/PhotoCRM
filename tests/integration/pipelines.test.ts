import { describe, it, expect } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { pipelines, pipelineStages } from "@/modules/pipelines/schema"
import { seedDefaultPipelines } from "@/modules/pipelines/seed"
import { auditLog } from "@/modules/audit/schema"
import { audit } from "@/modules/audit/audit"

describe("pipelines module — db-level invariants", () => {
  it("creates a pipeline + stages with the right ordering", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const pipelineId = createId()
      await db.insert(pipelines).values({
        id: pipelineId,
        organizationId: orgId,
        name: "Sales",
        type: "sales",
        displayOrder: 0,
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(pipelineStages).values([
        {
          id: createId(),
          organizationId: orgId,
          pipelineId,
          name: "New Inquiry",
          order: 0,
          probability: 10,
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: createId(),
          organizationId: orgId,
          pipelineId,
          name: "Booked",
          order: 6,
          probability: 100,
          createdBy: userId,
          updatedBy: userId,
        },
      ])

      const stages = await db
        .select({ name: pipelineStages.name, order: pipelineStages.order })
        .from(pipelineStages)
        .where(and(eq(pipelineStages.pipelineId, pipelineId), isNull(pipelineStages.deletedAt)))
        .orderBy(pipelineStages.order)
      expect(stages).toEqual([
        { name: "New Inquiry", order: 0 },
        { name: "Booked", order: 6 },
      ])
    })
  })

  it("hard-deleting a pipeline cascades to stages", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const pipelineId = createId()
      await db.insert(pipelines).values({
        id: pipelineId,
        organizationId: orgId,
        name: "Sales",
        type: "sales",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(pipelineStages).values({
        id: createId(),
        organizationId: orgId,
        pipelineId,
        name: "Stage 1",
        order: 0,
        createdBy: userId,
        updatedBy: userId,
      })

      // Hard-delete the pipeline (simulates the purge cron). ON DELETE
      // CASCADE on pipeline_id means stages go too.
      await db.delete(pipelines).where(eq(pipelines.id, pipelineId))

      const remainingStages = await db
        .select()
        .from(pipelineStages)
        .where(eq(pipelineStages.pipelineId, pipelineId))
      expect(remainingStages.length).toBe(0)
    })
  })

  it("audit() writes a pipelines.created row through ctx.db", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const pipelineId = createId()
      await db.insert(pipelines).values({
        id: pipelineId,
        organizationId: orgId,
        name: "Sales",
        type: "sales",
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
        "pipelines.created",
        { resourceType: "pipeline", resourceId: pipelineId },
      )

      const audits = await db.select().from(auditLog).where(eq(auditLog.organizationId, orgId))
      expect(audits.length).toBe(1)
      expect(audits[0]?.action).toBe("pipelines.created")
    })
  })
})

describe("seedDefaultPipelines", () => {
  it("inserts the 5 V1 default pipelines with the expected stage counts", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      await seedDefaultPipelines(db, orgId)

      const allPipelines = await db
        .select({ name: pipelines.name, type: pipelines.type })
        .from(pipelines)
        .where(and(eq(pipelines.organizationId, orgId), isNull(pipelines.deletedAt)))
        .orderBy(pipelines.displayOrder)
      expect(allPipelines.map((p) => p.type)).toEqual([
        "sales",
        "production",
        "post_production_wedding",
        "post_production_family",
        "album_production",
      ])

      // Stage counts per pipeline match Requirements §6.3.
      const expectedStageCount: Record<string, number> = {
        sales: 8,
        production: 9,
        post_production_wedding: 13,
        post_production_family: 9,
        album_production: 15,
      }
      for (const p of allPipelines) {
        const [pipelineRow] = await db
          .select({ id: pipelines.id })
          .from(pipelines)
          .where(
            and(
              eq(pipelines.organizationId, orgId),
              eq(pipelines.type, p.type),
              isNull(pipelines.deletedAt),
            ),
          )
          .limit(1)
        const stages = await db
          .select()
          .from(pipelineStages)
          .where(
            and(eq(pipelineStages.pipelineId, pipelineRow!.id), isNull(pipelineStages.deletedAt)),
          )
        expect(stages.length).toBe(expectedStageCount[p.type])
      }
    })
  })

  it("is idempotent (rerunning is a no-op)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      await seedDefaultPipelines(db, orgId)
      const firstCount = await db
        .select()
        .from(pipelines)
        .where(eq(pipelines.organizationId, orgId))
      await seedDefaultPipelines(db, orgId)
      const secondCount = await db
        .select()
        .from(pipelines)
        .where(eq(pipelines.organizationId, orgId))

      expect(secondCount.length).toBe(firstCount.length)
      expect(firstCount.length).toBe(5)
    })
  })
})
