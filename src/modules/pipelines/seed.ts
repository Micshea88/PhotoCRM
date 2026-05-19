import { createId } from "@paralleldrive/cuid2"
import { eq, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { pipelines, pipelineStages } from "./schema"
import type { PipelineType } from "./types"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Five default pipelines per Requirements §6.3 — stage names and order
 * are spec-verbatim. Probabilities are sensible defaults for the
 * pipeline-forecast formula (Requirements §6.15 — Σ opportunity_value
 * × stage probability); the owner can tune them in the Phase 4 config UI.
 *
 * Adding a new default-pipeline-type-or-stage requires:
 *   1. The new type value in `PIPELINE_TYPES` in types.ts.
 *   2. An entry here.
 *   3. (Optional) a migration backfill if existing orgs should get it.
 */
interface DefaultStage {
  name: string
  probability: number | null
}

interface DefaultPipeline {
  type: PipelineType
  name: string
  displayOrder: number
  stages: DefaultStage[]
}

const DEFAULT_PIPELINES: DefaultPipeline[] = [
  {
    type: "sales",
    name: "Sales",
    displayOrder: 0,
    stages: [
      { name: "New Inquiry", probability: 10 },
      { name: "Contacted", probability: 20 },
      { name: "Qualified", probability: 30 },
      { name: "Consultation Scheduled", probability: 50 },
      { name: "Proposal Sent", probability: 60 },
      { name: "Contract Signed", probability: 80 },
      { name: "Retainer Paid / Booked", probability: 100 },
      { name: "Closed Lost", probability: 0 },
    ],
  },
  {
    type: "production",
    name: "Production",
    displayOrder: 1,
    stages: [
      { name: "Booked", probability: null },
      { name: "Photographer Assigned", probability: null },
      { name: "Engagement Shoot", probability: null },
      { name: "Pre-Event Questionnaire Sent", probability: null },
      { name: "Pre-Event Questionnaire Completed", probability: null },
      { name: "Timeline In Progress", probability: null },
      { name: "Timeline Approved", probability: null },
      { name: "Event Prep Finished", probability: null },
      { name: "Event Complete", probability: null },
    ],
  },
  {
    type: "post_production_wedding",
    name: "Wedding/Event Post-Production",
    displayOrder: 2,
    stages: [
      { name: "Files Backed Up", probability: null },
      { name: "Culling", probability: null },
      { name: "Sneaks Selected", probability: null },
      { name: "Sneaks Sent to Editor", probability: null },
      { name: "Sneaks Received", probability: null },
      { name: "Sneaks Delivered", probability: null },
      { name: "Full Cull", probability: null },
      { name: "Full Edit", probability: null },
      { name: "Gallery Uploaded", probability: null },
      { name: "Gallery Delivered", probability: null },
      { name: "Vendor Gallery Delivered", probability: null },
      { name: "Review Requested", probability: null },
      { name: "Project Complete", probability: null },
    ],
  },
  {
    type: "post_production_family",
    name: "Family/Portrait Post-Production",
    displayOrder: 3,
    stages: [
      { name: "Files Backed Up", probability: null },
      { name: "Culling", probability: null },
      { name: "Proofing Edits", probability: null },
      { name: "Proofing Gallery Created", probability: null },
      { name: "Proofing Sent", probability: null },
      { name: "Client Selections Received", probability: null },
      { name: "Finals Edited", probability: null },
      { name: "Gallery Delivered", probability: null },
      { name: "Project Complete", probability: null },
    ],
  },
  {
    type: "album_production",
    name: "Album Production",
    displayOrder: 4,
    stages: [
      { name: "Album Invoice Sent", probability: null },
      { name: "Album Purchased", probability: null },
      { name: "Options Sent", probability: null },
      { name: "Selections Portal Sent", probability: null },
      { name: "Client Selections Completed", probability: null },
      { name: "1st Draft", probability: null },
      { name: "Design Meeting Scheduled", probability: null },
      { name: "Design Meeting Completed", probability: null },
      { name: "Proof Sent", probability: null },
      { name: "Proof Approved", probability: null },
      { name: "Album Ordered", probability: null },
      { name: "Received", probability: null },
      { name: "Shipped", probability: null },
      { name: "Delivered", probability: null },
      { name: "Project Complete", probability: null },
    ],
  },
]

/**
 * Idempotent seed for the V1 photographer pipeline pack. Inserts each
 * pipeline via onConflictDoNothing on (organization_id, name), then
 * stages via onConflictDoNothing on (pipeline_id, name). Re-runs are
 * no-ops.
 *
 * Bootstrap-trust: same pattern as terminology + rbac. The caller (the
 * Better Auth org-create hook OR the dev seed script) MUST have
 * `app.current_org` set to `orgId` before invoking — RLS WITH CHECK on
 * pipelines and pipeline_stages requires it. Safe because both callers
 * are server-side trusted code paths.
 */
export async function seedDefaultPipelines(db: DbHandle, orgId: string) {
  // The unique indexes on both tables are PARTIAL (WHERE deleted_at IS NULL)
  // so onConflict needs the same WHERE clause to match the index. Without
  // it Postgres reports "no unique or exclusion constraint matching the ON
  // CONFLICT specification."
  const pipelinesArbiterWhere = sql`${pipelines.deletedAt} IS NULL`
  const stagesArbiterWhere = sql`${pipelineStages.deletedAt} IS NULL`

  for (const pack of DEFAULT_PIPELINES) {
    const pipelineId = createId()
    await db
      .insert(pipelines)
      .values({
        id: pipelineId,
        organizationId: orgId,
        name: pack.name,
        type: pack.type,
        displayOrder: pack.displayOrder,
      })
      .onConflictDoNothing({
        target: [pipelines.organizationId, pipelines.name],
        where: pipelinesArbiterWhere,
      })

    // Resolve the actual id (onConflictDoNothing may have skipped our insert
    // if a prior seed ran). Look up by id first; fall back to lookup by name.
    const [pipelineRow] = await db
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(eq(pipelines.id, pipelineId))
      .limit(1)
    const actualPipelineId =
      pipelineRow?.id ??
      (
        await db
          .select({ id: pipelines.id })
          .from(pipelines)
          .where(eq(pipelines.name, pack.name))
          .limit(1)
      )[0]?.id
    if (!actualPipelineId) continue

    const stageValues = pack.stages.map((stage, index) => ({
      id: createId(),
      organizationId: orgId,
      pipelineId: actualPipelineId,
      name: stage.name,
      order: index,
      probability: stage.probability,
    }))
    await db
      .insert(pipelineStages)
      .values(stageValues)
      .onConflictDoNothing({
        target: [pipelineStages.pipelineId, pipelineStages.name],
        where: stagesArbiterWhere,
      })
  }
}
