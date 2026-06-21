import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"
import { contacts } from "@/modules/contacts/schema"
import { projects } from "@/modules/projects/schema"
import { opportunities } from "@/modules/opportunities/schema"

/**
 * Push 3 (C6a) — sms_messages placeholder.
 *
 * Lays the table down so the contact-detail Activity feed can show
 * SMS entries once the SMS provider integration lands (V1.5). The
 * row stores enough to render an activity feed entry: direction,
 * body, contact link, who sent (for outbound).
 *
 * No actions module yet — writes happen via the future SMS provider
 * webhook handler. Reads happen in the contact detail page's
 * activity loader (which falls back to "empty" when no rows exist).
 *
 * RLS: standard FOR ALL using app.current_org.
 */
export const smsMessages = pgTable(
  "sms_messages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** Optional event (project) / opportunity association for event-scoped
     *  comms + the Activity feed Event filter. Nullable, ON DELETE SET NULL —
     *  plain FK columns (no triggers/derivatives) so a future bulk owner/
     *  contact reassignment can mass-UPDATE them (memory #13). */
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    opportunityId: text("opportunity_id").references(() => opportunities.id, {
      onDelete: "set null",
    }),
    /** "inbound" | "outbound" — text + Zod-validated at write time. */
    direction: text("direction").notNull(),
    /** Body text. SMS is typically <= 160 chars but providers may
     *  concatenate longer messages; storing as text is fine. */
    body: text("body").notNull(),
    /** When the provider says the message was sent / received. */
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    /** Optional provider-side id (Twilio SID, Bandwidth message id,
     *  etc) for reconciliation. */
    providerMessageId: text("provider_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Who sent the outbound message (null for inbound). */
    sentByUserId: text("sent_by_user_id").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("sms_messages_org_contact_sent_idx").on(t.organizationId, t.contactId, t.sentAt.desc()),
    index("sms_messages_org_project_idx").on(t.organizationId, t.projectId),
  ],
)

export type SmsMessage = typeof smsMessages.$inferSelect
export type NewSmsMessage = typeof smsMessages.$inferInsert
