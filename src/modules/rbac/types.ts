import { z } from "zod"

/**
 * V1 8-role model per Requirements §5. Stored as text in `member_role.role`;
 * validated app-side via this enum so adding a 9th role later is a code-only
 * change (same rationale as custom-fields `field_type`).
 */
export const EXTENDED_ROLES = [
  "owner",
  "admin",
  "manager",
  "photographer",
  "contractor",
  "editor",
  "accountant",
  "client_limited",
] as const

export const extendedRoleSchema = z.enum(EXTENDED_ROLES)
export type ExtendedRole = z.infer<typeof extendedRoleSchema>

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
 * admin→admin; BA member→photographer (lowest productive role).
 */
export function extendedFromBetterAuth(role: BetterAuthRole): ExtendedRole {
  if (role === "owner") return "admin"
  if (role === "admin") return "admin"
  return "photographer"
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
] as const

export const permissionKeySchema = z.enum(PERMISSION_KEYS)
export type PermissionKey = z.infer<typeof permissionKeySchema>
