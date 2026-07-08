import {
  pgPolicy,
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { organization, user } from "@/modules/auth/schema"
import { files } from "./schema"

/**
 * Tokenized, expiring share links for "send as link" attachments (Commit 3,
 * Mike-locked 2026-06-24). One row per shared file per send. Org-isolation RLS
 * (mirrors email_log / contacts). The PUBLIC download/verify routes have no
 * session: they resolve the org via a single unguessable-token lookup on the
 * BYPASSRLS owner connection (getShareLinkByToken — documented there), then run
 * every subsequent read/write under SET LOCAL ROLE app_authenticated +
 * app.current_org = the link's org, so this policy enforces those. No triggers
 * (memory #13).
 *
 * Forward-compatible Smart Documents columns (`versionId`, `contentHash`,
 * `requiresApproval`) are added now, nullable/defaulted, so that build needs no
 * refactor. They are NOT used in Commit 3.
 */
export const fileShareLinks = pgTable(
  "file_share_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    /** Unguessable public token in the share URL. */
    token: text("token").notNull().unique(),
    /** Passcode hash (client verification) + plaintext (photographer display).
     *  Both null when the link is not password-protected. Plaintext-recoverable
     *  is an explicit product decision — this is a 6-digit FILE passcode, not an
     *  account credential.
     *  AT-REST: NO application-layer encryption on passcode_plaintext in V1 —
     *  Postgres/Neon at-rest encryption is the V1 boundary (see
     *  docs/pathway-architecture-rules.md). */
    passcodeHash: text("passcode_hash"),
    passcodePlaintext: text("passcode_plaintext"),
    /** Null = never expires. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Forward-compat (Smart Documents) — unused in Commit 3.
    versionId: text("version_id"),
    contentHash: text("content_hash"),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    // Passcode rate limiting (PCI-style 5/15min → 30min lockout).
    failedPasscodeAttempts: integer("failed_passcode_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [
    index("file_share_links_org_file_idx").on(t.organizationId, t.fileId),
    // Org-isolation RLS policy — mirrors email_log / contacts / etc.
    // FORCE RLS is hand-appended to the generated migration SQL (drizzle-kit
    // emits ENABLE, not FORCE) per AGENTS.md §10a.
    pgPolicy("file_share_links_org_isolation", {
      as: "permissive",
      for: "all",
      using: sql`organization_id = current_setting('app.current_org', true)`,
      withCheck: sql`organization_id = current_setting('app.current_org', true)`,
    }),
  ],
).enableRLS()

/** Audit/share log for a share link — drives the "Share log" table on the file
 *  detail page + click/open tracking tied to recipient identity (no IP/UA). */
export const fileShareLinkEvents = pgTable(
  "file_share_link_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    shareLinkId: text("share_link_id")
      .notNull()
      .references(() => fileShareLinks.id, { onDelete: "cascade" }),
    /** sent | opened | downloaded | passcode_sent | passcode_resent |
     *  passcode_alt_recipient | passcode_regenerated | reactivated | extended |
     *  manual_unlock — text + app-validated. */
    eventType: text("event_type").notNull(),
    recipientEmail: text("recipient_email"),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("file_share_link_events_link_idx").on(t.shareLinkId, t.occurredAt),
    // Org-isolation RLS policy — mirrors email_log / contacts / etc.
    // FORCE RLS is hand-appended to the generated migration SQL (drizzle-kit
    // emits ENABLE, not FORCE) per AGENTS.md §10a. logShareEvent (public path)
    // runs scoped under app.current_org = the link's org.
    pgPolicy("file_share_link_events_org_isolation", {
      as: "permissive",
      for: "all",
      using: sql`organization_id = current_setting('app.current_org', true)`,
      withCheck: sql`organization_id = current_setting('app.current_org', true)`,
    }),
  ],
).enableRLS()

export type FileShareLink = typeof fileShareLinks.$inferSelect
export type NewFileShareLink = typeof fileShareLinks.$inferInsert
export type FileShareLinkEvent = typeof fileShareLinkEvents.$inferSelect
export type NewFileShareLinkEvent = typeof fileShareLinkEvents.$inferInsert
