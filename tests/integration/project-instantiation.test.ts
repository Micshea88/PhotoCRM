/**
 * Integration tests for instantiateProjectFromTemplate — the engine
 * that turns a template into a live project task graph at project
 * creation time. Per Tech Arch §4.
 *
 * These tests pin down:
 *   - Tasks created with computed due_dates (primary_date + offset_days)
 *   - Project stages deduped by stageName
 *   - assigneeRole resolves to the matching project_photographer (lead/
 *     second/backup); unmatched roles produce null assigneeUserId
 *   - Dependencies wired correctly + dependent task forced to 'blocked'
 *   - Checklist items copied through to task_checklist_items
 *   - Null primary_date produces tasks with null due_date (no crash)
 *   - Re-instantiation is rejected
 */
import { describe, it, expect } from "vitest"
import { and, eq, isNotNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { projects, projectPhotographers } from "@/modules/projects/schema"
import { projectStages, tasks, taskDependencies, taskChecklistItems } from "@/modules/tasks/schema"
import { projectTemplates, projectTemplateTaskItems } from "@/modules/project-templates/schema"
import { instantiateProjectFromTemplate } from "@/modules/projects/instantiation"

async function seedTemplate(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  orgId: string,
  userId: string,
  items: {
    id?: string
    stageName: string
    title: string
    relativeOffsetDays: number
    assigneeRole?: string | null
    blockedByTemplateItemId?: string | null
    checklistItems?: unknown[] | null
    order?: number
  }[],
) {
  const templateId = createId()
  await db.insert(projectTemplates).values({
    id: templateId,
    organizationId: orgId,
    name: "Test template",
    projectType: "Wedding",
    createdBy: userId,
    updatedBy: userId,
  })
  await db.insert(projectTemplateTaskItems).values(
    items.map((it, idx) => ({
      id: it.id ?? createId(),
      organizationId: orgId,
      projectTemplateId: templateId,
      stageName: it.stageName,
      title: it.title,
      relativeOffsetDays: it.relativeOffsetDays,
      assigneeRole: it.assigneeRole ?? null,
      blockedByTemplateItemId: it.blockedByTemplateItemId ?? null,
      checklistItems: it.checklistItems ?? null,
      order: it.order ?? idx,
      createdBy: userId,
      updatedBy: userId,
    })),
  )
  return templateId
}

async function seedProject(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  orgId: string,
  userId: string,
  primaryDate: string | null,
) {
  const projectId = createId()
  await db.insert(projects).values({
    id: projectId,
    organizationId: orgId,
    name: "Test project",
    projectType: "Wedding",
    primaryDate,
    createdBy: userId,
    updatedBy: userId,
  })
  return projectId
}

describe("instantiateProjectFromTemplate", () => {
  it("creates one task per template item with computed due_dates", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const projectId = await seedProject(db, orgId, userId, "2026-06-15")
      const templateId = await seedTemplate(db, orgId, userId, [
        { stageName: "Pre-shoot", title: "Send welcome packet", relativeOffsetDays: -90 },
        { stageName: "Pre-shoot", title: "Confirm timeline", relativeOffsetDays: -7 },
        { stageName: "Post", title: "Back up files", relativeOffsetDays: 2 },
      ])

      const result = await instantiateProjectFromTemplate(db, {
        projectId,
        templateId,
        organizationId: orgId,
        userId,
      })
      expect(result.tasksCreated).toBe(3)
      expect(result.stagesCreated).toBe(2) // Pre-shoot + Post (deduped)

      const taskRows = await db
        .select({
          title: tasks.title,
          dueDate: tasks.dueDate,
        })
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
        .orderBy(tasks.title)
      expect(taskRows).toEqual(
        expect.arrayContaining([
          { title: "Back up files", dueDate: "2026-06-17" }, // +2
          { title: "Confirm timeline", dueDate: "2026-06-08" }, // -7
          { title: "Send welcome packet", dueDate: "2026-03-17" }, // -90
        ]),
      )

      // Project should be marked as templated.
      const [projectRow] = await db
        .select({ templateId: projects.templateId })
        .from(projects)
        .where(eq(projects.id, projectId))
      expect(projectRow?.templateId).toBe(templateId)
    })
  })

  it("dedupes stages by stageName — three items with two distinct stages = 2 stages", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const projectId = await seedProject(db, orgId, userId, "2026-06-15")
      await seedTemplate(db, orgId, userId, [
        { stageName: "Pre-shoot", title: "A", relativeOffsetDays: -30 },
        { stageName: "Pre-shoot", title: "B", relativeOffsetDays: -20 },
        { stageName: "Post", title: "C", relativeOffsetDays: 1 },
      ])
      const templates = await db
        .select({ id: projectTemplates.id })
        .from(projectTemplates)
        .where(eq(projectTemplates.organizationId, orgId))
      const templateId = templates[0]!.id

      await instantiateProjectFromTemplate(db, {
        projectId,
        templateId,
        organizationId: orgId,
        userId,
      })

      const stageRows = await db
        .select({ name: projectStages.name })
        .from(projectStages)
        .where(eq(projectStages.projectId, projectId))
      const stageNames = stageRows.map((s) => s.name).sort()
      expect(stageNames).toEqual(["Post", "Pre-shoot"])
    })
  })

  it("wires dependencies AND forces the dependent task to 'blocked'", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const projectId = await seedProject(db, orgId, userId, "2026-06-15")
      const itemA = createId()
      const itemB = createId()
      const templateId = await seedTemplate(db, orgId, userId, [
        { id: itemA, stageName: "S", title: "A — blocker", relativeOffsetDays: -10 },
        {
          id: itemB,
          stageName: "S",
          title: "B — blocked",
          relativeOffsetDays: -5,
          blockedByTemplateItemId: itemA,
        },
      ])

      const result = await instantiateProjectFromTemplate(db, {
        projectId,
        templateId,
        organizationId: orgId,
        userId,
      })
      expect(result.dependenciesCreated).toBe(1)

      const taskRows = await db
        .select({ title: tasks.title, status: tasks.status })
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
      const byTitle = Object.fromEntries(taskRows.map((t) => [t.title, t.status]))
      expect(byTitle["A — blocker"]).toBe("not_started")
      // The dependency-flip helper sees a not-done blocker → B is blocked.
      expect(byTitle["B — blocked"]).toBe("blocked")

      // The actual task_dependencies row exists with the right shape.
      const deps = await db
        .select()
        .from(taskDependencies)
        .where(eq(taskDependencies.organizationId, orgId))
      expect(deps.length).toBe(1)
    })
  })

  it("resolves assigneeRole to the matching project_photographer (lead)", async () => {
    await withTestDb(async (db) => {
      const ownerId = await createUser(db)
      const leadId = await createUser(db)
      const orgId = await createOrganization(db, ownerId)
      await setOrgContext(db, orgId)
      // Both users need to be members; the lead's photographer assignment requires it.
      const { member } = await import("@/modules/auth/schema")
      await db.insert(member).values({
        id: createId(),
        organizationId: orgId,
        userId: leadId,
        role: "member",
        createdAt: new Date(),
      })

      const projectId = await seedProject(db, orgId, ownerId, "2026-06-15")
      await db.insert(projectPhotographers).values({
        id: createId(),
        organizationId: orgId,
        projectId,
        userId: leadId,
        role: "lead",
        createdBy: ownerId,
        updatedBy: ownerId,
      })
      const templateId = await seedTemplate(db, orgId, ownerId, [
        {
          stageName: "Shoot",
          title: "Lead photographer task",
          relativeOffsetDays: 0,
          assigneeRole: "Lead Photographer",
        },
      ])
      // Run instantiation as ownerId.
      await instantiateProjectFromTemplate(db, {
        projectId,
        templateId,
        organizationId: orgId,
        userId: ownerId,
      })

      const [row] = await db
        .select({ assigneeUserId: tasks.assigneeUserId })
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
      expect(row?.assigneeUserId).toBe(leadId)
    })
  })

  it("leaves assigneeUserId null when no project_photographer matches the role", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const projectId = await seedProject(db, orgId, userId, "2026-06-15")
      // No project_photographers attached.
      const templateId = await seedTemplate(db, orgId, userId, [
        {
          stageName: "Shoot",
          title: "Editor task",
          relativeOffsetDays: 5,
          assigneeRole: "Editor",
        },
      ])
      await instantiateProjectFromTemplate(db, {
        projectId,
        templateId,
        organizationId: orgId,
        userId,
      })
      const [row] = await db
        .select({ assigneeUserId: tasks.assigneeUserId, assigneeRole: tasks.assigneeRole })
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
      expect(row?.assigneeUserId).toBeNull()
      // The role string is preserved so a user can resolve it later.
      expect(row?.assigneeRole).toBe("Editor")
    })
  })

  it("produces null due_dates when project has null primary_date (no crash)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const projectId = await seedProject(db, orgId, userId, null)
      const templateId = await seedTemplate(db, orgId, userId, [
        { stageName: "S", title: "Task A", relativeOffsetDays: -10 },
        { stageName: "S", title: "Task B", relativeOffsetDays: 5 },
      ])
      await instantiateProjectFromTemplate(db, {
        projectId,
        templateId,
        organizationId: orgId,
        userId,
      })
      const rows = await db
        .select({ dueDate: tasks.dueDate })
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
      expect(rows.every((r) => r.dueDate === null)).toBe(true)
    })
  })

  it("copies checklist items from the template into task_checklist_items", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const projectId = await seedProject(db, orgId, userId, "2026-06-15")
      const templateId = await seedTemplate(db, orgId, userId, [
        {
          stageName: "Pre-shoot",
          title: "Send welcome packet",
          relativeOffsetDays: -90,
          checklistItems: [{ label: "Draft email" }, { label: "Attach PDF" }, { label: "Send" }],
        },
      ])
      await instantiateProjectFromTemplate(db, {
        projectId,
        templateId,
        organizationId: orgId,
        userId,
      })
      const [taskRow] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
      const checklistRows = await db
        .select({ label: taskChecklistItems.label, order: taskChecklistItems.order })
        .from(taskChecklistItems)
        .where(eq(taskChecklistItems.taskId, taskRow!.id))
        .orderBy(taskChecklistItems.order)
      expect(checklistRows.map((r) => r.label)).toEqual(["Draft email", "Attach PDF", "Send"])
    })
  })

  it("rejects re-instantiation on a project that already has templated tasks", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const projectId = await seedProject(db, orgId, userId, "2026-06-15")
      const templateId = await seedTemplate(db, orgId, userId, [
        { stageName: "S", title: "T1", relativeOffsetDays: -10 },
      ])
      await instantiateProjectFromTemplate(db, {
        projectId,
        templateId,
        organizationId: orgId,
        userId,
      })
      // Second call should throw — no double-instantiation.
      await expect(
        instantiateProjectFromTemplate(db, {
          projectId,
          templateId,
          organizationId: orgId,
          userId,
        }),
      ).rejects.toThrow(/already.*instantiated|template.*already/i)

      // And only one set of tasks exists.
      const templated = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), isNotNull(tasks.createdFromTemplateItemId)))
      expect(templated.length).toBe(1)
    })
  })
})
