import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { pipelines, pipelineStages } from "./schema"

interface ListOptions {
  withDeleted?: boolean
}

export async function listPipelinesForOrg(opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(pipelines)
      .where(opts.withDeleted ? undefined : isNull(pipelines.deletedAt))
      .orderBy(pipelines.displayOrder, pipelines.name)
  })
}

export async function listPipelinesByType(type: string, opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    const where = opts.withDeleted
      ? eq(pipelines.type, type)
      : and(eq(pipelines.type, type), isNull(pipelines.deletedAt))
    return tx.select().from(pipelines).where(where).orderBy(pipelines.displayOrder)
  })
}

/**
 * Single pipeline + its stages, ordered. Used by the kanban view to
 * render one board in one round-trip. Stages are filtered by
 * `deletedAt IS NULL` regardless of the pipeline's deletion state —
 * `withDeleted: true` returns the pipeline even if soft-deleted but
 * still only its live stages (calling code can re-query stages with
 * its own opts if it needs tombstones).
 */
export async function getPipelineForOrg(id: string, opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    const pipelineWhere = opts.withDeleted
      ? eq(pipelines.id, id)
      : and(eq(pipelines.id, id), isNull(pipelines.deletedAt))
    const [pipelineRow] = await tx.select().from(pipelines).where(pipelineWhere).limit(1)
    if (!pipelineRow) return null
    const stages = await tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.pipelineId, pipelineRow.id), isNull(pipelineStages.deletedAt)))
      .orderBy(pipelineStages.order, pipelineStages.name)
    return { pipeline: pipelineRow, stages }
  })
}

export async function listStagesForPipeline(pipelineId: string, opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(pipelineStages)
      .where(
        opts.withDeleted
          ? eq(pipelineStages.pipelineId, pipelineId)
          : and(eq(pipelineStages.pipelineId, pipelineId), isNull(pipelineStages.deletedAt)),
      )
      .orderBy(pipelineStages.order, pipelineStages.name)
  })
}

export async function getPipelineStageForOrg(id: string) {
  return withOrgContext(async (tx) => {
    const [row] = await tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.id, id), isNull(pipelineStages.deletedAt)))
      .limit(1)
    return row ?? null
  })
}
