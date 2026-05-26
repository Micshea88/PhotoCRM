import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { contacts } from "@/modules/contacts/schema"
import { companies } from "@/modules/companies/schema"
import type { ContactCandidate, CompanyCandidate } from "./matching"

/**
 * Push 4 (B1) — load the candidate row sets the matching engine
 * scans for duplicates. Both helpers are parametric on the
 * transaction handle (mirrors the A3 hotfix pattern in
 * src/modules/custom-fields/queries.ts) so they work from inside
 * orgAction without ALS.
 *
 * Soft-deleted rows are excluded; the matching engine treats
 * "exists" and "active" the same. RLS scopes to org via the pg
 * session settings already on the tx.
 */

type DbHandle = NodePgDatabase<typeof schema>

export async function loadContactDuplicateCandidates(
  tx: DbHandle,
  orgId: string,
): Promise<ContactCandidate[]> {
  const rows = await tx
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      primaryEmail: contacts.primaryEmail,
      secondaryEmail: contacts.secondaryEmail,
      primaryPhone: contacts.primaryPhone,
      secondaryPhone: contacts.secondaryPhone,
      companyName: companies.name,
    })
    .from(contacts)
    .leftJoin(companies, and(eq(contacts.companyId, companies.id), isNull(companies.deletedAt)))
    .where(and(eq(contacts.organizationId, orgId), isNull(contacts.deletedAt)))
  return rows.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    primaryEmail: r.primaryEmail,
    secondaryEmail: r.secondaryEmail,
    primaryPhone: r.primaryPhone,
    secondaryPhone: r.secondaryPhone,
    primaryCompanyName: r.companyName,
  }))
}

export async function loadCompanyDuplicateCandidates(
  tx: DbHandle,
  orgId: string,
): Promise<CompanyCandidate[]> {
  const rows = await tx
    .select({
      id: companies.id,
      name: companies.name,
      website: companies.website,
      mainPhone: companies.mainPhone,
      category: companies.category,
    })
    .from(companies)
    .where(and(eq(companies.organizationId, orgId), isNull(companies.deletedAt)))
  return rows
}

/**
 * Display row hydrator — given the deduped id sets returned by the
 * matching engine, fetch the per-record display fields the listing
 * page needs. Called once per scan after the matching engine
 * computes the groups.
 */
export interface ContactDisplayRow {
  id: string
  firstName: string
  lastName: string
  primaryEmail: string | null
  primaryPhone: string | null
  companyName: string | null
  lifecycleStatus: string | null
  createdAt: string
}

export async function fetchContactDisplayRows(
  tx: DbHandle,
  orgId: string,
  ids: string[],
): Promise<Map<string, ContactDisplayRow>> {
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      primaryEmail: contacts.primaryEmail,
      primaryPhone: contacts.primaryPhone,
      lifecycleStatus: contacts.lifecycleStatus,
      createdAt: contacts.createdAt,
      companyName: companies.name,
    })
    .from(contacts)
    .leftJoin(companies, and(eq(contacts.companyId, companies.id), isNull(companies.deletedAt)))
    .where(and(eq(contacts.organizationId, orgId), isNull(contacts.deletedAt)))
  const set = new Set(ids)
  const out = new Map<string, ContactDisplayRow>()
  for (const r of rows) {
    if (!set.has(r.id)) continue
    out.set(r.id, {
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      primaryEmail: r.primaryEmail,
      primaryPhone: r.primaryPhone,
      companyName: r.companyName,
      lifecycleStatus: r.lifecycleStatus,
      createdAt: r.createdAt.toISOString(),
    })
  }
  return out
}

export interface CompanyDisplayRow {
  id: string
  name: string
  website: string | null
  mainPhone: string | null
  category: string | null
  createdAt: string
}

export async function fetchCompanyDisplayRows(
  tx: DbHandle,
  orgId: string,
  ids: string[],
): Promise<Map<string, CompanyDisplayRow>> {
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({
      id: companies.id,
      name: companies.name,
      website: companies.website,
      mainPhone: companies.mainPhone,
      category: companies.category,
      createdAt: companies.createdAt,
    })
    .from(companies)
    .where(and(eq(companies.organizationId, orgId), isNull(companies.deletedAt)))
  const set = new Set(ids)
  const out = new Map<string, CompanyDisplayRow>()
  for (const r of rows) {
    if (!set.has(r.id)) continue
    out.set(r.id, {
      id: r.id,
      name: r.name,
      website: r.website,
      mainPhone: r.mainPhone,
      category: r.category,
      createdAt: r.createdAt.toISOString(),
    })
  }
  return out
}
