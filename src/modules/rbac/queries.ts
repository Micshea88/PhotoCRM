import "server-only"
import { and, eq } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { withOrgContext } from "@/lib/org-context"
import type * as schema from "@/db/schema"
import { memberRole, memberPermissionOverride } from "./schema"
import { type ExtendedRole, type PermissionKey, EXTENDED_ROLES, PERMISSION_KEYS } from "./types"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Role-defaults table: which permissions each role grants by default. The
 * Phase 4 admin UI shows these as the unchecked baseline before overrides
 * are applied. Kept here (not in DB) so a baseline change is a code review,
 * not a runtime config drift.
 *
 * Source: Requirements §5 role descriptions translated into the permission
 * keys from types.ts.
 */
const ROLE_DEFAULTS: Record<ExtendedRole, ReadonlySet<PermissionKey>> = {
  // Owner: everything.
  owner: new Set(PERMISSION_KEYS),
  // Admin: everything except managing the workspace's billing surface
  // (which is owner-only and handled in the Phase 4 admin UI, not by
  // this permission key list).
  admin: new Set(PERMISSION_KEYS),
  // Manager: full operational access except financial visibility and
  // user management. Can be granted invoicing via override.
  manager: new Set<PermissionKey>([
    "view_contacts",
    "edit_contacts",
    "view_events",
    "edit_events",
    "send_contracts",
    "manage_workflows",
    "manage_templates",
    "access_vendor_matrix",
    "manage_settings",
    "send_sms",
    "view_sms_conversations_all",
    "use_ai_assistant",
  ]),
  // User: the standard team-member access tier. Assignment-scoped reads
  // on contacts / projects / tasks (Module 14a RLS overlay; the
  // assignment-scoped policies key on role='user'). No financials, no
  // user management. The AI assistant is granted because its writes
  // flow through the writers.ts orgAction allowlist → same RLS +
  // permission checks the manual UI runs. The AI is a tool, not a
  // privilege escalator.
  user: new Set<PermissionKey>(["view_contacts", "view_events", "send_sms", "use_ai_assistant"]),
  accountant: new Set<PermissionKey>([
    "view_financial_data",
    "view_reports",
    "view_contractor_pay",
    "export_data",
    "use_ai_assistant",
  ]),
  // Client: parked role for the future client-portal V2 work. No
  // permissions in V1.
  client: new Set<PermissionKey>([]),
}

/**
 * Resolve a user's extended role for the active org. Returns null if no
 * member_role row exists — caller should fall back to the Better Auth role
 * (which is what `app/(app)/layout.tsx` does).
 */
export async function getExtendedMemberRole(userId: string): Promise<ExtendedRole | null> {
  return withOrgContext(async (tx) => {
    const [row] = await tx
      .select({ role: memberRole.role })
      .from(memberRole)
      .where(eq(memberRole.userId, userId))
      .limit(1)
    if (!row) return null
    // Defensive: a DB row with an unknown role string falls through to null.
    return (EXTENDED_ROLES as readonly string[]).includes(row.role)
      ? (row.role as ExtendedRole)
      : null
  })
}

/**
 * Parametric variant of `getExtendedMemberRole` for callers that already
 * have a transaction handle with `app.current_org` set — specifically
 * `orgAction` in src/lib/safe-action.ts, which needs to look up the
 * extended role mid-middleware (before `ctx.activeOrg` is finalized).
 *
 * Returns null if no member_role row exists; callers should fall back via
 * `extendedFromBetterAuth(m.role)` per the documented Layer 2 in
 * `rbac/README.md`.
 */
export async function lookupExtendedMemberRole(
  tx: DbHandle,
  userId: string,
): Promise<ExtendedRole | null> {
  const [row] = await tx
    .select({ role: memberRole.role })
    .from(memberRole)
    .where(eq(memberRole.userId, userId))
    .limit(1)
  if (!row) return null
  return (EXTENDED_ROLES as readonly string[]).includes(row.role)
    ? (row.role as ExtendedRole)
    : null
}

/**
 * Compute the effective permission for (user, key) for the active org.
 * Role default applies unless a per-user override row says otherwise.
 *
 * Returns `false` if there's no `member_role` row at all — the safest
 * default for a not-yet-seeded membership.
 */
export async function hasPermission(
  userId: string,
  permissionKey: PermissionKey,
): Promise<boolean> {
  const role = await getExtendedMemberRole(userId)
  if (!role) return false
  const defaultGranted = ROLE_DEFAULTS[role].has(permissionKey)

  return withOrgContext(async (tx) => {
    const [override] = await tx
      .select({ granted: memberPermissionOverride.granted })
      .from(memberPermissionOverride)
      .where(
        and(
          eq(memberPermissionOverride.userId, userId),
          eq(memberPermissionOverride.permissionKey, permissionKey),
        ),
      )
      .limit(1)
    return override ? override.granted : defaultGranted
  })
}

/**
 * Push 2c.5 — bulk lookup of extended roles for every member in an
 * org. Returns a Map<userId, ExtendedRole> so callers can flatten the
 * extended role onto the member list with one query. Members WITHOUT
 * an extended-role row fall back to extendedFromBetterAuth(ba.role)
 * at the call site (this query doesn't synthesize fallbacks itself).
 */
export async function listExtendedRolesByUserId(): Promise<Map<string, ExtendedRole>> {
  return withOrgContext(async (tx) => {
    const rows = await tx
      .select({ userId: memberRole.userId, role: memberRole.role })
      .from(memberRole)
    const out = new Map<string, ExtendedRole>()
    for (const r of rows) {
      if ((EXTENDED_ROLES as readonly string[]).includes(r.role)) {
        out.set(r.userId, r.role as ExtendedRole)
      }
    }
    return out
  })
}

/**
 * All overrides for one user in the active org. Used by the Phase 4 admin
 * UI to render "which permissions does Alice have beyond/short-of her role
 * defaults?"
 */
export async function listMemberPermissionOverrides(userId: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(memberPermissionOverride)
      .where(eq(memberPermissionOverride.userId, userId))
  })
}
