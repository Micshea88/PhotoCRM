"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
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

/**
 * Push 4 (B1) — On-demand duplicates scans. Owner+Admin only
 * (mirrors the A2 settings/custom-fields gate).
 *
 * Detection is computed-on-demand: no persistence of groups. Each
 * scan loads the active org's records, runs the in-memory matching
 * engine, hydrates display rows for matched ids, and writes a
 * single audit log entry with metadata.recordCount +
 * metadata.resultGroupCount for telemetry. A future V1.x cron
 * version can re-use this same action body — only the trigger
 * changes.
 */

function assertOwnerOrAdmin(role: ExtendedRole) {
  if (role !== "owner" && role !== "admin") {
    throw new ActionError("FORBIDDEN", "Only owners and admins can scan for duplicates.")
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
      // A group whose underlying rows all vanished mid-scan is dropped
      // rather than rendered as an empty card.
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

    revalidatePath("/contacts/duplicates")
    return { groups: hydrated, recordCount: candidates.length }
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

    revalidatePath("/companies/duplicates")
    return { groups: hydrated, recordCount: candidates.length }
  })
