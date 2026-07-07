import { pgPolicy, pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { organization, user } from "@/modules/auth/schema"

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_org_created_idx").on(t.organizationId, t.createdAt.desc()),
    index("audit_log_actor_idx").on(t.actorUserId),
    // Push 4 (A1) — per-record audit history lookups. "Show me all
    // audit entries for contact X" hits this composite for free.
    // Same shape Mike's Push 4 spec proposed under a new `audit_logs`
    // table; instead we re-use the existing `audit_log` (singular)
    // and add the missing entity-lookup index.
    index("audit_log_org_resource_created_idx").on(
      t.organizationId,
      t.resourceType,
      t.resourceId,
      t.createdAt.desc(),
    ),
    // Org-isolation RLS policy — mirrors email_log / contacts / etc.
    // FORCE RLS is hand-appended to the generated migration SQL (drizzle-kit
    // emits ENABLE, not FORCE) per AGENTS.md §10a. Every audit() writer runs
    // either in an orgAction/withOrgContext scoped tx whose app.current_org
    // equals ctx.organizationId (INSERT satisfies WITH CHECK), or on the bare
    // BYPASSRLS owner connection (cron purge, workflow matcher) which bypasses
    // the policy. No writer runs under app_authenticated without a matching org.
    pgPolicy("audit_log_org_isolation", {
      as: "permissive",
      for: "all",
      using: sql`organization_id = current_setting('app.current_org', true)`,
      withCheck: sql`organization_id = current_setting('app.current_org', true)`,
    }),
  ],
).enableRLS()

export type AuditLog = typeof auditLog.$inferSelect
export type NewAuditLog = typeof auditLog.$inferInsert
