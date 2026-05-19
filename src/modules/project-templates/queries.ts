import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { projectTemplates, projectTemplateTaskItems } from "./schema"

interface ListOptions {
  withDeleted?: boolean
}

export async function listProjectTemplatesForOrg(opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(projectTemplates)
      .where(opts.withDeleted ? undefined : isNull(projectTemplates.deletedAt))
      .orderBy(projectTemplates.projectType, projectTemplates.name)
  })
}

export async function listProjectTemplatesByType(projectType: string, opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    const where = opts.withDeleted
      ? eq(projectTemplates.projectType, projectType)
      : and(eq(projectTemplates.projectType, projectType), isNull(projectTemplates.deletedAt))
    return tx.select().from(projectTemplates).where(where).orderBy(projectTemplates.name)
  })
}

/**
 * Single template + its task items, ordered. The future instantiation
 * engine reads this shape: it walks `taskItems` in order, creates a
 * `tasks` row per item, resolves `assigneeRole` to a user, and creates
 * `task_dependencies` rows from `blockedByTemplateItemId` references.
 */
export async function getProjectTemplateWithItems(id: string, opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    const where = opts.withDeleted
      ? eq(projectTemplates.id, id)
      : and(eq(projectTemplates.id, id), isNull(projectTemplates.deletedAt))
    const [template] = await tx.select().from(projectTemplates).where(where).limit(1)
    if (!template) return null
    const taskItems = await tx
      .select()
      .from(projectTemplateTaskItems)
      .where(eq(projectTemplateTaskItems.projectTemplateId, id))
      .orderBy(projectTemplateTaskItems.order)
    return { template, taskItems }
  })
}

export async function listTemplateTaskItems(projectTemplateId: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(projectTemplateTaskItems)
      .where(eq(projectTemplateTaskItems.projectTemplateId, projectTemplateId))
      .orderBy(projectTemplateTaskItems.order)
  })
}
