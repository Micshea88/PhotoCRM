import { pgPolicy, pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { organization, user } from "@/modules/auth/schema"

/**
 * Telephony provider connection — encrypted at-rest OAuth grant.
 *
 * Step 1 of the phone/SMS push: TABLE ONLY. No OAuth flow, no webhook
 * setup, no subscription creation, no refresh logic. Columns the later
 * steps will populate are declared NULLABLE so step 1 can ship the
 * shape without the behavior.
 *
 * One RingCentral OAuth grant covers BOTH VoIP calling AND SMS, so this
 * row is the single source of truth for "is this user/org connected" —
 * shared by the calls module and the sms-messages module.
 *
 * Encrypted columns
 * -----------------
 * `accessToken`, `refreshToken`, and `validationToken` are stored as
 * ciphertext produced by src/lib/crypto.ts (AES-256-GCM, v1: prefix).
 * Plaintext NEVER lands in this column, in audit metadata, in the
 * activity feed, in error messages, or on the wire to the client.
 * Decrypt only at point of use — i.e., immediately before calling the
 * RC API. The drizzle type is plain `text` because the encrypt/decrypt
 * boundary is application-level, not database-level.
 *
 * Step-1-but-not-step-1 columns
 * -----------------------------
 *  - `webhookSubscriptionId` — populated by the webhook-setup step.
 *    NULL until then.
 *  - `validationToken` — RingCentral subscription validation secret;
 *    populated by the webhook-setup step. NULL until then. Encrypted at
 *    rest because it functions as a shared secret for verifying
 *    incoming webhook deliveries.
 *
 * Live-row uniqueness
 * -------------------
 * Partial unique on (organization_id, user_id, provider) where
 * deleted_at IS NULL — one live connection per (org, user, provider),
 * but historical disconnected rows are preserved for audit/forensics.
 *
 * RLS
 * ---
 * Standard org-isolation policy mirroring email_log / call_log.
 * The FORCE ROW LEVEL SECURITY statement is hand-appended to the
 * generated migration (drizzle-kit emits ENABLE but not FORCE — see
 * AGENTS.md hard rule 10a for the carve-out).
 */
export const telephonyConnections = pgTable(
  "telephony_connections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Provider key — "ringcentral" today; future "twilio" / "vonage" / etc. */
    provider: text("provider").notNull(),
    /** AES-256-GCM ciphertext (v1: prefix). Never plaintext. */
    accessToken: text("access_token").notNull(),
    /** AES-256-GCM ciphertext (v1: prefix). Never plaintext. */
    refreshToken: text("refresh_token").notNull(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }).notNull(),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }).notNull(),
    /**
     * OAuth scope string as granted by the provider — space-delimited
     * per RFC 6749 §3.3. Records which capabilities (Calling, SMS,
     * ReadMessages, etc.) the grant covers; checked at request time
     * rather than parsed into a separate set.
     */
    scope: text("scope").notNull(),
    /** Provider-issued user identifier (e.g., RC extension id). */
    externalUserId: text("external_user_id").notNull(),
    /**
     * RingCentral subscription id. NULL until the webhook-setup step
     * lands; populated by step 2/3.
     */
    webhookSubscriptionId: text("webhook_subscription_id"),
    /**
     * AES-256-GCM ciphertext (v1: prefix). NULL until the webhook-setup
     * step populates it; never plaintext.
     */
    validationToken: text("validation_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    // Lookup by (org, user) — the common read path: "is this user
    // connected to a provider in this org?"
    index("telephony_connections_org_user_idx").on(t.organizationId, t.userId, t.deletedAt),
    // One LIVE connection per (org, user, provider). Soft-deleted rows
    // bypass the constraint so users can disconnect + re-connect freely
    // without losing history.
    uniqueIndex("telephony_connections_org_user_provider_live_uidx")
      .on(t.organizationId, t.userId, t.provider)
      .where(sql`${t.deletedAt} IS NULL`),
    // Org-isolation RLS policy — mirrors email_log / call_log / meetings
    // / sms_messages. FORCE RLS is hand-appended to the generated SQL
    // per AGENTS.md hard rule 10a.
    pgPolicy("telephony_connections_org_isolation", {
      as: "permissive",
      for: "all",
      using: sql`organization_id = current_setting('app.current_org', true)`,
      withCheck: sql`organization_id = current_setting('app.current_org', true)`,
    }),
  ],
).enableRLS()

export type TelephonyConnection = typeof telephonyConnections.$inferSelect
export type NewTelephonyConnection = typeof telephonyConnections.$inferInsert
