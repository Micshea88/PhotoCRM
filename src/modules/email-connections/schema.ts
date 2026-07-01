import { pgPolicy, pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { organization, user } from "@/modules/auth/schema"

/**
 * Per-photographer email connection — encrypted at-rest Nylas grant (Commit 4).
 *
 * Each PHOTOGRAPHER connects their OWN mailbox (Gmail / Outlook / other-IMAP)
 * through Nylas hosted auth. Client email then sends AS them and their replies
 * log to the right contact. This is per-USER, not per-org: the partial-unique
 * index enforces one LIVE connection per (org, user, provider).
 *
 * What Nylas stores vs. what we store
 * -----------------------------------
 * Nylas v3 is grant-based: after hosted auth we hold a long-lived `grant_id`
 * and use it together with the application API key (env) on every send/read.
 * Nylas docs: "You don't need to record the user's OAuth access token." So the
 * sensitive at-rest value here is the `grant_id` — there is NO access/refresh
 * token pair and NO refresh loop (unlike telephony/RingCentral). Re-auth is
 * signalled by the `grant.expired` webhook, which flips `status` to "expired".
 *
 * Encrypted columns
 * -----------------
 * `grantId` and `webhookSecret` are AES-256-GCM ciphertext (v1: prefix) via
 * src/lib/crypto.ts, keyed by NYLAS_ENCRYPTION_KEY (its OWN security domain,
 * not the telephony key). Plaintext never lands in the column, audit metadata,
 * the activity feed, error messages, or on the wire to the client. Decrypt only
 * at point of use (immediately before a Nylas API call).
 *
 * Forward-compat (design only — not built in Commit 4)
 * ----------------------------------------------------
 * The SAME Nylas grant will later carry calendar + contacts scopes (contacts
 * sync and native scheduling are separate future builds). `scopes` records what
 * the grant covers so those plug in without a new table. `accessToken` /
 * `refreshToken` / `tokenExpiresAt` are declared nullable now (unused by the
 * grant-based Nylas impl) so a future NATIVE Gmail/Microsoft OAuth
 * implementation behind the same EmailProvider interface can populate them
 * without a schema refactor — the telephony "declare-nullable-now" pattern.
 *
 * RLS
 * ---
 * Standard org-isolation policy mirroring email_log / telephony_connections.
 * FORCE ROW LEVEL SECURITY is hand-appended to the generated migration
 * (drizzle-kit emits ENABLE but not FORCE — AGENTS.md hard rule 10a).
 */
export const emailConnections = pgTable(
  "email_connections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Which EmailProvider implementation owns this row. "nylas" today; a
     *  future native impl would be "google_native" / "ms_native". The swap
     *  seam for the provider-agnostic requirement. */
    implementation: text("implementation").notNull(),
    /** Nylas provider key as returned by the grant — "google" / "microsoft" /
     *  "imap". */
    provider: text("provider").notNull(),
    /** The email_log.source this connection writes/matches — "gmail" /
     *  "outlook" / "imap". Maps google→gmail, microsoft→outlook, other→imap. */
    sourceValue: text("source_value").notNull(),
    /** The connected mailbox address (contact-matching + display). */
    email: text("email").notNull(),
    /** AES-256-GCM ciphertext (v1: prefix), NYLAS_ENCRYPTION_KEY. Never
     *  plaintext. The Nylas grant_id. */
    grantId: text("grant_id").notNull(),
    /** Space-delimited granted scopes (RFC 6749 §3.3). Forward-compat: records
     *  which capabilities the grant covers so calendar/contacts plug in later. */
    scopes: text("scopes").notNull(),
    /** "connected" | "expired". Set to "expired" by the grant.expired webhook;
     *  an expired connection is treated the SAME as never-connected for sending
     *  (dressed studio fallback) — see src/lib/email/provider.ts. */
    status: text("status").notNull().default("connected"),
    /** Nylas webhook subscription id, if created programmatically. NULL when the
     *  subscription is managed from the Nylas dashboard (the V1 path). */
    webhookSubscriptionId: text("webhook_subscription_id"),
    /** AES-256-GCM ciphertext (v1: prefix). NULL until/unless a per-connection
     *  webhook secret is stored; never plaintext. */
    webhookSecret: text("webhook_secret"),
    /** Forward-compat for a future NATIVE OAuth impl. Unused by Nylas (grant-
     *  based). AES-256-GCM ciphertext when present; never plaintext. */
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    // Common read path: "is this user connected in this org?"
    index("email_connections_org_user_idx").on(t.organizationId, t.userId, t.deletedAt),
    // Inbound routing: resolve the receiving mailbox address → connection/org.
    index("email_connections_org_email_idx").on(t.organizationId, t.email, t.deletedAt),
    // One LIVE connection per (org, user, provider). Soft-deleted rows bypass
    // the constraint so disconnect + reconnect is free and keeps history.
    uniqueIndex("email_connections_org_user_provider_live_uidx")
      .on(t.organizationId, t.userId, t.provider)
      .where(sql`${t.deletedAt} IS NULL`),
    // Org-isolation RLS — mirrors email_log / telephony_connections. FORCE RLS
    // hand-appended to the generated SQL per AGENTS.md hard rule 10a.
    pgPolicy("email_connections_org_isolation", {
      as: "permissive",
      for: "all",
      using: sql`organization_id = current_setting('app.current_org', true)`,
      withCheck: sql`organization_id = current_setting('app.current_org', true)`,
    }),
  ],
).enableRLS()

export type EmailConnection = typeof emailConnections.$inferSelect
export type NewEmailConnection = typeof emailConnections.$inferInsert
