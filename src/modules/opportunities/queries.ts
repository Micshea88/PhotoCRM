import "server-only"
import { and, eq, isNull, sql } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { opportunities } from "./schema"
import { pipelineStages } from "@/modules/pipelines/schema"
import { projects } from "@/modules/projects/schema"

interface ListOptions {
  withDeleted?: boolean
}

export async function listOpportunitiesForOrg(opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(opportunities)
      .where(opts.withDeleted ? undefined : isNull(opportunities.deletedAt))
      .orderBy(opportunities.stageChangedAt)
  })
}

/**
 * Single opportunity + the related project + stage (for display).
 * Three small lookups in parallel — the detail view renders all three
 * sections.
 */
export async function getOpportunityForOrg(id: string, opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    const where = opts.withDeleted
      ? eq(opportunities.id, id)
      : and(eq(opportunities.id, id), isNull(opportunities.deletedAt))
    const [opportunity] = await tx.select().from(opportunities).where(where).limit(1)
    if (!opportunity) return null
    const [projectRow, stageRow] = await Promise.all([
      tx
        .select()
        .from(projects)
        .where(eq(projects.id, opportunity.projectId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      tx
        .select()
        .from(pipelineStages)
        .where(eq(pipelineStages.id, opportunity.stageId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ])
    return { opportunity, project: projectRow, stage: stageRow }
  })
}

export async function listOpportunitiesByProject(projectId: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.projectId, projectId), isNull(opportunities.deletedAt)))
      .orderBy(opportunities.createdAt)
  })
}

/**
 * Kanban-board source: list all opportunities in one pipeline ordered
 * by stage and stage_changed_at. The kanban renderer groups by stage_id
 * client-side.
 */
export async function listOpportunitiesByPipeline(pipelineId: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.pipelineId, pipelineId), isNull(opportunities.deletedAt)))
      .orderBy(opportunities.stageId, opportunities.stageChangedAt)
  })
}

export async function listOpportunitiesByStage(stageId: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.stageId, stageId), isNull(opportunities.deletedAt)))
      .orderBy(opportunities.stageChangedAt)
  })
}

export async function listOpportunitiesByOwner(ownerUserId: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.ownerUserId, ownerUserId), isNull(opportunities.deletedAt)))
      .orderBy(opportunities.expectedCloseDate)
  })
}

/**
 * Forecast source: list open opportunities + their stage's default
 * probability_bps. Caller computes SUM(value_cents × probability_bps /
 * 10000) per pipeline. Per Requirements §6.15 — "Pipeline forecast (sum
 * of opportunities × stage probability)."
 *
 * Returns the opportunity row plus the stage's probability (if the
 * opportunity overrode it, the opp's probability_bps is also returned —
 * caller decides which to use; typical: prefer opportunity override,
 * fall back to stage).
 */
/**
 * Dashboard widget — count of opportunities in the open stage (i.e.,
 * not yet won or lost, not soft-deleted). RLS-scoped via withOrgContext;
 * one studio's count never sees another studio's rows. Lands as part of
 * P4-queries ahead of the P4.1 dashboard.
 */
export async function countOpenOpportunities(): Promise<number> {
  return withOrgContext(async (tx) => {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(opportunities)
      .where(and(eq(opportunities.status, "open"), isNull(opportunities.deletedAt)))
    return row?.count ?? 0
  })
}

export async function listOpenOpportunitiesWithStage() {
  return withOrgContext(async (tx) => {
    return tx
      .select({
        opportunity: opportunities,
        stageProbabilityBps: pipelineStages.probability,
        stageName: pipelineStages.name,
      })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(opportunities.stageId, pipelineStages.id))
      .where(and(eq(opportunities.status, "open"), isNull(opportunities.deletedAt)))
  })
}
