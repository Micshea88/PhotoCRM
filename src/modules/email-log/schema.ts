import {
  pgPolicy,
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { organization, user } from "@/modules/auth/schema"
import { contacts } from "@/modules/contacts/schema"
import { projects } from "@/modules/projects/schema"
import { opportunities } from "@/modules/opportunities/schema"

/**
 * Backlog Item 2 — email_log is the first-class home for logged
 * emails. Replaces the Push 3 hack where "Log email" landed as a
 * contact_note with a "Subject: …" body prefix.
 *
 * Shape mirrors call_log so the same activity-feed primitives + AI
 * cache invalidation rules apply unchanged.
 *
 *   - `source = "manual"`  → user-entered via the Activities tab Email
 *                            composer. `external_id` + `external_metadata`
 *                            are null.
 *   - `source = "<provider>"` → reserved for the future inbound /
 *                            outbound integration (Gmail / Outlook /
 *                            Resend ingest). The partial unique index
 *                            on (org, source, external_id) prevents
 *                            duplicate webhook deliveries.
 *
 * `contact_id` is nullable (ON DELETE SET NULL) for parity with
 * call_log — an email to/from someone who isn't yet a contact can
 * still be logged. The composer requires a contact for V1; schema
 * doesn't.
 *
 * `attachments` is a jsonb array of `{ fileId, name, size }` objects
 * pointing at files-table rows uploaded through /api/blob/upload.
 * Kept as jsonb (not a join table) because V1 logs few attachments
 * and the field is read-only — no need for relational queries.
 */
export const emailLog = pgTable(
  "email_log",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    /** Optional event (project) / opportunity association — see sms_messages
     *  for the rationale (event filter + bulk-reassignable plain FK columns). */
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    opportunityId: text("opportunity_id").references(() => opportunities.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /** "outbound" | "inbound" — matches the call_log convention. */
    direction: text("direction").notNull(),
    /** Free-form subject line. */
    subject: text("subject"),
    /** Body — plain text for V1; HTML lands when provider ingest does. */
    body: text("body"),
    /** Raw HTML body — populated for inbound emails that arrive as HTML
     *  (Nylas/Gmail lane). Null for plain-text inbound, manual entries,
     *  and outbound rows. Stored alongside the cleaned plain-text `body`
     *  so the activity feed can render clean text while the raw source is
     *  preserved for debugging / future rich rendering. */
    bodyHtml: text("body_html"),
    /** When the email was sent / received. Distinct from createdAt
     *  (which is when the row was inserted). */
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    /** Provider source — "manual" today; future "gmail" / "outlook"
     *  / "resend" etc. */
    source: text("source").notNull(),
    /** Provider message id — the email's RFC-5322 Message-ID (outbound: the
     *  Resend send id; inbound: the received Message-ID). Also dedups webhook
     *  re-deliveries via the partial unique index below. NULL for manual rows. */
    externalId: text("external_id"),
    /** Thread grouping key (Commit 3 email-threading). All messages in one
     *  conversation share a thread_id, derived from In-Reply-To / References
     *  at capture time; a root message's thread_id = its own Message-ID.
     *  NULL until the threading pipeline lands. */
    threadId: text("thread_id"),
    /** Provider raw payload + threading metadata (In-Reply-To, References).
     *  Free-form jsonb. */
    externalMetadata: jsonb("external_metadata").$type<Record<string, unknown>>(),
    /** Optional attachments. Array of { fileId, name, size, deliveryMethod,
     *  shareLinkToken } where deliveryMethod is "direct" (≤25 MB inline) or
     *  "link" (send-as-link). shareLinkToken is set ONLY for "link" delivery —
     *  it's the recipient's tokenized share URL, surfaced as "Open share link"
     *  on the sender's activity feed (HubSpot pattern). Permissive jsonb, so
     *  adding the field needs no migration; pre-existing rows simply omit it. */
    attachments: jsonb("attachments").$type<
      {
        fileId: string
        name: string
        size: number
        deliveryMethod?: "direct" | "link"
        shareLinkToken?: string
      }[]
    >(),
    /** Open-tracking pixel id (Commit 3). Unique per outbound email; null for
     *  inbound + un-tracked rows. */
    trackingPixelId: text("tracking_pixel_id").unique(),
    /** Denormalized delivery status — updated by the delivery-event writer (Task 4).
     *  Allowed values: "sent" | "delivered" | "bounced" | "failed" | "complained".
     *  Default "sent" so existing rows and new manual rows start in a valid state. */
    deliveryStatus: text("delivery_status").notNull().default("sent"),
    /** Timestamp of the first bounce event. NULL until a bounce is recorded. */
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    /** Human-readable bounce reason (filled by Task 4 writer). */
    bounceReason: text("bounce_reason"),
    /** Timestamp of the first permanent-failure event. NULL until a failure is recorded. */
    failedAt: timestamp("failed_at", { withTimezone: true }),
    /** Classified open counts (Task 13 fills these from email_delivery_events). */
    openHumanCount: integer("open_human_count").notNull().default(0),
    /** Bot / scanner opens — UI label is "Automated Open". */
    openBotCount: integer("open_bot_count").notNull().default(0),
    /** MPP / ambiguous opens. */
    openUnknownCount: integer("open_unknown_count").notNull().default(0),
    openCount: integer("open_count").notNull().default(0),
    firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    // Contact activity feed lookup.
    index("email_log_org_contact_sent_idx").on(
      t.organizationId,
      t.contactId,
      t.deletedAt,
      t.sentAt.desc(),
    ),
    // Org-wide list, most recent first.
    index("email_log_org_sent_idx").on(t.organizationId, t.deletedAt, t.sentAt.desc()),
    // Event-scoped comms lookup.
    index("email_log_org_project_idx").on(t.organizationId, t.projectId),
    // Thread grouping (Commit 3 "Thread replies").
    index("email_log_org_thread_idx").on(t.organizationId, t.threadId),
    // Provider dedup. Partial unique — manual rows have NULL external_id
    // and bypass the constraint.
    uniqueIndex("email_log_org_source_external_uidx")
      .on(t.organizationId, t.source, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    // Org-isolation RLS policy — mirrors call_log / meetings / sms_messages.
    // FORCE RLS is appended to the generated SQL by the post-generate step
    // documented in AGENTS.md (drizzle-kit emits ENABLE but not FORCE).
    pgPolicy("email_log_org_isolation", {
      as: "permissive",
      for: "all",
      using: sql`organization_id = current_setting('app.current_org', true)`,
      withCheck: sql`organization_id = current_setting('app.current_org', true)`,
    }),
  ],
).enableRLS()

export type EmailLog = typeof emailLog.$inferSelect
export type NewEmailLog = typeof emailLog.$inferInsert
