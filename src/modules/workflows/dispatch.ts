import "server-only"
import { and, eq, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import type * as schema from "@/db/schema"
import { ActionError } from "@/lib/safe-action"
import { sendEmail } from "@/lib/email"
import { studioFromHeader } from "@/lib/email/provider"
import { audit } from "@/modules/audit/audit"
import { organization } from "@/modules/auth/schema"
import { contacts } from "@/modules/contacts/schema"
import { projects } from "@/modules/projects/schema"
import { opportunities } from "@/modules/opportunities/schema"
import { tasks } from "@/modules/tasks/schema"
import { NATIVE_ACTION_TYPES, STUB_ACTION_TYPES, type ActionType } from "./types"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Per Module 15 plan + docs/INTEGRATION_STRATEGY.md (locked):
 *   Native handlers delegate to ALREADY-BUILT modules or to
 *   `src/lib/email.ts`. NO new external service. Stub handlers throw
 *   ActionError so the executor can record `deferred` status — never
 *   silently no-op.
 *
 * The executor calls these from system context under the NOBYPASSRLS
 * app_authenticated role: app.current_org is set to workflow.organizationId,
 * app.current_role='admin', and app.current_view_all_events='true' (the
 * contacts/projects/tasks overlay keys write access off view_all_events, not
 * the role string) so the underlying writes pass RLS WITH CHECK. Each update
 * ALSO carries an explicit organizationId filter as defense-in-depth. Audit
 * rows are written with `actorUserId: null` (system actor).
 */

export interface DispatchContext {
  db: DbHandle
  organizationId: string
  workflowId: string
  executionId: string
  /** The step's sequence number — part of the per-step idempotency key so a
   *  queue reaper re-running the execution after a crash re-issues each step's
   *  external effect under a stable key (provider dedups → one effect). */
  sequenceNo: number
  triggerPayload: Record<string, unknown> | null
}

export const STUB_ACTION_SET = new Set<string>(STUB_ACTION_TYPES)
export const NATIVE_ACTION_SET = new Set<string>(NATIVE_ACTION_TYPES)

/**
 * Dispatch a single workflow step. Returns void on success;
 * throws ActionError("VALIDATION", "<action> is deferred …") for stubs.
 */
export async function dispatchAction(
  ctx: DispatchContext,
  actionType: ActionType,
  actionConfig: Record<string, unknown> | null,
): Promise<void> {
  if (STUB_ACTION_SET.has(actionType)) {
    throw new ActionError("VALIDATION", deferralMessageFor(actionType))
  }

  switch (actionType) {
    case "send_email":
      await handleSendEmail(ctx, actionConfig)
      return
    case "create_task":
      await handleCreateTask(ctx, actionConfig)
      return
    case "update_field":
      await handleUpdateField(ctx, actionConfig)
      return
    case "change_pipeline_stage":
      await handleChangePipelineStage(ctx, actionConfig)
      return
    case "add_tag":
    case "remove_tag":
      await handleTag(ctx, actionType, actionConfig)
      return
    case "assign_owner":
      await handleAssignOwner(ctx, actionConfig)
      return
    case "mark_won":
      await handleMarkWonLost(ctx, actionConfig, "won")
      return
    case "mark_lost":
      await handleMarkWonLost(ctx, actionConfig, "lost")
      return
    case "create_note":
      await handleCreateNote(ctx, actionConfig)
      return
    case "wait":
    case "if_else":
    case "end_workflow":
      // These are executor-level controls, not real DB actions. The
      // executor handles them directly without calling dispatchAction.
      // Reaching here means a wiring bug.
      throw new ActionError(
        "VALIDATION",
        `${actionType} is an executor control, not a dispatchable action`,
      )
    default:
      // Stub types are checked at the top via STUB_ACTION_SET; reaching
      // here would mean a new action was added without a handler.
      throw new ActionError("VALIDATION", `Unknown action type: ${actionType as string}`)
  }
}

function deferralMessageFor(actionType: ActionType): string {
  switch (actionType) {
    case "send_invoice":
    case "take_payment":
      return `${actionType} is deferred until Stripe Connect is unlocked. Configure this step or remove it to run the workflow.`
    case "send_sms":
      return "send_sms is deferred until the SMS provider is configured."
    case "send_smart_document":
    case "send_smart_doc_for_signature":
      return `${actionType} is deferred until the Smart Documents module ships.`
    case "send_questionnaire":
      return "send_questionnaire is deferred until the questionnaires module ships."
    case "send_webhook":
      return "send_webhook is deferred until the outbound-webhook infrastructure ships."
    case "create_calendar_event":
      return "create_calendar_event is deferred until a calendar provider is configured."
    default:
      return `${actionType} is deferred.`
  }
}

// ─── Native handlers ──────────────────────────────────────────────────

async function handleSendEmail(
  ctx: DispatchContext,
  config: Record<string, unknown> | null,
): Promise<void> {
  const to = typeof config?.to === "string" ? config.to : null
  const subject = typeof config?.subject === "string" ? config.subject : null
  const body = typeof config?.body === "string" ? config.body : null
  if (!to || !subject || !body) {
    throw new ActionError("VALIDATION", "send_email requires { to, subject, body }")
  }
  // Item 1: automated email goes from the DRESSED STUDIO address — the studio
  // name over the system address, never a bare system address. Send-as-the-owner
  // is deferred to the Events build (projects have no owner column yet), so no
  // owner is resolved here. A failed send throws → the executor records the step
  // as `failed` (not silently dropped).
  const [orgRow] = await ctx.db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, ctx.organizationId))
    .limit(1)
  await sendEmail({
    to,
    subject,
    html: body,
    from: studioFromHeader(orgRow?.name ?? "your studio"),
    // Stable across retries of THIS step of THIS execution, so a queue reaper
    // re-running the execution after a crash makes Resend dedup the resend.
    idempotencyKey: `wf:${ctx.executionId}:${String(ctx.sequenceNo)}`,
    // Workflow sends are a batch — the bulk lane. It reserves no per-org floor
    // (that's kept for humans clicking Send), and a throttle throws → the
    // executor treats it as transient → the durable queue reschedules with
    // backoff. Keyed to this org's fairness budget.
    orgId: ctx.organizationId,
    lane: "bulk",
  })
  await audit(
    { db: ctx.db, organizationId: ctx.organizationId, actorUserId: null },
    "workflows.action.send_email",
    {
      resourceType: "workflow_execution",
      resourceId: ctx.executionId,
      metadata: { to, subject, workflowId: ctx.workflowId },
    },
  )
}

async function handleCreateTask(
  ctx: DispatchContext,
  config: Record<string, unknown> | null,
): Promise<void> {
  const title = typeof config?.title === "string" ? config.title : null
  const projectId =
    typeof config?.projectId === "string"
      ? config.projectId
      : typeof ctx.triggerPayload?.projectId === "string"
        ? ctx.triggerPayload.projectId
        : null
  if (!title || !projectId) {
    throw new ActionError("VALIDATION", "create_task requires { title, projectId }")
  }
  const taskId = createId()
  await ctx.db.insert(tasks).values({
    id: taskId,
    organizationId: ctx.organizationId,
    projectId,
    title,
    description: typeof config?.description === "string" ? config.description : null,
    priority: typeof config?.priority === "string" ? config.priority : null,
    createdBy: null,
    updatedBy: null,
  })
  await audit(
    { db: ctx.db, organizationId: ctx.organizationId, actorUserId: null },
    "workflows.action.create_task",
    {
      resourceType: "task",
      resourceId: taskId,
      metadata: { workflowId: ctx.workflowId, executionId: ctx.executionId },
    },
  )
}

async function handleUpdateField(
  ctx: DispatchContext,
  config: Record<string, unknown> | null,
): Promise<void> {
  const resourceType = typeof config?.resourceType === "string" ? config.resourceType : null
  const resourceId = typeof config?.resourceId === "string" ? config.resourceId : null
  const fields = (config?.fields ?? {}) as Record<string, unknown>
  if (!resourceType || !resourceId) {
    throw new ActionError(
      "VALIDATION",
      "update_field requires { resourceType, resourceId, fields }",
    )
  }
  switch (resourceType) {
    case "contact":
      await ctx.db
        .update(contacts)
        .set(fields)
        .where(and(eq(contacts.id, resourceId), eq(contacts.organizationId, ctx.organizationId)))
      break
    case "project":
      await ctx.db
        .update(projects)
        .set(fields)
        .where(and(eq(projects.id, resourceId), eq(projects.organizationId, ctx.organizationId)))
      break
    case "opportunity":
      await ctx.db
        .update(opportunities)
        .set(fields)
        .where(
          and(
            eq(opportunities.id, resourceId),
            eq(opportunities.organizationId, ctx.organizationId),
          ),
        )
      break
    case "task":
      await ctx.db
        .update(tasks)
        .set(fields)
        .where(and(eq(tasks.id, resourceId), eq(tasks.organizationId, ctx.organizationId)))
      break
    default:
      throw new ActionError("VALIDATION", `Unknown resourceType: ${resourceType}`)
  }
  await audit(
    { db: ctx.db, organizationId: ctx.organizationId, actorUserId: null },
    "workflows.action.update_field",
    {
      resourceType,
      resourceId,
      metadata: { fields, workflowId: ctx.workflowId, executionId: ctx.executionId },
    },
  )
}

async function handleChangePipelineStage(
  ctx: DispatchContext,
  config: Record<string, unknown> | null,
): Promise<void> {
  const opportunityId = typeof config?.opportunityId === "string" ? config.opportunityId : null
  const targetStageId = typeof config?.targetStageId === "string" ? config.targetStageId : null
  if (!opportunityId || !targetStageId) {
    throw new ActionError(
      "VALIDATION",
      "change_pipeline_stage requires { opportunityId, targetStageId }",
    )
  }
  await ctx.db
    .update(opportunities)
    .set({ stageId: targetStageId, stageChangedAt: new Date() })
    .where(
      and(
        eq(opportunities.id, opportunityId),
        eq(opportunities.organizationId, ctx.organizationId),
      ),
    )
  await audit(
    { db: ctx.db, organizationId: ctx.organizationId, actorUserId: null },
    "workflows.action.change_pipeline_stage",
    {
      resourceType: "opportunity",
      resourceId: opportunityId,
      metadata: { targetStageId, workflowId: ctx.workflowId, executionId: ctx.executionId },
    },
  )
}

async function handleTag(
  ctx: DispatchContext,
  actionType: "add_tag" | "remove_tag",
  config: Record<string, unknown> | null,
): Promise<void> {
  const contactId = typeof config?.contactId === "string" ? config.contactId : null
  const tag = typeof config?.tag === "string" ? config.tag : null
  if (!contactId || !tag) {
    throw new ActionError("VALIDATION", `${actionType} requires { contactId, tag }`)
  }
  // tags is text[] — use array_append / array_remove via raw SQL fragment.
  if (actionType === "add_tag") {
    await ctx.db
      .update(contacts)
      .set({
        tags: sql`array(SELECT DISTINCT unnest(coalesce(${contacts.tags}, ARRAY[]::text[]) || ${[tag]}::text[]))`,
      })
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, ctx.organizationId)))
  } else {
    await ctx.db
      .update(contacts)
      .set({
        tags: sql`array_remove(${contacts.tags}, ${tag})`,
      })
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, ctx.organizationId)))
  }
  await audit(
    { db: ctx.db, organizationId: ctx.organizationId, actorUserId: null },
    `workflows.action.${actionType}`,
    { resourceType: "contact", resourceId: contactId, metadata: { tag } },
  )
}

async function handleAssignOwner(
  ctx: DispatchContext,
  config: Record<string, unknown> | null,
): Promise<void> {
  const resourceType = typeof config?.resourceType === "string" ? config.resourceType : null
  const resourceId = typeof config?.resourceId === "string" ? config.resourceId : null
  const ownerUserId = typeof config?.ownerUserId === "string" ? config.ownerUserId : null
  if (!resourceType || !resourceId || !ownerUserId) {
    throw new ActionError(
      "VALIDATION",
      "assign_owner requires { resourceType, resourceId, ownerUserId }",
    )
  }
  switch (resourceType) {
    case "contact":
      await ctx.db
        .update(contacts)
        .set({ ownerUserId })
        .where(and(eq(contacts.id, resourceId), eq(contacts.organizationId, ctx.organizationId)))
      break
    case "opportunity":
      await ctx.db
        .update(opportunities)
        .set({ ownerUserId })
        .where(
          and(
            eq(opportunities.id, resourceId),
            eq(opportunities.organizationId, ctx.organizationId),
          ),
        )
      break
    case "project":
      // Projects don't have an owner_user_id column; use referredByContactId
      // is wrong — flag as VALIDATION error so the user knows.
      throw new ActionError(
        "VALIDATION",
        "assign_owner is not supported on project (no owner_user_id column).",
      )
    default:
      throw new ActionError("VALIDATION", `Unknown resourceType: ${resourceType}`)
  }
  await audit(
    { db: ctx.db, organizationId: ctx.organizationId, actorUserId: null },
    "workflows.action.assign_owner",
    { resourceType, resourceId, metadata: { ownerUserId } },
  )
}

async function handleMarkWonLost(
  ctx: DispatchContext,
  config: Record<string, unknown> | null,
  outcome: "won" | "lost",
): Promise<void> {
  const opportunityId = typeof config?.opportunityId === "string" ? config.opportunityId : null
  const lostReason = typeof config?.lostReason === "string" ? config.lostReason : null
  if (!opportunityId) {
    throw new ActionError("VALIDATION", `mark_${outcome} requires { opportunityId }`)
  }
  await ctx.db
    .update(opportunities)
    .set({
      status: outcome,
      stageChangedAt: new Date(),
      lostReason: outcome === "lost" ? lostReason : null,
    })
    .where(
      and(
        eq(opportunities.id, opportunityId),
        eq(opportunities.organizationId, ctx.organizationId),
      ),
    )
  await audit(
    { db: ctx.db, organizationId: ctx.organizationId, actorUserId: null },
    `workflows.action.mark_${outcome}`,
    {
      resourceType: "opportunity",
      resourceId: opportunityId,
      metadata: { lostReason, workflowId: ctx.workflowId },
    },
  )
}

async function handleCreateNote(
  ctx: DispatchContext,
  config: Record<string, unknown> | null,
): Promise<void> {
  const resourceType = typeof config?.resourceType === "string" ? config.resourceType : null
  const resourceId = typeof config?.resourceId === "string" ? config.resourceId : null
  const note = typeof config?.note === "string" ? config.note : null
  if (!resourceType || !resourceId || !note) {
    throw new ActionError("VALIDATION", "create_note requires { resourceType, resourceId, note }")
  }
  // Append to the resource's `notes` text column. V1 design: no
  // separate notes table; the resource's notes column accumulates.
  const stamped = `[${new Date().toISOString()}] ${note}`
  switch (resourceType) {
    case "contact":
      await ctx.db
        .update(contacts)
        .set({
          notes: sql`coalesce(${contacts.notes}, '') || ${"\n\n" + stamped}`,
        })
        .where(and(eq(contacts.id, resourceId), eq(contacts.organizationId, ctx.organizationId)))
      break
    case "project":
      await ctx.db
        .update(projects)
        .set({
          projectNotes: sql`coalesce(${projects.projectNotes}, '') || ${"\n\n" + stamped}`,
        })
        .where(and(eq(projects.id, resourceId), eq(projects.organizationId, ctx.organizationId)))
      break
    default:
      throw new ActionError("VALIDATION", `Unknown resourceType: ${resourceType}`)
  }
  await audit(
    { db: ctx.db, organizationId: ctx.organizationId, actorUserId: null },
    "workflows.action.create_note",
    { resourceType, resourceId, metadata: { length: note.length } },
  )
}
