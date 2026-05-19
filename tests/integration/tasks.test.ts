import { describe, it, expect } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { projects } from "@/modules/projects/schema"
import { tasks, taskDependencies, taskChecklistItems, projectStages } from "@/modules/tasks/schema"
import { auditLog } from "@/modules/audit/schema"
import { audit } from "@/modules/audit/audit"

describe("tasks module — CRUD + cascade invariants", () => {
  it("creates a task with all the fields + audit row", async () => {
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
      const taskId = createId()
      await db.insert(tasks).values({
        id: taskId,
        organizationId: orgId,
        projectId,
        title: "Send welcome packet",
        description: "Email the couple their welcome packet.",
        dueDate: "2026-06-01",
        priority: "high",
        assigneeUserId: userId,
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
        "tasks.created",
        { resourceType: "task", resourceId: taskId },
      )

      const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId))
      expect(row?.title).toBe("Send welcome packet")
      expect(row?.priority).toBe("high")
      expect(row?.status).toBe("not_started")
      expect(row?.dueDateOverridden).toBe(false)

      const audits = await db.select().from(auditLog).where(eq(auditLog.organizationId, orgId))
      expect(audits.length).toBe(1)
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
      const taskId = createId()
      await db.insert(tasks).values({
        id: taskId,
        organizationId: orgId,
        projectId,
        title: "T",
        createdBy: userId,
        updatedBy: userId,
      })

      await db
        .update(tasks)
        .set({ deletedAt: new Date(), deletedBy: userId })
        .where(eq(tasks.id, taskId))
      const visible = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.organizationId, orgId), isNull(tasks.deletedAt)))
      expect(visible.length).toBe(0)

      await db.update(tasks).set({ deletedAt: null, deletedBy: null }).where(eq(tasks.id, taskId))
      const restored = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.organizationId, orgId), isNull(tasks.deletedAt)))
      expect(restored.length).toBe(1)
    })
  })

  it("hard-deleting a project cascades tasks + deps + checklist items + stages", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)
      const projectId = createId()
      const stageId = createId()
      const taskA = createId()
      const taskB = createId()
      const depId = createId()
      const checklistId = createId()

      await db.insert(projects).values({
        id: projectId,
        organizationId: orgId,
        name: "P",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(projectStages).values({
        id: stageId,
        organizationId: orgId,
        projectId,
        name: "Pre-shoot",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(tasks).values([
        {
          id: taskA,
          organizationId: orgId,
          projectId,
          projectStageId: stageId,
          title: "A",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: taskB,
          organizationId: orgId,
          projectId,
          title: "B",
          createdBy: userId,
          updatedBy: userId,
        },
      ])
      await db.insert(taskDependencies).values({
        id: depId,
        organizationId: orgId,
        taskId: taskA,
        blockedByTaskId: taskB,
        createdBy: userId,
      })
      await db.insert(taskChecklistItems).values({
        id: checklistId,
        organizationId: orgId,
        taskId: taskA,
        label: "Step 1",
        createdBy: userId,
        updatedBy: userId,
      })

      // Hard-delete the project (simulates the purge cron).
      await db.delete(projects).where(eq(projects.id, projectId))

      const [remTasks, remDeps, remChecklist, remStages] = await Promise.all([
        db.select().from(tasks).where(eq(tasks.projectId, projectId)),
        db.select().from(taskDependencies).where(eq(taskDependencies.id, depId)),
        db.select().from(taskChecklistItems).where(eq(taskChecklistItems.id, checklistId)),
        db.select().from(projectStages).where(eq(projectStages.projectId, projectId)),
      ])
      expect(remTasks.length).toBe(0)
      expect(remDeps.length).toBe(0)
      expect(remChecklist.length).toBe(0)
      expect(remStages.length).toBe(0)
    })
  })

  it("task_dependencies unique (task_id, blocked_by_task_id) prevents duplicate deps", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)
      const projectId = createId()
      const taskA = createId()
      const taskB = createId()
      await db.insert(projects).values({
        id: projectId,
        organizationId: orgId,
        name: "P",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(tasks).values([
        {
          id: taskA,
          organizationId: orgId,
          projectId,
          title: "A",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: taskB,
          organizationId: orgId,
          projectId,
          title: "B",
          createdBy: userId,
          updatedBy: userId,
        },
      ])
      await db.insert(taskDependencies).values({
        id: createId(),
        organizationId: orgId,
        taskId: taskA,
        blockedByTaskId: taskB,
        createdBy: userId,
      })
      // Second attempt with the same pair must fail.
      await expect(
        db.insert(taskDependencies).values({
          id: createId(),
          organizationId: orgId,
          taskId: taskA,
          blockedByTaskId: taskB,
          createdBy: userId,
        }),
      ).rejects.toThrow()
    })
  })

  it("project_stages partial unique on (project_id, name) allows recycle after soft-delete", async () => {
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
      const firstId = createId()
      await db.insert(projectStages).values({
        id: firstId,
        organizationId: orgId,
        projectId,
        name: "Pre-shoot",
        createdBy: userId,
        updatedBy: userId,
      })
      // Soft-delete then re-create with same name.
      await db
        .update(projectStages)
        .set({ deletedAt: new Date(), deletedBy: userId })
        .where(eq(projectStages.id, firstId))
      const secondId = createId()
      await db.insert(projectStages).values({
        id: secondId,
        organizationId: orgId,
        projectId,
        name: "Pre-shoot",
        createdBy: userId,
        updatedBy: userId,
      })
      const live = await db
        .select()
        .from(projectStages)
        .where(and(eq(projectStages.projectId, projectId), isNull(projectStages.deletedAt)))
      expect(live.length).toBe(1)
      expect(live[0]?.id).toBe(secondId)
    })
  })
})
