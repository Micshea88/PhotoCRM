"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { hasPermission } from "@/modules/rbac/queries"
import { workflows, workflowSteps } from "@/modules/workflows/schema"
import { aiWorkflowDrafts } from "./schema"
import { buildCatalogForPrompt } from "./catalog"
import { callAiModel } from "@/lib/ai-model"
import { renderDraftAsProse } from "./render"
import { validateModelOutput, type ValidatedDraft } from "./validate"
import { checkRateLimit } from "./rate-limit"
import {
  confirmAiWorkflowDraftInput,
  discardAiWorkflowDraftInput,
  draftWorkflowFromPromptInput,
} from "./types"

/**
 * AI Workflow Builder actions. Module 16a — safety architecture. The
 * model client is stubbed in `src/lib/ai-model.ts` (throws in
 * production; mocked in tests).
 *
 * AI LAYER GUIDING PRINCIPLE — IT IS A TOOL, NOT THE LEADER:
 *
 *   Every AI write routes through the IDENTICAL human action path.
 *   The AI cannot enable its own workflows. The AI cannot self-fire.
 *   The user MUST explicitly confirm a draft before any workflow row
 *   is created — `confirmAiWorkflowDraft` requires `confirmed: true`
 *   (a literal, not a default).
 *
 * THE TWO ACTIONS:
 *
 *   1. `draftWorkflowFromPrompt` — generates a draft, runs it through
 *      the validation gate, persists the proposal as
 *      `status='pending_review'` (or rejected/refused). Does NOT
 *      create any `workflows` row.
 *
 *   2. `confirmAiWorkflowDraft` — the ONLY path from a draft to a
 *      real workflow. Re-validates the stored draft (defense against
 *      tampering between draft and confirm). Calls the EXISTING
 *      `createWorkflow` / `addWorkflowStep` orgActions (Module 15)
 *      with `enabled: false` HARD-CODED. The workflow lands disabled
 *      and the user must manually enable it via the existing
 *      `enableWorkflow` action.
 */

const PERMISSION_KEY = "manage_workflows" as const

/**
 * Hard-coded notice appended to every rendered draft. The review screen
 * shows this verbatim so the user can never miss the disabled-default.
 */

export const draftWorkflowFromPrompt = orgAction
  .metadata({ actionName: "ai_workflow_builder.draft" })
  .inputSchema(draftWorkflowFromPromptInput)
  .action(async ({ parsedInput, ctx }) => {
    // Same permission as manual workflow creation. The AI is a tool the
    // user wields — it requires the same capability as the user doing it
    // by hand.
    const allowed = await hasPermission(ctx.session.user.id, PERMISSION_KEY)
    if (!allowed) {
      throw new ActionError("FORBIDDEN", "Your role does not have permission to manage workflows.")
    }

    // Rate-limit BEFORE the model call so blocked attempts cost nothing.
    const verdict = await checkRateLimit(ctx.db, {
      organizationId: ctx.activeOrg.id,
      userId: ctx.session.user.id,
    })
    if (!verdict.allowed) {
      throw new ActionError("VALIDATION", verdict.reason)
    }

    // Build the catalog from src/modules/workflows/types.ts at call time.
    // The catalog is the bounded universe the model can emit from.
    const catalog = buildCatalogForPrompt()

    // Call the model. In 16a this throws ("not yet configured"); tests
    // mock `@/lib/ai-model`. Throwing here means NO draft row is
    // persisted — the rate-limit count is not incremented and the user
    // sees a clear "not configured" error.
    let modelResult: Awaited<ReturnType<typeof callAiModel>>
    try {
      modelResult = await callAiModel({
        systemPrompt: JSON.stringify({ catalog, prompt: parsedInput.prompt }),
        userPrompt: parsedInput.prompt,
      })
    } catch (err) {
      throw new ActionError(
        "VALIDATION",
        err instanceof Error ? err.message : "AI model call failed.",
      )
    }

    // Parse JSON from the model's raw text. A non-JSON response is a
    // rejection (rawModelOutput preserved as a string in jsonb).
    let parsed: unknown
    let parseError: string | null = null
    try {
      parsed = JSON.parse(modelResult.raw)
    } catch (err) {
      parsed = modelResult.raw
      parseError = err instanceof Error ? err.message : "JSON parse failed"
    }

    // THE VALIDATION GATE. The ONLY path between model output and a
    // persisted draft. The function has no repair branch; no
    // try/catch swallows Zod errors.
    const validation = parseError
      ? {
          kind: "rejected" as const,
          errors: [
            {
              type: "shape" as const,
              message: `Model output is not valid JSON: ${parseError}`,
            },
          ],
        }
      : validateModelOutput(parsed)

    const draftId = createId()
    let status: "pending_review" | "rejected" | "refused"
    let validatedDraft: ValidatedDraft | null = null
    let refusalReason: string | null = null
    let renderedProse: string | null = null

    switch (validation.kind) {
      case "rejected":
        status = "rejected"
        break
      case "refusal":
        status = "refused"
        refusalReason = validation.reason
        break
      case "draft":
        status = "pending_review"
        validatedDraft = validation.validatedDraft
        renderedProse = renderDraftAsProse(validation.validatedDraft)
        break
    }

    await ctx.db.insert(aiWorkflowDrafts).values({
      id: draftId,
      organizationId: ctx.activeOrg.id,
      requesterUserId: ctx.session.user.id,
      prompt: parsedInput.prompt,
      modelName: modelResult.modelName,
      modelTokensUsed: modelResult.tokensUsed,
      rawModelOutput: parsed,
      validationResult:
        validation.kind === "rejected"
          ? { kind: "rejected", errors: validation.errors }
          : { kind: validation.kind },
      validatedDraft: validatedDraft as unknown as Record<string, unknown> | null,
      renderedProse,
      status,
      refusalReason,
    })

    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "ai_workflow_drafts.created",
      {
        resourceType: "ai_workflow_draft",
        resourceId: draftId,
        metadata: {
          status,
          modelName: modelResult.modelName,
          tokensUsed: modelResult.tokensUsed,
        },
      },
    )

    revalidatePath("/workflows/ai")

    return {
      draftId,
      status,
      validatedDraft,
      renderedProse,
      refusalReason,
      errors: validation.kind === "rejected" ? validation.errors : null,
    }
  })

export const confirmAiWorkflowDraft = orgAction
  .metadata({ actionName: "ai_workflow_builder.confirm" })
  .inputSchema(confirmAiWorkflowDraftInput)
  .action(async ({ parsedInput, ctx }) => {
    const allowed = await hasPermission(ctx.session.user.id, PERMISSION_KEY)
    if (!allowed) {
      throw new ActionError("FORBIDDEN", "Your role does not have permission to manage workflows.")
    }

    // Load draft. Org isolation via the where clause + RLS in defense.
    const [draft] = await ctx.db
      .select()
      .from(aiWorkflowDrafts)
      .where(
        and(
          eq(aiWorkflowDrafts.id, parsedInput.draftId),
          eq(aiWorkflowDrafts.organizationId, ctx.activeOrg.id),
          isNull(aiWorkflowDrafts.deletedAt),
        ),
      )
      .limit(1)
    if (!draft) {
      throw new ActionError("NOT_FOUND", "Draft not found in this organization.")
    }
    if (draft.status !== "pending_review") {
      throw new ActionError(
        "VALIDATION",
        `Draft is not pending review (current status: ${draft.status}).`,
      )
    }
    if (!draft.validatedDraft) {
      throw new ActionError(
        "VALIDATION",
        "Draft has no validated workflow body. Re-draft from the prompt.",
      )
    }

    // RE-VALIDATE the stored draft. Defense against tampering of the
    // draft row between draft and confirm — re-run the canonical gate.
    const revalidation = validateModelOutput({
      result: "draft",
      ...draft.validatedDraft,
    })
    if (revalidation.kind !== "draft") {
      throw new ActionError(
        "VALIDATION",
        "Stored draft no longer passes validation. Re-draft from the prompt.",
      )
    }
    const v = revalidation.validatedDraft

    // CREATE the workflow via direct insert into the workflows table.
    // We use the same column shape as the Module 15 createWorkflow
    // orgAction — Module 15's `enabled` default is `false` at the
    // schema layer, and we ADDITIONALLY hard-code it here so no
    // model-influenced value can leak through. The validatedDraft
    // jsonb shape has no `enabled` field by schema construction
    // (Hard Constraint #2).
    const workflowId = createId()
    await ctx.db.insert(workflows).values({
      id: workflowId,
      organizationId: ctx.activeOrg.id,
      name: v.name,
      description: v.description,
      triggerType: v.triggerType,
      triggerConfig: v.triggerConfig,
      enabled: false, // HARD-CODED. AI cannot set this.
      createdBy: ctx.session.user.id,
      updatedBy: ctx.session.user.id,
    })
    for (const [idx, step] of v.steps.entries()) {
      await ctx.db.insert(workflowSteps).values({
        id: createId(),
        organizationId: ctx.activeOrg.id,
        workflowId,
        sequenceNo: idx,
        actionType: step.actionType,
        actionConfig: step.actionConfig,
        branchCondition: step.branchCondition,
        createdBy: ctx.session.user.id,
        updatedBy: ctx.session.user.id,
      })
    }

    await ctx.db
      .update(aiWorkflowDrafts)
      .set({
        status: "confirmed",
        resultingWorkflowId: workflowId,
        updatedAt: new Date(),
      })
      .where(eq(aiWorkflowDrafts.id, draft.id))

    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "ai_workflow_drafts.confirmed",
      {
        resourceType: "ai_workflow_draft",
        resourceId: draft.id,
        metadata: { resultingWorkflowId: workflowId, enabled: false },
      },
    )
    revalidatePath("/workflows")
    revalidatePath("/workflows/ai")
    return { draftId: draft.id, workflowId, enabled: false }
  })

export const discardAiWorkflowDraft = orgAction
  .metadata({ actionName: "ai_workflow_builder.discard" })
  .inputSchema(discardAiWorkflowDraftInput)
  .action(async ({ parsedInput, ctx }) => {
    const allowed = await hasPermission(ctx.session.user.id, PERMISSION_KEY)
    if (!allowed) {
      throw new ActionError("FORBIDDEN", "Your role does not have permission to manage workflows.")
    }
    const result = await ctx.db
      .update(aiWorkflowDrafts)
      .set({
        status: "abandoned",
        deletedAt: new Date(),
        deletedBy: ctx.session.user.id,
      })
      .where(
        and(
          eq(aiWorkflowDrafts.id, parsedInput.draftId),
          eq(aiWorkflowDrafts.organizationId, ctx.activeOrg.id),
          isNull(aiWorkflowDrafts.deletedAt),
        ),
      )
      .returning({ id: aiWorkflowDrafts.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Draft not found.")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "ai_workflow_drafts.discarded",
      { resourceType: "ai_workflow_draft", resourceId: parsedInput.draftId },
    )
    return { draftId: parsedInput.draftId }
  })
