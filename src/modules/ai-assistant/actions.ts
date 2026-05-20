"use server"

import { revalidatePath } from "next/cache"
import { and, desc, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { hasPermission } from "@/modules/rbac/queries"
import { callAiModel } from "@/lib/ai-model"
import { aiAssistantMessages } from "./schema"
import { ASSISTANT_RETRIEVERS } from "./retrievers"
import { findRouteById } from "./route-catalog"
import { buildCatalogForPrompt } from "./catalog"
import { buildPrompt, type ConversationTurn } from "./prompt"
import { validateAssistantOutput, type ValidationError } from "./validate"
import { renderNavigation, renderRetrieverSummary } from "./render"
import { checkRateLimit } from "./rate-limit"
import { assistantTurnInput } from "./types"

const PERMISSION_KEY = "use_ai_assistant" as const

/**
 * Module 17a — `assistantTurn` is the ONLY action. The 17b actions
 * (confirmWriteProposal, rejectWriteProposal) do not exist yet.
 *
 * Per the AI layer guiding principle (AI1, docs/PIVOTS_LEDGER.md):
 * the AI is a tool the human drives, never an autonomous actor. This
 * action runs on a human-initiated request (the user typed a
 * message). It cannot self-fire. It has no cron caller.
 */

export const assistantTurn = orgAction
  .metadata({ actionName: "ai_assistant.turn" })
  .inputSchema(assistantTurnInput)
  .action(async ({ parsedInput, ctx }) => {
    const allowed = await hasPermission(ctx.session.user.id, PERMISSION_KEY)
    if (!allowed) {
      throw new ActionError(
        "FORBIDDEN",
        "Your role does not have permission to use the AI assistant.",
      )
    }

    // Rate-limit BEFORE persisting anything or calling the model.
    const verdict = await checkRateLimit(ctx.db, {
      organizationId: ctx.activeOrg.id,
      userId: ctx.session.user.id,
    })
    if (!verdict.allowed) {
      throw new ActionError("VALIDATION", verdict.reason)
    }

    // Persist the user's message first — even if subsequent steps
    // fail, we have the forensic record of what the user said.
    const userMsgId = createId()
    await ctx.db.insert(aiAssistantMessages).values({
      id: userMsgId,
      organizationId: ctx.activeOrg.id,
      conversationId: parsedInput.conversationId,
      userId: ctx.session.user.id,
      role: "user",
      content: parsedInput.userMessage,
    })

    // Load recent history (last 20 turns).
    const recent = await ctx.db
      .select({
        role: aiAssistantMessages.role,
        content: aiAssistantMessages.content,
        createdAt: aiAssistantMessages.createdAt,
      })
      .from(aiAssistantMessages)
      .where(
        and(
          eq(aiAssistantMessages.organizationId, ctx.activeOrg.id),
          eq(aiAssistantMessages.conversationId, parsedInput.conversationId),
          isNull(aiAssistantMessages.deletedAt),
        ),
      )
      .orderBy(desc(aiAssistantMessages.createdAt))
      .limit(20)

    // Reverse to chronological; drop the just-inserted user msg
    // (it's the userPrompt of the prompt builder).
    const history: ConversationTurn[] = recent
      .reverse()
      .flatMap((m): ConversationTurn[] =>
        (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
          ? [{ role: m.role, content: m.content }]
          : [],
      )
      .slice(0, -1)

    const catalog = buildCatalogForPrompt()
    const builtPrompt = buildPrompt(catalog, history, parsedInput.userMessage)

    let modelResult: Awaited<ReturnType<typeof callAiModel>>
    try {
      modelResult = await callAiModel(builtPrompt)
    } catch (err) {
      throw new ActionError(
        "VALIDATION",
        err instanceof Error ? err.message : "AI model call failed.",
      )
    }

    let parsed: unknown
    let parseError: string | null = null
    try {
      parsed = JSON.parse(modelResult.raw)
    } catch (err) {
      parsed = modelResult.raw
      parseError = err instanceof Error ? err.message : "JSON parse failed"
    }

    const validation = parseError
      ? {
          kind: "rejected" as const,
          errors: [
            {
              type: "shape" as const,
              message: `Model output is not valid JSON: ${parseError}`,
            },
          ] as ValidationError[],
        }
      : validateAssistantOutput(parsed)

    const assistantMsgId = createId()

    if (validation.kind === "rejected") {
      await ctx.db.insert(aiAssistantMessages).values({
        id: assistantMsgId,
        organizationId: ctx.activeOrg.id,
        conversationId: parsedInput.conversationId,
        userId: null,
        role: "assistant",
        content: "I couldn't understand that. Please try rephrasing.",
        rawModelOutput: parsed,
        validationResult: { kind: "rejected", errors: validation.errors },
        modelName: modelResult.modelName,
        modelTokensUsed: modelResult.tokensUsed,
      })
      await audit(
        {
          db: ctx.db,
          organizationId: ctx.activeOrg.id,
          actorUserId: ctx.session.user.id,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        "ai_assistant.turn_rejected",
        {
          resourceType: "ai_assistant_message",
          resourceId: assistantMsgId,
          metadata: { reason: "validation_failed" },
        },
      )
      revalidatePath("/assistant")
      return {
        kind: "rejected" as const,
        userMsgId,
        assistantMsgId,
        errors: validation.errors,
      }
    }

    switch (validation.kind) {
      case "reply": {
        await ctx.db.insert(aiAssistantMessages).values({
          id: assistantMsgId,
          organizationId: ctx.activeOrg.id,
          conversationId: parsedInput.conversationId,
          userId: null,
          role: "assistant",
          content: validation.text,
          rawModelOutput: parsed,
          validationResult: { kind: "reply" },
          modelName: modelResult.modelName,
          modelTokensUsed: modelResult.tokensUsed,
        })
        revalidatePath("/assistant")
        return { kind: "reply" as const, userMsgId, assistantMsgId, text: validation.text }
      }

      case "refusal": {
        await ctx.db.insert(aiAssistantMessages).values({
          id: assistantMsgId,
          organizationId: ctx.activeOrg.id,
          conversationId: parsedInput.conversationId,
          userId: null,
          role: "refusal",
          content: validation.reason,
          rawModelOutput: parsed,
          validationResult: { kind: "refusal" },
          modelName: modelResult.modelName,
          modelTokensUsed: modelResult.tokensUsed,
        })
        revalidatePath("/assistant")
        return { kind: "refusal" as const, userMsgId, assistantMsgId, reason: validation.reason }
      }

      case "navigate": {
        if (!validation.route) {
          throw new ActionError("VALIDATION", "Route not found.")
        }
        const proseMessage = renderNavigation(validation.route.title, validation.message)
        await ctx.db.insert(aiAssistantMessages).values({
          id: assistantMsgId,
          organizationId: ctx.activeOrg.id,
          conversationId: parsedInput.conversationId,
          userId: null,
          role: "assistant",
          content: proseMessage,
          rawModelOutput: parsed,
          validationResult: { kind: "navigate", routeId: validation.routeId },
          modelName: modelResult.modelName,
          modelTokensUsed: modelResult.tokensUsed,
        })
        revalidatePath("/assistant")
        return {
          kind: "navigate" as const,
          userMsgId,
          assistantMsgId,
          routeId: validation.routeId,
          route: findRouteById(validation.routeId),
          message: validation.message,
        }
      }

      case "retrieve": {
        // Invoke the retriever (allow-listed). It uses withOrgContext
        // internally; RLS bounds visibility.
        const retriever = ASSISTANT_RETRIEVERS[validation.name]
        const result = await retriever(validation.args as never)
        const summary = renderRetrieverSummary(validation.name, result)
        await ctx.db.insert(aiAssistantMessages).values({
          id: assistantMsgId,
          organizationId: ctx.activeOrg.id,
          conversationId: parsedInput.conversationId,
          userId: null,
          role: "tool_result",
          content: summary,
          retrieverCallName: validation.name,
          retrieverResultSummary: summary,
          rawModelOutput: parsed,
          validationResult: { kind: "retrieve", name: validation.name },
          modelName: modelResult.modelName,
          modelTokensUsed: modelResult.tokensUsed,
        })
        revalidatePath("/assistant")
        return {
          kind: "retrieve" as const,
          userMsgId,
          assistantMsgId,
          retrieverName: validation.name,
          result,
          summary,
        }
      }
    }
  })
