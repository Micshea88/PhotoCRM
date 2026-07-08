import { pgPolicy, pgTable, text, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { organization } from "@/modules/auth/schema"
import { emailLog } from "@/modules/email-log/schema"

/**
 * Task 1 — Email-Round Completion + Notification Center
 *
 * `email_delivery_events` is the append-only log of delivery/bounce/open
 * events written by both send paths:
 *   - `path = "resend"`  → Resend webhook (Svix-signed)
 *   - `path = "nylas"`   → Nylas webhook
 *
 * Writer logic is Task 4; this migration creates the table + RLS only.
 *
 * RLS
 * ---
 * Standard org-isolation policy mirroring email_log / email_connections.
 * FORCE ROW LEVEL SECURITY is hand-appended to the generated migration
 * (drizzle-kit emits ENABLE but not FORCE — AGENTS.md hard rule 10a).
 */
export const emailDeliveryEvents = pgTable(
  "email_delivery_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    /** FK to the email_log row this event belongs to. */
    emailLogId: text("email_log_id")
      .notNull()
      .references(() => emailLog.id, { onDelete: "restrict" }),
    /** Provider path: "nylas" | "resend". */
    path: text("path").notNull(),
    /** Event type: sent | delivered | bounced | failed | complained | opened | clicked. */
    type: text("type").notNull(),
    /** Bounce classification: "hard" | "soft" | null. */
    bounceClass: text("bounce_class"),
    /** Raw provider reason / message. */
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    /** Dedup key — Svix `svix-id` or Nylas event id. NULL for events without provider ids. */
    providerEventId: text("provider_event_id"),
    /** Provider-reported event timestamp. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Idempotent webhook redelivery — only applies when provider_event_id is set.
    uniqueIndex("email_delivery_events_org_provider_event_uidx")
      .on(t.organizationId, t.providerEventId)
      .where(sql`${t.providerEventId} IS NOT NULL`),
    // Activity-feed / event-log lookup: all events for a given email_log row.
    index("email_delivery_events_org_log_occurred_idx").on(
      t.organizationId,
      t.emailLogId,
      t.occurredAt.desc(),
    ),
    // Org-isolation RLS — mirrors email_log / email_connections. FORCE RLS
    // hand-appended to the generated SQL per AGENTS.md hard rule 10a.
    pgPolicy("email_delivery_events_org_isolation", {
      as: "permissive",
      for: "all",
      using: sql`organization_id = current_setting('app.current_org', true)`,
      withCheck: sql`organization_id = current_setting('app.current_org', true)`,
    }),
  ],
).enableRLS()

export type EmailDeliveryEvent = typeof emailDeliveryEvents.$inferSelect
export type NewEmailDeliveryEvent = typeof emailDeliveryEvents.$inferInsert
