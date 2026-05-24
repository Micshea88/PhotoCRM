import type { ExtendedRole } from "./types"

/**
 * Push 2c.6.6 — single source of truth for how an extended role
 * renders to UI.
 *
 * STORAGE vs DISPLAY is a deliberate split:
 *
 *   - Storage layer (DB columns, Zod enums, audit log metadata,
 *     Better Auth role mapping) uses the raw EXTENDED_ROLES enum
 *     keys: owner / admin / manager / user / accountant / client.
 *     The "user" key stays "user" forever — renaming it would
 *     break member_role rows, invitation_extended_role rows, the
 *     extendedFromBetterAuth/extendedToBetterAuth mapping, and
 *     every historical audit_log entry.
 *
 *   - Display layer (this file) maps each key to a human label.
 *     The internal-team tier displays as "Team member" because
 *     "User" collides with the general English noun in product
 *     copy (per LOC1). Adjusting display labels here propagates
 *     to every surface that calls getRoleDisplay() — pending
 *     invitations list, members list, invite form picker, future
 *     audit-event labels, etc.
 *
 * Adding a new role: extend EXTENDED_ROLES in types.ts, then add
 * the corresponding entry here. The Record<ExtendedRole, string>
 * typing forces a TypeScript error if you forget — the unit test
 * (tests/unit/rbac-display.test.ts) pins this contract.
 */
export const ROLE_DISPLAY: Record<ExtendedRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  user: "Team member",
  accountant: "Accountant",
  client: "Client",
}

export function getRoleDisplay(role: ExtendedRole): string {
  return ROLE_DISPLAY[role]
}
