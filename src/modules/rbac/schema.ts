import { pgTable, text, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core"
import { invitation, organization, user } from "@/modules/auth/schema"

/**
 * Extended role for a user in an organization. Better Auth's
 * `member.role` only knows `owner | admin | member`; the product needs
 * six access tiers. We keep both in sync:
 *
 *   our role          → Better Auth member.role
 *   ───────────────────────────────────────────
 *   owner             → owner
 *   admin             → admin
 *   manager           → member
 *   user              → member
 *   accountant        → member
 *   client            → member
 *
 * Mapping is owned by `extendedToBetterAuth` in types.ts. Whenever a row
 * here is created or updated, the matching Better Auth `member.role` is
 * updated too (in the actions that ship with the Phase 4 admin UI).
 *
 * FK is on (organization_id, user_id) — NOT on Better Auth's
 * `member.id`. If a user is removed from an org via Better Auth (member
 * row deleted), this row becomes orphaned and is invisible to
 * `getExtendedMemberRole` (which joins through `member`). The Phase 4
 * settings module's "remove member" action is responsible for tombstoning
 * both rows; the orphan is a graceful failure mode in the meantime.
 *
 * No soft-delete columns. Role transitions are audited via `audit_log`;
 * a removed-then-re-added user gets a fresh row.
 */
export const memberRole = pgTable(
  "member_role",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("member_role_org_user_uidx").on(t.organizationId, t.userId),
    index("member_role_org_idx").on(t.organizationId),
  ],
)

/**
 * Sparse table — only rows that DIFFER from the user's role default.
 * Permission keys come from Requirements §5 (view-contacts, edit-events,
 * view-financial-data, send-invoices, etc.). `granted` can be true (allow
 * beyond role default) OR false (revoke despite role default).
 *
 * One row per (organization_id, user_id, permission_key). The effective
 * permission for a user is computed by `hasPermission()` in queries.ts:
 *   default from role table → optionally overridden by this row.
 */
export const memberPermissionOverride = pgTable(
  "member_permission_override",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull(),
    granted: boolean("granted").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("member_permission_override_uidx").on(t.organizationId, t.userId, t.permissionKey),
    index("member_permission_override_org_user_idx").on(t.organizationId, t.userId),
  ],
)

export type MemberRoleRow = typeof memberRole.$inferSelect
export type NewMemberRoleRow = typeof memberRole.$inferInsert
export type MemberPermissionOverrideRow = typeof memberPermissionOverride.$inferSelect
export type NewMemberPermissionOverrideRow = typeof memberPermissionOverride.$inferInsert

/**
 * Push 2c.6.4 — extended-role metadata for pending invitations.
 *
 * Better Auth's `invitation` table only knows three roles
 * (owner / admin / member). The product needs to invite users at the
 * 4 internal sub-roles (admin / manager / user / accountant). When the
 * inviter picks "Manager", we send a BA invitation with role="member"
 * (so BA's own permission checks keep working), and ALSO insert a row
 * here to remember the user's actual intent: extended_role="manager".
 *
 * On accept-invitation, `seedNewMember` looks up the metadata row by
 * invitation_id and seeds member_role with the stored extended role.
 * Falls back to the BA→extended default (extendedFromBetterAuth) when
 * the metadata row is missing — which happens for invitations created
 * before this table existed, or in the rare case where the
 * `inviteMemberWithExtendedRole` compensation cleanup ran cleanly.
 *
 * FK CASCADE: when BA deletes/expires the invitation (success path:
 * after accept; failure path: cancel/expire), our metadata row goes
 * with it. No background sweeper needed.
 *
 * Primary key = invitation_id (one row per invitation). No soft-delete
 * — these rows live for the lifetime of a pending invitation only.
 */
export const invitationExtendedRole = pgTable(
  "invitation_extended_role",
  {
    invitationId: text("invitation_id")
      .primaryKey()
      .references(() => invitation.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    extendedRole: text("extended_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [index("invitation_extended_role_org_idx").on(t.organizationId)],
)

export type InvitationExtendedRoleRow = typeof invitationExtendedRole.$inferSelect
export type NewInvitationExtendedRoleRow = typeof invitationExtendedRole.$inferInsert
