import { sql } from "drizzle-orm"
import {
  pgPolicy,
  pgTable,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"
import { contacts } from "@/modules/contacts/schema"

/**
 * Task 9 — Notification Center tables
 *
 * Two tables: `notifications` (one row per in-app notification) and
 * `notification_preferences` (per-user per-type opt-in/out).
 *
 * These are the persistence layer only — dispatch is Task 10,
 * queries/actions are Task 14, UI is Task 15/16.
 *
 * ── RLS NUANCE ───────────────────────────────────────────────────────────
 *
 * `notifications` needs TWO distinct scopings:
 *
 *   SELECT + UPDATE + DELETE  →  org + recipient_user_id = current user.
 *     Each user sees and modifies only their own notification rows.
 *
 *   INSERT  →  org only (no recipient constraint).
 *     Task 10's dispatcher runs in the org's context and inserts
 *     notifications FOR other users (owner + admins). Constraining INSERT
 *     to recipient = current user would break that path.
 *
 *   Two permissive policies achieve this.  For INSERT, Postgres evaluates
 *   the OR of all matching permissive WITH CHECK conditions:
 *     (org AND recipient = current_user) OR (org only)  →  org only.
 *   For SELECT/UPDATE/DELETE only the FOR-ALL policy's USING clause
 *   applies, so the recipient restriction holds.
 *
 * `notification_preferences` uses a single all-op policy scoped to
 * org + user_id (a user manages only their own prefs).
 *
 * FORCE ROW LEVEL SECURITY is hand-appended to the generated migration
 * (drizzle-kit emits ENABLE but not FORCE — AGENTS.md hard rule 10a).
 */

// ---------------------------------------------------------------------------
// notifications
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),

    /** Open-ended — NO check constraint. e.g. "email.bounced", "lead.assigned". */
    type: text("type").notNull(),
    /** Open-ended — NO check constraint. e.g. "system", "client", "lead", "project", "payment". */
    category: text("category").notNull(),
    /** Open-ended — NO check constraint. Conventional values: "critical" | "routine". */
    tier: text("tier").notNull(),

    title: text("title").notNull(),
    body: text("body"),
    linkPath: text("link_path"),

    /** Related contact — NULL for pure system notices. SET NULL on contact deletion. */
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),

    /** Remaining refs (emailLogId, connectionId, actorUserId, sourceModule, …). */
    payload: jsonb("payload").$type<Record<string, unknown>>(),

    /** Source module — "email" today; extensible. */
    sourceModule: text("source_module").notNull(),

    /** Authoritative read-state. NULL = unread. */
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    /** Quiet-hours deferral — NULL = deliver immediately. */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Bell / unread panel: filter by recipient + read status, ordered by recency.
    index("notifications_org_recipient_read_created_idx").on(
      t.organizationId,
      t.recipientUserId,
      t.readAt,
      t.createdAt.desc(),
    ),
    // Contact-scoped activity feed.
    index("notifications_org_contact_created_idx").on(
      t.organizationId,
      t.contactId,
      t.createdAt.desc(),
    ),
    // Category / type grouping (notification center tabs).
    index("notifications_org_recipient_category_created_idx").on(
      t.organizationId,
      t.recipientUserId,
      t.category,
      t.createdAt.desc(),
    ),
    // Flush cron — only rows with a scheduled delivery time.
    index("notifications_scheduled_for_idx")
      .on(t.scheduledFor)
      .where(sql`${t.scheduledFor} IS NOT NULL`),

    // ── RLS ───────────────────────────────────────────────────────────────
    // Policy 1 (FOR ALL): governs SELECT / UPDATE / DELETE via its USING
    // clause.  Also contributes a WITH CHECK for INSERT, but that is OR'd
    // with policy 2's broader WITH CHECK (net effect: org-only on INSERT).
    pgPolicy("notifications_read_write", {
      as: "permissive",
      for: "all",
      using: sql`organization_id = current_setting('app.current_org', true) AND recipient_user_id = current_setting('app.current_user_id', true)`,
      withCheck: sql`organization_id = current_setting('app.current_org', true) AND recipient_user_id = current_setting('app.current_user_id', true)`,
    }),
    // Policy 2 (FOR INSERT only): WITH CHECK = org only.  Permissive OR
    // with policy 1's WITH CHECK yields org-only enforcement on INSERT,
    // so a dispatcher can create notifications for any recipient in the org.
    pgPolicy("notifications_insert", {
      as: "permissive",
      for: "insert",
      withCheck: sql`organization_id = current_setting('app.current_org', true)`,
    }),
  ],
).enableRLS()

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert

// ---------------------------------------------------------------------------
// notification_preferences
// ---------------------------------------------------------------------------

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    /** One row per (user, type). Open-ended — NO check constraint. */
    type: text("type").notNull(),
    inApp: boolean("in_app").notNull(),
    email: boolean("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One preference row per (user, type).
    uniqueIndex("notification_preferences_user_type_uidx").on(t.userId, t.type),

    // ── RLS ───────────────────────────────────────────────────────────────
    // All ops scoped to the owning user (org + user_id).
    pgPolicy("notification_preferences_user_isolation", {
      as: "permissive",
      for: "all",
      using: sql`organization_id = current_setting('app.current_org', true) AND user_id = current_setting('app.current_user_id', true)`,
      withCheck: sql`organization_id = current_setting('app.current_org', true) AND user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS()

export type NotificationPreference = typeof notificationPreferences.$inferSelect
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert
