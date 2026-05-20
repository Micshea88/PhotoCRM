import { pgTable, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"

/**
 * `ai_assistant_messages` — the conversational AI surface (module 17).
 *
 * AI LAYER GUIDING PRINCIPLE (locked in docs/PIVOTS_LEDGER.md Section 1
 * row AI1): "The AI is a tool the human drives, never an autonomous
 * actor." Every AI write must route through the IDENTICAL human action
 * path. No AI-specific back-channel.
 *
 * MODULE 17a SCOPE — READ + NAVIGATE ONLY. The write_proposal /
 * confirmWriteProposal flow lands in 17b. This module is
 * MATHEMATICALLY INCAPABLE of writing data because the code paths for
 * write_proposal output and the writer-allowlist file (writers.ts) do
 * not exist in 17a — the static-grep test in
 * `tests/integration/ai-assistant-no-db-imports.test.ts` proves it.
 *
 * Read-path safety: every retriever wraps an existing queries.ts
 * function which uses `withOrgContext`. RLS bounds visibility
 * automatically — a photographer's AI sees only what the photographer
 * sees by clicking through the UI. Proven by the assignment-scoped
 * read-bypass tests in
 * `tests/integration/ai-assistant-rls-read-boundary.test.ts`.
 *
 * Conversation persistence (locked per user instruction):
 *   - Persist ALL turns (full transcript) — TTL 30 days for chatter
 *   - Write proposals + confirmations TTL 90 days (audit trail)
 *   - Purge via the daily cron at app/api/jobs/cron/purge-deleted/route.ts
 *     (write_proposal/write_confirmed/write_rejected branches land in 17b
 *     — for 17a, the only roles are user / assistant / tool_result / refusal)
 */
export const aiAssistantMessages = pgTable(
  "ai_assistant_messages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    /**
     * Groups messages into a session. Each `assistantTurn` action
     * appends user + assistant rows (and optionally a tool_result row)
     * sharing the same conversation id.
     */
    conversationId: text("conversation_id").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /**
     * Role values in 17a:
     *   `user`        — the human's message
     *   `assistant`   — a model-generated reply or refusal text
     *   `tool_result` — the result of a `retrieve` call (summary form;
     *                   not the raw rows — see retrieverResultSummary)
     *   `refusal`     — model declined to act (e.g. out-of-catalog)
     *
     * 17b will add: `write_proposal`, `write_confirmed`, `write_rejected`.
     * 17a uses ONLY the four above — schema is text so 17b doesn't
     * require a migration.
     */
    role: text("role").notNull(),
    /** Plain-text message body — the user said it / the assistant said it. */
    content: text("content"),
    /**
     * For role='tool_result': which retriever was invoked. Validated at
     * action-layer against the ASSISTANT_RETRIEVERS allowlist; the AI
     * cannot smuggle arbitrary names through.
     */
    retrieverCallName: text("retriever_call_name"),
    /**
     * For role='tool_result': a redacted/truncated rendering of the
     * retriever's result, safe to display in the conversation
     * transcript. The full row data is NOT persisted here — re-fetch
     * via the retriever if needed.
     */
    retrieverResultSummary: text("retriever_result_summary"),
    /**
     * For role='write_proposal' (17b): the writer-allowlist action
     * name (e.g. "updateContact"). Validated against ASSISTANT_WRITERS
     * keys; the AI cannot smuggle arbitrary names through.
     */
    writeProposalAction: text("write_proposal_action"),
    /**
     * For role='write_proposal' (17b): the Zod-validated input ready
     * to pass to the orgAction. Validated through the writer's
     * canonical .inputSchema() before persistence and AGAIN at confirm
     * time (tamper defense — same pattern as confirmAiWorkflowDraft).
     */
    writeProposalInput: jsonb("write_proposal_input").$type<Record<string, unknown> | null>(),
    /**
     * 17b lifecycle for proposals:
     *   pending   — proposal persisted; awaiting human confirmation
     *   confirmed — user confirmed; orgAction invoked
     *   rejected  — user explicitly rejected via rejectWriteProposal
     *   expired   — TTL sweep marked it abandoned (future cron)
     * Null when role is not 'write_proposal'.
     */
    writeProposalStatus: text("write_proposal_status"),
    /**
     * Cross-ref to the resulting resource after a confirmed write
     * (e.g. the contact id that was updated). Soft pointer; no FK.
     */
    resultingResourceType: text("resulting_resource_type"),
    resultingResourceId: text("resulting_resource_id"),
    /** Forensic record of the raw model output for this turn. */
    rawModelOutput: jsonb("raw_model_output").$type<unknown>(),
    /** Validation result object: { kind: "...", errors?: [...] }. */
    validationResult: jsonb("validation_result").$type<Record<string, unknown> | null>(),
    modelName: text("model_name"),
    modelTokensUsed: integer("model_tokens_used"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * TTL purge: 17a uses the existing purge-deleted cron's date-based
     * sweep. A future scheduled sweep marks chatter older than 30 days
     * and write proposals/confirms older than 90 days — added when 17b
     * lands the write rows.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("ai_assistant_messages_org_conv_created_idx").on(
      t.organizationId,
      t.conversationId,
      t.createdAt,
    ),
    index("ai_assistant_messages_org_user_created_idx").on(t.organizationId, t.userId, t.createdAt),
    index("ai_assistant_messages_org_role_created_idx").on(t.organizationId, t.role, t.createdAt),
  ],
)

export type AiAssistantMessage = typeof aiAssistantMessages.$inferSelect
export type NewAiAssistantMessage = typeof aiAssistantMessages.$inferInsert
