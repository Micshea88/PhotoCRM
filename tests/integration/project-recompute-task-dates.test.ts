/**
 * Integration tests for recomputeProjectTaskDueDates — the date-shift
 * pass that runs after a project's primary_date changes. Per Tech Arch §4.
 *
 * Critical assertion (silent-corruption mode B): overridden tasks must
 * be UNCHANGED. The test verifies updated_at didn't move — proves the
 * row was not touched at all.
 */
import { describe, it, expect } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { projects } from "@/modules/projects/schema"
import { tasks } from "@/modules/tasks/schema"
import { projectTemplates, projectTemplateTaskItems } from "@/modules/project-templates/schema"
import { recomputeProjectTaskDueDates } from "@/modules/projects/instantiation"

async function setup(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  primaryDate: string | null,
) {
  const userId = await createUser(db)
  const orgId = await createOrganization(db, userId)
  await setOrgContext(db, orgId)
  const projectId = createId()
  await db.insert(projects).values({
    id: projectId,
    organizationId: orgId,
    name: "P",
    primaryDate,
    createdBy: userId,
    updatedBy: userId,
  })
  const templateId = createId()
  await db.insert(projectTemplates).values({
    id: templateId,
    organizationId: orgId,
    name: "T",
    projectType: "Wedding",
    createdBy: userId,
    updatedBy: userId,
  })
  return { userId, orgId, projectId, templateId }
}

async function seedTemplatedTask(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  args: {
    orgId: string
    projectId: string
    templateId: string
    userId: string
    title: string
    offsetDays: number
    initialDueDate: string | null
    overridden: boolean
  },
) {
  const templateItemId = createId()
  await db.insert(projectTemplateTaskItems).values({
    id: templateItemId,
    organizationId: args.orgId,
    projectTemplateId: args.templateId,
    stageName: "S",
    title: args.title,
    relativeOffsetDays: args.offsetDays,
    createdBy: args.userId,
    updatedBy: args.userId,
  })
  const taskId = createId()
  await db.insert(tasks).values({
    id: taskId,
    organizationId: args.orgId,
    projectId: args.projectId,
    title: args.title,
    dueDate: args.initialDueDate,
    createdFromTemplateItemId: templateItemId,
    dueDateOverridden: args.overridden,
    createdBy: args.userId,
    updatedBy: args.userId,
  })
  return { taskId, templateItemId }
}

describe("recomputeProjectTaskDueDates", () => {
  it("shifts non-overridden tasks when primary_date changes", async () => {
    await withTestDb(async (db) => {
      const env = await setup(db, "2026-06-15")
      const { taskId } = await seedTemplatedTask(db, {
        ...env,
        title: "Task A",
        offsetDays: -10,
        initialDueDate: "2026-06-05",
        overridden: false,
      })
      // User changes primary_date.
      await db
        .update(projects)
        .set({ primaryDate: "2026-07-01" })
        .where(eq(projects.id, env.projectId))

      const result = await recomputeProjectTaskDueDates(db, env.projectId)
      expect(result.tasksUpdated).toBe(1)

      const [row] = await db
        .select({ dueDate: tasks.dueDate })
        .from(tasks)
        .where(eq(tasks.id, taskId))
      expect(row?.dueDate).toBe("2026-06-21") // 2026-07-01 - 10
    })
  })

  it("leaves OVERRIDDEN tasks completely untouched (updated_at unchanged)", async () => {
    await withTestDb(async (db) => {
      const env = await setup(db, "2026-06-15")
      const { taskId } = await seedTemplatedTask(db, {
        ...env,
        title: "Manually overridden",
        offsetDays: -7,
        initialDueDate: "2026-06-08", // user-edited; differs from -7 offset
        overridden: true,
      })
      const [before] = await db
        .select({ updatedAt: tasks.updatedAt, dueDate: tasks.dueDate })
        .from(tasks)
        .where(eq(tasks.id, taskId))

      // Move primary_date — would push due to 2026-06-23 if not protected.
      await db
        .update(projects)
        .set({ primaryDate: "2026-06-30" })
        .where(eq(projects.id, env.projectId))

      const result = await recomputeProjectTaskDueDates(db, env.projectId)
      expect(result.tasksUpdated).toBe(0)
      expect(result.tasksSkippedOverridden).toBe(1)

      const [after] = await db
        .select({ updatedAt: tasks.updatedAt, dueDate: tasks.dueDate })
        .from(tasks)
        .where(eq(tasks.id, taskId))
      expect(after?.dueDate).toBe(before?.dueDate)
      // The killer assertion — updated_at proves no UPDATE ran.
      expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime())
    })
  })

  it("skips tasks not linked to a template item (manual tasks)", async () => {
    await withTestDb(async (db) => {
      const env = await setup(db, "2026-06-15")
      // Manual task — no createdFromTemplateItemId.
      const taskId = createId()
      await db.insert(tasks).values({
        id: taskId,
        organizationId: env.orgId,
        projectId: env.projectId,
        title: "Manual task",
        dueDate: "2026-06-20",
        createdBy: env.userId,
        updatedBy: env.userId,
      })
      await db
        .update(projects)
        .set({ primaryDate: "2026-07-15" })
        .where(eq(projects.id, env.projectId))
      const result = await recomputeProjectTaskDueDates(db, env.projectId)
      expect(result.tasksUpdated).toBe(0)
      const [row] = await db
        .select({ dueDate: tasks.dueDate })
        .from(tasks)
        .where(eq(tasks.id, taskId))
      expect(row?.dueDate).toBe("2026-06-20")
    })
  })

  it("is a no-op when primary_date is null", async () => {
    await withTestDb(async (db) => {
      const env = await setup(db, null)
      await seedTemplatedTask(db, {
        ...env,
        title: "T",
        offsetDays: -10,
        initialDueDate: "2026-06-05",
        overridden: false,
      })
      const result = await recomputeProjectTaskDueDates(db, env.projectId)
      expect(result.tasksUpdated).toBe(0)
    })
  })

  it("skips orphan templated tasks (template item deleted) without crashing", async () => {
    await withTestDb(async (db) => {
      const env = await setup(db, "2026-06-15")
      const ghostItemId = createId()
      // Task points at a template item that doesn't exist (purged or
      // template re-created with new ids).
      const taskId = createId()
      await db.insert(tasks).values({
        id: taskId,
        organizationId: env.orgId,
        projectId: env.projectId,
        title: "Orphan",
        dueDate: "2026-06-10",
        createdFromTemplateItemId: ghostItemId,
        createdBy: env.userId,
        updatedBy: env.userId,
      })
      await db
        .update(projects)
        .set({ primaryDate: "2026-07-15" })
        .where(eq(projects.id, env.projectId))
      const result = await recomputeProjectTaskDueDates(db, env.projectId)
      // No crash; the orphan is reported as skipped.
      expect(result.tasksUpdated).toBe(0)
      expect(result.tasksSkippedOrphan).toBe(1)

      const [row] = await db
        .select({ dueDate: tasks.dueDate })
        .from(tasks)
        .where(eq(tasks.id, taskId))
      expect(row?.dueDate).toBe("2026-06-10") // unchanged
    })
  })

  it("handles a mix of overridden + non-overridden + orphan in one project", async () => {
    await withTestDb(async (db) => {
      const env = await setup(db, "2026-06-15")
      const a = await seedTemplatedTask(db, {
        ...env,
        title: "non-overridden",
        offsetDays: -7,
        initialDueDate: "2026-06-08",
        overridden: false,
      })
      const b = await seedTemplatedTask(db, {
        ...env,
        title: "overridden",
        offsetDays: -10,
        initialDueDate: "2026-06-01",
        overridden: true,
      })
      // Orphan task
      const orphanId = createId()
      await db.insert(tasks).values({
        id: orphanId,
        organizationId: env.orgId,
        projectId: env.projectId,
        title: "orphan",
        dueDate: "2026-06-12",
        createdFromTemplateItemId: createId(), // ghost
        createdBy: env.userId,
        updatedBy: env.userId,
      })
      await db
        .update(projects)
        .set({ primaryDate: "2026-07-15" })
        .where(eq(projects.id, env.projectId))
      const result = await recomputeProjectTaskDueDates(db, env.projectId)
      expect(result.tasksUpdated).toBe(1) // only non-overridden
      expect(result.tasksSkippedOverridden).toBe(1)
      expect(result.tasksSkippedOrphan).toBe(1)

      // Verify each row.
      const [aRow] = await db
        .select({ dueDate: tasks.dueDate })
        .from(tasks)
        .where(eq(tasks.id, a.taskId))
      const [bRow] = await db
        .select({ dueDate: tasks.dueDate })
        .from(tasks)
        .where(eq(tasks.id, b.taskId))
      const [oRow] = await db
        .select({ dueDate: tasks.dueDate })
        .from(tasks)
        .where(eq(tasks.id, orphanId))
      expect(aRow?.dueDate).toBe("2026-07-08") // 2026-07-15 - 7
      expect(bRow?.dueDate).toBe("2026-06-01") // unchanged
      expect(oRow?.dueDate).toBe("2026-06-12") // unchanged
    })
  })
})
