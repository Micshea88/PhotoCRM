"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { listFieldDefinitionsForRecordTypeWithDb } from "@/modules/custom-fields/queries"
import type { ListCustomFieldDef } from "@/modules/custom-fields/ui/column-helpers"
import type { ExtendedRole } from "@/modules/rbac/types"
import {
  findDuplicateCompanyGroups,
  findDuplicateContactGroups,
  type CompanyMatchReason,
  type ContactMatchReason,
} from "./matching"
import {
  fetchCompanyDisplayRows,
  fetchContactDisplayRows,
  loadCompanyDuplicateCandidates,
  loadContactDuplicateCandidates,
  type CompanyDisplayRow,
  type ContactDisplayRow,
} from "./queries"
import {
  executeCompanyMerge,
  executeContactMerge,
  mergeCompaniesInput,
  mergeContactsInput,
} from "./merge-engine"

/**
 * Push 4 (B1 + B2) — duplicates module server actions.
 *
 * B1 scan actions are computed-on-demand: no persistence of groups.
 * Each scan loads the active org's records, runs the matching
 * engine, hydrates display rows, and writes a single audit log
 * entry with metadata.recordCount + metadata.resultGroupCount for
 * telemetry. The scan result also includes the active custom field
 * defs (non-archived) for the entity type — the merge modal labels
 * cf:* comparison rows from this set.
 *
 * B2 merge actions are thin wrappers around `executeContactMerge` /
 * `executeCompanyMerge` in `./merge-engine`. Engine in a separate
 * file so integration tests can call it directly via the test DB +
 * setOrgContext (orgAction needs cookies; tests bypass it).
 *
 * RBAC: Owner + Admin only — matches the A2 settings/custom-fields
 * gating pattern.
 */

function assertOwnerOrAdmin(role: ExtendedRole) {
  if (role !== "owner" && role !== "admin") {
    throw new ActionError("FORBIDDEN", "Only owners and admins can manage duplicates.")
  }
}

const noInput = z.object({}).optional()

export interface ContactDuplicateGroupView {
  reasons: ContactMatchReason[]
  records: ContactDisplayRow[]
}

export interface CompanyDuplicateGroupView {
  reasons: CompanyMatchReason[]
  records: CompanyDisplayRow[]
}

export const scanContactDuplicates = orgAction
  .metadata({ actionName: "contacts.duplicates_scan" })
  .inputSchema(noInput)
  .action(async ({ ctx }) => {
    assertOwnerOrAdmin(ctx.activeOrg.role)

    const candidates = await loadContactDuplicateCandidates(ctx.db, ctx.activeOrg.id)
    const groups = findDuplicateContactGroups(candidates)
    const allIds = new Set<string>()
    for (const g of groups) for (const id of g.ids) allIds.add(id)
    const displays = await fetchContactDisplayRows(ctx.db, ctx.activeOrg.id, [...allIds])

    const hydrated: ContactDuplicateGroupView[] = []
    for (const g of groups) {
      const records: ContactDisplayRow[] = []
      for (const id of g.ids) {
        const row = displays.get(id)
        if (row) records.push(row)
      }
      if (records.length < 2) continue
      hydrated.push({ reasons: g.reasons, records })
    }

    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "contacts.duplicates_scanned",
      {
        resourceType: "contact",
        metadata: {
          recordCount: candidates.length,
          resultGroupCount: hydrated.length,
        },
      },
    )

    const allCfDefs = await listFieldDefinitionsForRecordTypeWithDb(ctx.db, "contact")
    const customFieldDefs: ListCustomFieldDef[] = allCfDefs
      .filter((d) => d.archivedAt === null)
      .map((d) => ({
        id: d.id,
        name: d.name,
        fieldType: d.fieldType,
        options: (d.options as { choices?: { value: string; label: string }[] } | null) ?? null,
        archivedAt: d.archivedAt ? d.archivedAt.toISOString() : null,
      }))

    revalidatePath("/contacts/duplicates")
    return { groups: hydrated, recordCount: candidates.length, customFieldDefs }
  })

export const scanCompanyDuplicates = orgAction
  .metadata({ actionName: "companies.duplicates_scan" })
  .inputSchema(noInput)
  .action(async ({ ctx }) => {
    assertOwnerOrAdmin(ctx.activeOrg.role)

    const candidates = await loadCompanyDuplicateCandidates(ctx.db, ctx.activeOrg.id)
    const groups = findDuplicateCompanyGroups(candidates)
    const allIds = new Set<string>()
    for (const g of groups) for (const id of g.ids) allIds.add(id)
    const displays = await fetchCompanyDisplayRows(ctx.db, ctx.activeOrg.id, [...allIds])

    const hydrated: CompanyDuplicateGroupView[] = []
    for (const g of groups) {
      const records: CompanyDisplayRow[] = []
      for (const id of g.ids) {
        const row = displays.get(id)
        if (row) records.push(row)
      }
      if (records.length < 2) continue
      hydrated.push({ reasons: g.reasons, records })
    }

    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "companies.duplicates_scanned",
      {
        resourceType: "company",
        metadata: {
          recordCount: candidates.length,
          resultGroupCount: hydrated.length,
        },
      },
    )

    const allCfDefs = await listFieldDefinitionsForRecordTypeWithDb(ctx.db, "company")
    const customFieldDefs: ListCustomFieldDef[] = allCfDefs
      .filter((d) => d.archivedAt === null)
      .map((d) => ({
        id: d.id,
        name: d.name,
        fieldType: d.fieldType,
        options: (d.options as { choices?: { value: string; label: string }[] } | null) ?? null,
        archivedAt: d.archivedAt ? d.archivedAt.toISOString() : null,
      }))

    revalidatePath("/companies/duplicates")
    return { groups: hydrated, recordCount: candidates.length, customFieldDefs }
  })

// ─── MERGE ACTIONS (B2) ────────────────────────────────────────────────

export const mergeContacts = orgAction
  .metadata({ actionName: "contacts.merged" })
  .inputSchema(mergeContactsInput)
  .action(async ({ parsedInput, ctx }) => {
    assertOwnerOrAdmin(ctx.activeOrg.role)
    const result = await executeContactMerge(
      ctx.db,
      {
        organizationId: ctx.activeOrg.id,
        userId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      parsedInput,
    )
    revalidatePath("/contacts")
    revalidatePath("/contacts/duplicates")
    revalidatePath("/contacts/deleted")
    revalidatePath(`/contacts/${result.winnerId}`)
    return result
  })

export const mergeCompanies = orgAction
  .metadata({ actionName: "companies.merged" })
  .inputSchema(mergeCompaniesInput)
  .action(async ({ parsedInput, ctx }) => {
    assertOwnerOrAdmin(ctx.activeOrg.role)
    const result = await executeCompanyMerge(
      ctx.db,
      {
        organizationId: ctx.activeOrg.id,
        userId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      parsedInput,
    )
    revalidatePath("/contacts")
    revalidatePath("/companies/duplicates")
    revalidatePath("/companies/deleted")
    return result
  })
