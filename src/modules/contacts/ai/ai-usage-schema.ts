import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"
import { contacts } from "../schema"

/**
 * Push 3 (C6b) — AI usage log.
 *
 * Append-only telemetry for every Haiku / Sonnet call from the
 * contacts AI engine. Lets Mike query cost visibility ("how many
 * classifier calls last week?", "tokens per contact across the
 * org?") once real usage starts. NOT for rate limiting in V1; that's
 * a follow-up if costs grow.
 *
 * Separate from audit_log — audit is for "user did X" provenance;
 * this is for "the AI engine called Anthropic" telemetry.
 *
 * RLS: org-scoped FOR ALL on app.current_org.
 */
export const aiUsageLog = pgTable(
  "ai_usage_log",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    /** "contacts.classifier" | "contacts.summary" — short stable strings. */
    feature: text("feature").notNull(),
    /** Model id passed to ai-model.ts (Haiku/Sonnet/etc). */
    model: text("model").notNull(),
    /** The contact this call ran against, when applicable. */
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    /** Anthropic's reported (input + output) token total. Null when the
     *  provider didn't return usage. */
    tokensUsed: integer("tokens_used"),
    /** Whether the call succeeded. False rows are useful too — they
     *  cost no money but reveal config / prompt drift. */
    ok: text("ok").notNull(),
    /** Free-form error / fallback reason for failed calls. */
    errorMessage: text("error_message"),
    /** Who triggered the call (regenerate is user-initiated). */
    triggeredByUserId: text("triggered_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_usage_log_org_created_idx").on(t.organizationId, t.createdAt.desc()),
    index("ai_usage_log_org_feature_created_idx").on(
      t.organizationId,
      t.feature,
      t.createdAt.desc(),
    ),
    index("ai_usage_log_org_contact_idx").on(t.organizationId, t.contactId),
  ],
)

export type AiUsageLogRow = typeof aiUsageLog.$inferSelect
export type NewAiUsageLogRow = typeof aiUsageLog.$inferInsert
