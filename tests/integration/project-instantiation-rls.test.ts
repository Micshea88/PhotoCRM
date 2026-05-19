/**
 * Cross-org safety tests for instantiateProjectFromTemplate.
 *
 * The action is wrapped in `orgAction`, which sets `app.current_org`
 * transaction-locally and passes `ctx.activeOrg.id` to the function.
 * The function then filters project + template by `organizationId`
 * explicitly. RLS policies enforce the same boundary at the DB layer.
 *
 * These tests prove the boundary holds when:
 *   1. The project belongs to a different org than the active context
 *   2. The template belongs to a different org than the active context
 *   3. The caller passes a tampered `organizationId` arg that doesn't
 *      match `app.current_org` — RLS still blocks the writes
 *
 * Pattern mirrors the *-rls.test.ts files, but uses the app-layer
 * setOrgContext helper (the entry point is a function in app code,
 * not a raw SQL probe).
 */
import { describe, it, expect } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { projects } from "@/modules/projects/schema"
import { projectTemplates, projectTemplateTaskItems } from "@/modules/project-templates/schema"
import { tasks } from "@/modules/tasks/schema"
import { instantiateProjectFromTemplate } from "@/modules/projects/instantiation"

async function seedTwoOrgs(db: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const userA = await createUser(db)
  const userB = await createUser(db)
  const orgA = await createOrganization(db, userA)
  const orgB = await createOrganization(db, userB)
  return { userA, userB, orgA, orgB }
}

async function seedProject(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  orgId: string,
  userId: string,
) {
  const id = createId()
  await db.insert(projects).values({
    id,
    organizationId: orgId,
    name: "P",
    primaryDate: "2026-06-15",
    createdBy: userId,
    updatedBy: userId,
  })
  return id
}

async function seedTemplate(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  orgId: string,
  userId: string,
) {
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
    relativeOffsetDays: -10,
    createdBy: userId,
    updatedBy: userId,
  })
  return templateId
}

describe("instantiateProjectFromTemplate — cross-org safety", () => {
  it("refuses to instantiate when the project belongs to a different org", async () => {
    await withTestDb(async (db) => {
      const { userA, userB, orgA, orgB } = await seedTwoOrgs(db)

      // Seed orgB's project under orgB context (so the WITH CHECK passes).
      await setOrgContext(db, orgB)
      const projectInB = await seedProject(db, orgB, userB)

      // Seed orgA's template under orgA context.
      await setOrgContext(db, orgA)
      const templateInA = await seedTemplate(db, orgA, userA)

      // Now operate as orgA, but try to instantiate orgB's project.
      await expect(
        instantiateProjectFromTemplate(db, {
          projectId: projectInB,
          templateId: templateInA,
          organizationId: orgA,
          userId: userA,
        }),
      ).rejects.toThrow(/project not found/i)

      // And no tasks should have been written.
      const taskRows = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.projectId, projectInB))
      expect(taskRows.length).toBe(0)
    })
  })

  it("refuses to instantiate when the template belongs to a different org", async () => {
    await withTestDb(async (db) => {
      const { userA, userB, orgA, orgB } = await seedTwoOrgs(db)

      await setOrgContext(db, orgA)
      const projectInA = await seedProject(db, orgA, userA)

      await setOrgContext(db, orgB)
      const templateInB = await seedTemplate(db, orgB, userB)

      // Operate as orgA; try to pull in orgB's template.
      await setOrgContext(db, orgA)
      await expect(
        instantiateProjectFromTemplate(db, {
          projectId: projectInA,
          templateId: templateInB,
          organizationId: orgA,
          userId: userA,
        }),
      ).rejects.toThrow(/template not found/i)

      const taskRows = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.projectId, projectInA))
      expect(taskRows.length).toBe(0)
    })
  })

  it("RLS blocks a tampered organizationId arg (mismatched against app.current_org)", async () => {
    // The function takes `organizationId` as a parameter. In real use,
    // orgAction passes `ctx.activeOrg.id`. If a future code path passes
    // a different value than the current RLS context, RLS must catch it.
    await withTestDb(async (db) => {
      const { userA, userB, orgA, orgB } = await seedTwoOrgs(db)

      await setOrgContext(db, orgB)
      const projectInB = await seedProject(db, orgB, userB)
      const templateInB = await seedTemplate(db, orgB, userB)

      // Switch RLS context to orgA, but call the function claiming
      // we're operating in orgB. The function's explicit org filter
      // sees the rows (the WHERE matches orgB), but the SELECT itself
      // is blocked by RLS (app.current_org=orgA), so the lookup
      // returns no rows and the function throws.
      await setOrgContext(db, orgA)
      await expect(
        instantiateProjectFromTemplate(db, {
          projectId: projectInB,
          templateId: templateInB,
          organizationId: orgB, // tampered — doesn't match app.current_org
          userId: userA,
        }),
      ).rejects.toThrow(/project not found/i)
    })
  })
})
