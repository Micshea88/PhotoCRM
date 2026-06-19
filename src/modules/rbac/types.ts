import { z } from "zod"

/**
 * V1 6-role model. Stored as text in `member_role.role`; validated
 * app-side via this enum so adding a 7th role later is a code-only
 * change (same rationale as custom-fields `field_type`).
 *
 *   owner       — workspace creator; full access including billing
 *   admin       — full operational access; user management
 *   manager     — operational access; no financials, no user management
 *   user        — the standard team-member tier; assignment-scoped reads
 *                 on contacts/projects/tasks (see Module 14a overlay);
 *                 no financials
 *   accountant  — financial-tables access; no project/task access
 *   client      — parked for the future client-portal V2 (no permissions
 *                 in V1)
 *
 * The role NAME is "user"; user-facing copy refers to "team" /
 * "team member" to avoid the noun collision per LOC1.
 */
export const EXTENDED_ROLES = ["owner", "admin", "manager", "user", "accountant", "client"] as const

export const extendedRoleSchema = z.enum(EXTENDED_ROLES)
export type ExtendedRole = z.infer<typeof extendedRoleSchema>

/**
 * Push 2c.6.4 — roles surfaced in the invite form.
 *
 * Excludes "owner" (you can't invite an owner; the org creator is
 * automatically the owner) and "client" (Push 2c.5.1 + V1_ROADMAP V2:
 * clients are external users invited via a future client-portal flow
 * keyed on the contact record, NOT via /settings/organization/members).
 *
 * Keep this in sync with members-list.tsx's role-picker filter — both
 * surfaces hide the same two values for the same reason.
 */
export const INVITABLE_EXTENDED_ROLES = ["admin", "manager", "user", "accountant"] as const
export const invitableExtendedRoleSchema = z.enum(INVITABLE_EXTENDED_ROLES)
export type InvitableExtendedRole = z.infer<typeof invitableExtendedRoleSchema>

/**
 * Better Auth's organization plugin only knows three roles. The product
 * needs eight. Per the Q5 decision: owner→owner, admin→admin, everything
 * else→member. The Phase 4 admin UI must call this mapping when writing
 * member_role and update Better Auth's `member.role` alongside, so its
 * internal plugin checks (invite, transfer ownership, etc.) keep working.
 */
export type BetterAuthRole = "owner" | "admin" | "member"

export function extendedToBetterAuth(role: ExtendedRole): BetterAuthRole {
  if (role === "owner") return "owner"
  if (role === "admin") return "admin"
  return "member"
}

/**
 * Reverse mapping for code paths that have only the Better Auth 3-role
 * (e.g., a fresh seedNewMember invocation that hasn't read member_role yet,
 * or a defense-in-depth fallback when the extended row is missing). Mirror
 * the documented Layer 2 fallback in `rbac/README.md`: BA owner→admin
 * (defensive downgrade — only org creators get extended `owner`); BA
 * admin→admin; BA member→user (the standard team-member tier).
 */
export function extendedFromBetterAuth(role: BetterAuthRole): ExtendedRole {
  if (role === "owner") return "admin"
  if (role === "admin") return "admin"
  return "user"
}

/**
 * The granular permission keys from Requirements §5. Stored as text in
 * `member_permission_override.permission_key`. The Phase 4 admin UI will
 * surface these as toggleable per-user overrides on top of each role's
 * defaults.
 *
 * `hasPermission()` in queries.ts is the consumer — it computes the
 * effective permission for a given (user, key) by checking the role's
 * default and applying any override row. The role-defaults table (which
 * role defaults each key to true/false) lives in this module's queries
 * implementation; not in the DB.
 */
export const PERMISSION_KEYS = [
  "view_contacts",
  "edit_contacts",
  "delete_contacts",
  "view_events",
  "edit_events",
  "delete_events",
  /**
   * Visibility scope on the assignment-scoped overlay (contacts / events /
   * tasks). Granted = sees ALL of the org's contacts/events/tasks; not
   * granted = sees only the ones assigned to them (project assignment, or —
   * for tasks — direct assignee). Defaults: owner/admin/manager/accountant
   * granted; `user` (team member) NOT granted (least privilege). The
   * assignment-scoped RLS reads the resolved value off the
   * `app.current_view_all_events` GUC. Owner toggles a specific team member
   * up via the Phase 4 member-settings UI (the contractor→employee case).
   */
  "view_all_events",
  "view_financial_data",
  "view_reports",
  "send_invoices",
  "send_contracts",
  "manage_workflows",
  "manage_templates",
  "manage_users",
  "access_vendor_matrix",
  "view_contractor_pay",
  "manage_settings",
  "export_data",
  "api_access",
  "send_sms",
  "view_sms_conversations_all",
  /**
   * Permission to use the AI Assistant (Module 17). Per the AI layer
   * guiding principle (rbac/README — AI1), the assistant is a tool
   * the human drives; its writes still flow through orgAction (same
   * permission checks per action). This key gates the conversational
   * surface itself. Default-granted to all roles except `client`.
   */
  "use_ai_assistant",
] as const

export const permissionKeySchema = z.enum(PERMISSION_KEYS)
export type PermissionKey = z.infer<typeof permissionKeySchema>
