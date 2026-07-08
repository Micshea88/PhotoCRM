/**
 * Pure resolution of the active organization for a request.
 *
 * Given the active org id currently referenced by the session and the
 * authoritative list of organizations the user is CURRENTLY a member of
 * (`getUserOrganizations`), decide which org id should be active:
 *
 *   - valid (set + present in the membership list) → keep it.
 *   - stale/revoked (set but NOT in the membership list) → repick the first
 *     current membership, or `null` if the user has no memberships.
 *   - unset (null) → pick the first membership, or `null` if none.
 *
 * SECURITY: the returned id is ALWAYS either `null` or an org the user is a
 * current member of. A revoked/stale active org is never returned, so it can
 * never be used to establish org context (`runWithOrgContext`) or a member
 * lookup — this is the property that closes the revoked-org data-access hole.
 *
 * Callers persist the result via `auth.api.setActiveOrganization` (passing
 * `null` CLEARS the stale id in the server-side session). Clearing is what
 * stops a stale id from bouncing `create-organization` → `dashboard` and
 * causing the ERR_TOO_MANY_REDIRECTS loop.
 *
 * This helper is intentionally pure (no I/O, no `server-only`) so it can be
 * unit-tested directly.
 */
export function resolveActiveOrg(
  activeOrgId: string | null | undefined,
  organizations: readonly { id: string }[],
): string | null {
  if (activeOrgId && organizations.some((o) => o.id === activeOrgId)) {
    return activeOrgId
  }
  // Unset, stale, or revoked → repick the first current membership (or null).
  return organizations[0]?.id ?? null
}
