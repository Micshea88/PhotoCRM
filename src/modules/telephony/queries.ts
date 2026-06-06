import "server-only"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { withOrgContext } from "@/lib/org-context"
import { getProvidersByCategory } from "@/modules/integrations/registry"
import { telephonyConnections } from "@/modules/telephony/schema"

/**
 * Org-scoped read of live telephony connections. Used by the
 * Integrations Hub (Browse / Connected Apps / provider wizard) AND
 * by the contact-card affordance to decide which branch (no-connection
 * picker vs ready-for-dialer) to render.
 *
 * Returns only fields that are safe to surface client-side — never
 * accessToken/refreshToken/validationToken. Decryption (when ever
 * needed) happens at point of use in a server-only path, not here.
 *
 * Each function is split into a public wrapper (reads ALS via
 * withOrgContext — what server components call) and an `Impl` variant
 * that takes a tx directly (single source of truth that integration
 * tests can drive against the test's BEGIN/ROLLBACK transaction).
 * Same pattern as src/modules/telephony/upsert.ts and
 * src/modules/telephony/disconnect.ts.
 */

type DbHandle = NodePgDatabase<typeof schema>

export interface ConnectedProviderRow {
  id: string
  userId: string
  provider: string
  scope: string
  externalUserId: string
  accessTokenExpiresAt: Date
  refreshTokenExpiresAt: Date
  createdAt: Date
  updatedAt: Date
}

export async function listConnectedProvidersForOrgImpl(
  tx: DbHandle,
): Promise<ConnectedProviderRow[]> {
  return tx
    .select({
      id: telephonyConnections.id,
      userId: telephonyConnections.userId,
      provider: telephonyConnections.provider,
      scope: telephonyConnections.scope,
      externalUserId: telephonyConnections.externalUserId,
      accessTokenExpiresAt: telephonyConnections.accessTokenExpiresAt,
      refreshTokenExpiresAt: telephonyConnections.refreshTokenExpiresAt,
      createdAt: telephonyConnections.createdAt,
      updatedAt: telephonyConnections.updatedAt,
    })
    .from(telephonyConnections)
    .where(isNull(telephonyConnections.deletedAt))
}

/** All live connections in the current org (any user). */
export async function listConnectedProvidersForOrg(): Promise<ConnectedProviderRow[]> {
  return withOrgContext(listConnectedProvidersForOrgImpl)
}

export async function listConnectedProvidersForUserImpl(
  tx: DbHandle,
  userId: string,
): Promise<ConnectedProviderRow[]> {
  return tx
    .select({
      id: telephonyConnections.id,
      userId: telephonyConnections.userId,
      provider: telephonyConnections.provider,
      scope: telephonyConnections.scope,
      externalUserId: telephonyConnections.externalUserId,
      accessTokenExpiresAt: telephonyConnections.accessTokenExpiresAt,
      refreshTokenExpiresAt: telephonyConnections.refreshTokenExpiresAt,
      createdAt: telephonyConnections.createdAt,
      updatedAt: telephonyConnections.updatedAt,
    })
    .from(telephonyConnections)
    .where(and(eq(telephonyConnections.userId, userId), isNull(telephonyConnections.deletedAt)))
}

/** Live connections for one user in the current org. */
export async function listConnectedProvidersForUser(
  userId: string,
): Promise<ConnectedProviderRow[]> {
  return withOrgContext((tx) => listConnectedProvidersForUserImpl(tx, userId))
}

/**
 * Storable phone-provider ids — derived from the registry's Phone
 * category, filtered to providers that actually have a backing
 * connection (`connectKind !== "none"` excludes the tel: pseudo-
 * provider which is always-available and never written to
 * telephony_connections). Computed once at module load; a registry
 * edit reflects automatically with no separate update here.
 */
const STORABLE_PHONE_PROVIDER_IDS: ReadonlySet<string> = new Set(
  getProvidersByCategory("phone")
    .filter((p) => p.connectKind !== "none")
    .map((p) => p.id),
)

export async function userHasConnectedPhoneProviderImpl(
  tx: DbHandle,
  userId: string,
): Promise<boolean> {
  const ids = Array.from(STORABLE_PHONE_PROVIDER_IDS)
  if (ids.length === 0) return false
  const rows = await tx
    .select({ exists: sql<number>`1` })
    .from(telephonyConnections)
    .where(
      and(
        eq(telephonyConnections.userId, userId),
        isNull(telephonyConnections.deletedAt),
        inArray(telephonyConnections.provider, ids),
      ),
    )
    .limit(1)
  return rows.length > 0
}

/**
 * Cheap existence check: does the current user have at least one
 * live phone-category connection in the current org?
 *
 * Implemented as `select 1 ... limit 1` so it never hydrates token
 * expiries, scope, externalUserId, or any other column across the
 * boundary just to answer a boolean.
 */
export async function userHasConnectedPhoneProvider(userId: string): Promise<boolean> {
  return withOrgContext((tx) => userHasConnectedPhoneProviderImpl(tx, userId))
}
