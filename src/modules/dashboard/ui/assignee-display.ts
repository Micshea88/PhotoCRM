/**
 * Resolve a task's assigneeUserId to a display state for the dashboard
 * widgets. Pure (no React / no server-only) so it imports anywhere and
 * unit-tests directly.
 *
 * Three states (Mike-locked 2026-06-21):
 *   - "member"     → an active org member (name + avatar image)
 *   - "unassigned" → assigneeUserId is null
 *   - "former"     → an id is set but no longer matches an org member; shown
 *                    as "Former team member" (truthful — they WERE assigned
 *                    but have been removed). Rare once the user-removal +
 *                    bulk-transfer workflow ships (memory #13), but needed for
 *                    historical data + edge cases.
 *
 * Read-only resolution — it never mutates assigneeUserId, so a future bulk
 * "transfer all records owned by user X to user Y" UPDATE is unaffected.
 */
export interface DashboardMember {
  id: string
  name: string
  image: string | null
}

export type AssigneeDisplay =
  | { kind: "member"; name: string; image: string | null }
  | { kind: "unassigned" }
  | { kind: "former" }

export function resolveAssignee(
  assigneeUserId: string | null,
  members: DashboardMember[],
): AssigneeDisplay {
  if (!assigneeUserId) return { kind: "unassigned" }
  const m = members.find((x) => x.id === assigneeUserId)
  return m ? { kind: "member", name: m.name, image: m.image } : { kind: "former" }
}
