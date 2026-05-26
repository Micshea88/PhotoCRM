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
 * matching engine, fetch the per-record fields the listing page +
 * merge modal need. The shape is intentionally wider than the list
 * card needs so the same payload powers the modal's side-by-side
 * comparison without a second roundtrip.
 *
 * Date columns serialise to ISO strings across the server→client
 * boundary; the merge action operates on the raw rows it re-loads
 * inside the tx so it doesn't depend on this shape.
 */
export interface ContactDisplayRow {
  id: string
  firstName: string
  lastName: string
  primaryEmail: string | null
  secondaryEmail: string | null
  primaryPhone: string | null
  secondaryPhone: string | null
  contactType: string | null
  lifecycleStatus: string | null
  tags: string[] | null
  leadSource: string | null
  sourceDetail: string | null
  companyId: string | null
  companyName: string | null
  ownerUserId: string | null
  instagramHandle: string | null
  facebookUrl: string | null
  website: string | null
  notes: string | null
  internalNotes: string | null
  mailingAddress: Record<string, unknown> | null
  customFields: Record<string, unknown> | null
  dob: string | null
  anniversaryDate: string | null
  referredByContactId: string | null
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
      secondaryEmail: contacts.secondaryEmail,
      primaryPhone: contacts.primaryPhone,
      secondaryPhone: contacts.secondaryPhone,
      contactType: contacts.contactType,
      lifecycleStatus: contacts.lifecycleStatus,
      tags: contacts.tags,
      leadSource: contacts.leadSource,
      sourceDetail: contacts.sourceDetail,
      companyId: contacts.companyId,
      ownerUserId: contacts.ownerUserId,
      instagramHandle: contacts.instagramHandle,
      facebookUrl: contacts.facebookUrl,
      website: contacts.website,
      notes: contacts.notes,
      internalNotes: contacts.internalNotes,
      mailingAddress: contacts.mailingAddress,
      customFields: contacts.customFields,
      dob: contacts.dob,
      anniversaryDate: contacts.anniversaryDate,
      referredByContactId: contacts.referredByContactId,
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
      secondaryEmail: r.secondaryEmail,
      primaryPhone: r.primaryPhone,
      secondaryPhone: r.secondaryPhone,
      contactType: r.contactType,
      lifecycleStatus: r.lifecycleStatus,
      tags: r.tags,
      leadSource: r.leadSource,
      sourceDetail: r.sourceDetail,
      companyId: r.companyId,
      companyName: r.companyName,
      ownerUserId: r.ownerUserId,
      instagramHandle: r.instagramHandle,
      facebookUrl: r.facebookUrl,
      website: r.website,
      notes: r.notes,
      internalNotes: r.internalNotes,
      mailingAddress: r.mailingAddress,
      customFields: r.customFields,
      dob: r.dob,
      anniversaryDate: r.anniversaryDate,
      referredByContactId: r.referredByContactId,
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
  instagramHandle: string | null
  category: string | null
  customFields: Record<string, unknown> | null
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
      instagramHandle: companies.instagramHandle,
      category: companies.category,
      customFields: companies.customFields,
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
      instagramHandle: r.instagramHandle,
      category: r.category,
      customFields: r.customFields,
      createdAt: r.createdAt.toISOString(),
    })
  }
  return out
}
