import "server-only"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { z } from "zod"
import { ActionError } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { callLog } from "@/modules/calls/schema"
import { companies } from "@/modules/companies/schema"
import { contactCompanyAssociations, contactNotes, contacts } from "@/modules/contacts/schema"
import { invalidateContactAiCache } from "@/modules/contacts/ai/cache-invalidation"
import { meetings } from "@/modules/meetings/schema"
import { opportunities } from "@/modules/opportunities/schema"
import { paymentInstallments } from "@/modules/invoices/schema"
import { projectContacts, projects } from "@/modules/projects/schema"
import { smsMessages } from "@/modules/sms-messages/schema"
import type * as schema from "@/db/schema"

/**
 * Push 4 (B2) — merge engine. Extracted from actions.ts so the
 * merge body is callable from integration tests (which use the
 * test DB + setOrgContext but can't drive orgAction with cookies).
 *
 * Both `executeContactMerge` and `executeCompanyMerge` run their
 * full sequence on the passed-in transaction handle. The
 * orgAction wrappers in actions.ts are thin shells around these
 * functions; they do auth + ctx-shape conversion only.
 *
 * Transactional ordering (locked spec):
 *
 *   1. SELECT FOR UPDATE on winner + loser rows.
 *   2. Compute merged values.
 *   3. AUDIT LOG INSERT FIRST — so failure of any later step rolls
 *      back the audit too.
 *   4. UPDATE winner.
 *   5. FK repoints with junction dedup.
 *   6. Soft-delete losers.
 *
 * The caller (orgAction wrapper) is responsible for revalidatePath
 * after commit.
 */

type DbHandle = NodePgDatabase<typeof schema>

export interface MergeExecutionContext {
  organizationId: string
  userId: string
  ipAddress: string | null
  userAgent: string | null
}

// ─── Zod input schemas (exported for action wrappers) ─────────────────

const tagsModeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("union") }),
  z.object({ mode: z.literal("use"), fromId: z.string().min(1) }),
])

const companiesModeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("union") }),
  z.object({ mode: z.literal("use"), fromId: z.string().min(1) }),
])

export const mergeContactsInput = z.object({
  winnerId: z.string().min(1),
  loserIds: z.array(z.string().min(1)).min(1).max(10),
  fieldChoices: z.record(z.string(), z.string()).optional().default({}),
  /**
   * P3 (C7) — per-field custom-value overrides. When the user
   * inline-edits a field in the side-by-side merge UI, the typed
   * value lands here. Takes precedence over `fieldChoices` for
   * matching keys. Intrinsic field overrides write into the merged
   * row directly; `cf:<defId>` overrides write into the merged
   * customFields jsonb. Tags / mailingAddress accept whole-blob
   * overrides via the field name keys (`tags`, `mailingAddress`).
   *
   * Backwards compatible: B2 duplicates-modal callers pass no
   * overrides and the existing pick-only flow applies.
   */
  customOverrides: z.record(z.string(), z.unknown()).optional(),
  /**
   * P3 (C7 rebuild) — final fieldValues from the new full-record
   * merge grid. When present, takes top precedence: every key
   * resolves to its value as-is and `fieldChoices` / `customOverrides`
   * are ignored for matching keys.
   *
   * Wire contract: the C7 client resolves picks + inline edits into
   * concrete values BEFORE submit, so the action has no pick/winner
   * semantics to interpret. Intrinsic field keys (`firstName` etc.)
   * map directly onto the merged row; `cf:<defId>` keys land in the
   * customFields jsonb; `tags` accepts a string[]; `mailingAddress`
   * accepts a record-or-null.
   *
   * `tagsMode` / `companiesMode` continue to drive the bulk-mode
   * semantics for tags / additional companies — the C7 UI still
   * uses the 3-mode radios for those two surfaces.
   */
  fieldValues: z.record(z.string(), z.unknown()).optional(),
  tagsMode: tagsModeSchema.default({ mode: "union" }),
  companiesMode: companiesModeSchema.default({ mode: "union" }),
})

export const mergeCompaniesInput = z.object({
  winnerId: z.string().min(1),
  loserIds: z.array(z.string().min(1)).min(1).max(10),
  fieldChoices: z.record(z.string(), z.string()).optional().default({}),
})

export type MergeContactsInput = z.infer<typeof mergeContactsInput>
export type MergeCompaniesInput = z.infer<typeof mergeCompaniesInput>

// ─── Sub-helpers (pure) ───────────────────────────────────────────────

function pickFieldValue<T extends { id: string }, K extends keyof T>(
  fieldKey: string,
  prop: K,
  winner: T,
  losers: T[],
  fieldChoices: Record<string, string>,
): T[K] {
  const chosenId = fieldChoices[fieldKey]
  if (!chosenId || chosenId === winner.id) return winner[prop]
  const loser = losers.find((l) => l.id === chosenId)
  if (!loser) return winner[prop]
  return loser[prop]
}

function pickOldestDate(rows: { createdAt: Date }[]): Date {
  let oldest = rows[0]?.createdAt ?? new Date()
  for (const r of rows) {
    if (r.createdAt.getTime() < oldest.getTime()) oldest = r.createdAt
  }
  return oldest
}

function unionStringArrays(arrays: (string[] | null | undefined)[]): string[] {
  const out = new Set<string>()
  for (const arr of arrays) {
    if (!arr) continue
    for (const s of arr) out.add(s)
  }
  return [...out]
}

function mergeCustomFieldsJsonb(
  winner: Record<string, unknown> | null,
  losersById: Map<string, Record<string, unknown> | null>,
  winnerId: string,
  fieldChoices: Record<string, string>,
): Record<string, unknown> | null {
  const merged: Record<string, unknown> = { ...(winner ?? {}) }
  for (const [key, chosenId] of Object.entries(fieldChoices)) {
    if (!key.startsWith("cf:")) continue
    const defId = key.slice(3)
    if (chosenId === winnerId) continue
    const loserCustom = losersById.get(chosenId)
    if (loserCustom && defId in loserCustom) {
      merged[defId] = loserCustom[defId]
    } else {
      // Chosen record had no value for this defId — drop the key.
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete merged[defId]
    }
  }
  return Object.keys(merged).length === 0 ? null : merged
}

function validateInput(winnerId: string, loserIds: string[]): void {
  if (loserIds.includes(winnerId)) {
    throw new ActionError("VALIDATION", "Winner id cannot appear in loserIds.")
  }
  if (new Set(loserIds).size !== loserIds.length) {
    throw new ActionError("VALIDATION", "Duplicate ids in loserIds.")
  }
}

// ─── Contact merge ─────────────────────────────────────────────────────

export async function executeContactMerge(
  db: DbHandle,
  ctx: MergeExecutionContext,
  input: MergeContactsInput,
): Promise<{ winnerId: string; mergedFromIds: string[] }> {
  const { winnerId, loserIds, fieldChoices, tagsMode, companiesMode } = input
  // P3 (C7 rebuild) — fieldValues takes top precedence. If the C7
  // client sent it, merge it INTO customOverrides so every downstream
  // override site (intrinsic, tags, mailingAddress, cf:*) reads from
  // a single map. Concretely: the existing customOverrides processing
  // already does exactly what fieldValues semantics require.
  const customOverrides = { ...(input.customOverrides ?? {}), ...(input.fieldValues ?? {}) }
  validateInput(winnerId, loserIds)
  const allIds = [winnerId, ...loserIds]

  const locked = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.organizationId, ctx.organizationId),
        isNull(contacts.deletedAt),
        inArray(contacts.id, allIds),
      ),
    )
    .for("update")
  if (locked.length !== allIds.length) {
    throw new ActionError(
      "NOT_FOUND",
      "One or more contacts in the merge no longer exist or have been deleted.",
    )
  }
  const winner = locked.find((r) => r.id === winnerId)
  if (!winner) throw new ActionError("NOT_FOUND", "Winner contact missing.")
  const losers = locked.filter((r) => r.id !== winnerId)
  const losersById = new Map(losers.map((l) => [l.id, l.customFields]))

  const merged = {
    firstName: pickFieldValue("firstName", "firstName", winner, losers, fieldChoices),
    lastName: pickFieldValue("lastName", "lastName", winner, losers, fieldChoices),
    primaryEmail: pickFieldValue("primaryEmail", "primaryEmail", winner, losers, fieldChoices),
    secondaryEmail: pickFieldValue(
      "secondaryEmail",
      "secondaryEmail",
      winner,
      losers,
      fieldChoices,
    ),
    primaryPhone: pickFieldValue("primaryPhone", "primaryPhone", winner, losers, fieldChoices),
    secondaryPhone: pickFieldValue(
      "secondaryPhone",
      "secondaryPhone",
      winner,
      losers,
      fieldChoices,
    ),
    mailingAddress: pickFieldValue(
      "mailingAddress",
      "mailingAddress",
      winner,
      losers,
      fieldChoices,
    ),
    dob: pickFieldValue("dob", "dob", winner, losers, fieldChoices),
    anniversaryDate: pickFieldValue(
      "anniversaryDate",
      "anniversaryDate",
      winner,
      losers,
      fieldChoices,
    ),
    instagramHandle: pickFieldValue(
      "instagramHandle",
      "instagramHandle",
      winner,
      losers,
      fieldChoices,
    ),
    instagramUserId: pickFieldValue(
      "instagramUserId",
      "instagramUserId",
      winner,
      losers,
      fieldChoices,
    ),
    facebookUrl: pickFieldValue("facebookUrl", "facebookUrl", winner, losers, fieldChoices),
    website: pickFieldValue("website", "website", winner, losers, fieldChoices),
    leadSource: pickFieldValue("leadSource", "leadSource", winner, losers, fieldChoices),
    sourceDetail: pickFieldValue("sourceDetail", "sourceDetail", winner, losers, fieldChoices),
    contactType: pickFieldValue("contactType", "contactType", winner, losers, fieldChoices),
    lifecycleStatus: pickFieldValue(
      "lifecycleStatus",
      "lifecycleStatus",
      winner,
      losers,
      fieldChoices,
    ),
    ownerUserId: pickFieldValue("ownerUserId", "ownerUserId", winner, losers, fieldChoices),
    notes: pickFieldValue("notes", "notes", winner, losers, fieldChoices),
    internalNotes: pickFieldValue("internalNotes", "internalNotes", winner, losers, fieldChoices),
    companyId: pickFieldValue("companyId", "companyId", winner, losers, fieldChoices),
    referredByContactId: pickFieldValue(
      "referredByContactId",
      "referredByContactId",
      winner,
      losers,
      fieldChoices,
    ),
  }

  let mergedTags: string[] | null
  if (tagsMode.mode === "use") {
    const src = locked.find((r) => r.id === tagsMode.fromId)
    mergedTags = src?.tags ?? null
  } else {
    const u = unionStringArrays(locked.map((r) => r.tags))
    mergedTags = u.length === 0 ? null : u
  }

  let mergedCustom = mergeCustomFieldsJsonb(
    winner.customFields ?? null,
    losersById,
    winnerId,
    fieldChoices,
  )
  const oldestCreatedAt = pickOldestDate(locked)

  // P3 (C7) — apply customOverrides over the pick-only result. The
  // C7 side-by-side UI lets the user inline-edit any winning value;
  // those typed values arrive here as customOverrides[fieldKey] and
  // win over both `fieldChoices` and the auto-rescue defaults.
  //
  // Intrinsic field keys map directly onto the merged object.
  // `tags` / `mailingAddress` accept whole-blob overrides.
  // `cf:<defId>` keys flow into the merged customFields jsonb.
  const intrinsicOverrideKeys = [
    "firstName",
    "lastName",
    "primaryEmail",
    "secondaryEmail",
    "primaryPhone",
    "secondaryPhone",
    "contactType",
    "lifecycleStatus",
    "leadSource",
    "sourceDetail",
    "companyId",
    "ownerUserId",
    "instagramHandle",
    "instagramUserId",
    "facebookUrl",
    "website",
    "notes",
    "internalNotes",
    "dob",
    "anniversaryDate",
    "referredByContactId",
  ] as const
  type IntrinsicKey = (typeof intrinsicOverrideKeys)[number]
  for (const key of intrinsicOverrideKeys) {
    if (key in customOverrides) {
      // Trust the caller's value shape — UI is the gatekeeper.
      // Drizzle column types coerce string|null appropriately.
      ;(merged as Record<IntrinsicKey, unknown>)[key] = customOverrides[key]
    }
  }
  if ("tags" in customOverrides) {
    const next = customOverrides.tags
    if (Array.isArray(next)) {
      mergedTags = next.length === 0 ? null : (next as string[])
    } else if (next === null) {
      mergedTags = null
    }
  }
  if ("mailingAddress" in customOverrides) {
    const next = customOverrides.mailingAddress
    if (next === null || (typeof next === "object" && !Array.isArray(next))) {
      merged.mailingAddress = next as typeof merged.mailingAddress
    }
  }
  // Custom-field per-key overrides (`cf:<defId>`).
  for (const [key, value] of Object.entries(customOverrides)) {
    if (!key.startsWith("cf:")) continue
    const defId = key.slice(3)
    if (value === null || value === undefined) {
      if (mergedCustom && defId in mergedCustom) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete mergedCustom[defId]
      }
    } else {
      // Promote a null mergedCustom to a real object so the override
      // can land.
      mergedCustom ??= {}
      mergedCustom[defId] = value
    }
  }

  const refTarget = merged.referredByContactId
  let finalReferredBy = refTarget
  if (refTarget && (refTarget === winnerId || loserIds.includes(refTarget))) {
    finalReferredBy = null
  }

  const existingMerged: string[] = Array.isArray(winner.mergedRecordIds)
    ? winner.mergedRecordIds
    : []
  const newMergedRecordIds = [...existingMerged, ...loserIds]

  // AUDIT FIRST.
  await audit(
    {
      db,
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    "contacts.merged",
    {
      resourceType: "contact",
      resourceId: winnerId,
      metadata: {
        winnerId,
        loserIds,
        fieldChoices,
        tagsMode,
        companiesMode,
        oldestCreatedAtPreserved: oldestCreatedAt.toISOString(),
      },
    },
  )

  // P3 (C4) — soft-delete losers BEFORE updating the winner. The
  // contacts table has partial unique indexes on (org, LOWER(email))
  // and (org, normalized phone) restricted to WHERE deleted_at IS
  // NULL. If we updated the winner first and the user picked a
  // loser's email/phone via fieldChoices, the active set would
  // briefly hold both rows with the same email/phone and the index
  // would reject the UPDATE. Soft-deleting losers first removes them
  // from the active index, freeing up the value for the winner.
  //
  // The audit() call above still fires BEFORE any state change, so
  // the audit-first invariant is preserved.
  await db
    .update(contacts)
    .set({ deletedAt: new Date(), deletedBy: ctx.userId })
    .where(and(eq(contacts.organizationId, ctx.organizationId), inArray(contacts.id, loserIds)))

  await db
    .update(contacts)
    .set({
      ...merged,
      referredByContactId: finalReferredBy,
      tags: mergedTags,
      customFields: mergedCustom,
      mergedRecordIds: newMergedRecordIds,
      createdAt: oldestCreatedAt,
      updatedAt: new Date(),
      updatedBy: ctx.userId,
    })
    .where(eq(contacts.id, winnerId))

  // FK repoints.

  if (companiesMode.mode === "use") {
    const fromId = companiesMode.fromId
    const dropFromIds = allIds.filter((id) => id !== fromId)
    if (dropFromIds.length > 0) {
      await db
        .delete(contactCompanyAssociations)
        .where(
          and(
            eq(contactCompanyAssociations.organizationId, ctx.organizationId),
            inArray(contactCompanyAssociations.contactId, dropFromIds),
          ),
        )
    }
  }
  // Tuple-IN subquery dedup: drop loser rows that would collide with
  // existing winner rows. inArray handles the loserIds array bind;
  // the raw sql carries only the tuple-IN expression that drizzle's
  // structured query builder doesn't model directly.
  await db.delete(contactCompanyAssociations).where(
    and(
      eq(contactCompanyAssociations.organizationId, ctx.organizationId),
      inArray(contactCompanyAssociations.contactId, loserIds),
      sql`(${contactCompanyAssociations.companyId}, COALESCE(${contactCompanyAssociations.role}, '')) IN (
          SELECT company_id, COALESCE(role, '')
          FROM contact_company_associations
          WHERE organization_id = ${ctx.organizationId}
            AND contact_id = ${winnerId}
        )`,
    ),
  )
  await db
    .update(contactCompanyAssociations)
    .set({ contactId: winnerId })
    .where(
      and(
        eq(contactCompanyAssociations.organizationId, ctx.organizationId),
        inArray(contactCompanyAssociations.contactId, loserIds),
      ),
    )

  await db.delete(projectContacts).where(
    and(
      eq(projectContacts.organizationId, ctx.organizationId),
      inArray(projectContacts.contactId, loserIds),
      sql`(${projectContacts.projectId}, ${projectContacts.role}) IN (
          SELECT project_id, role
          FROM project_contacts
          WHERE organization_id = ${ctx.organizationId}
            AND contact_id = ${winnerId}
        )`,
    ),
  )
  await db
    .update(projectContacts)
    .set({ contactId: winnerId })
    .where(
      and(
        eq(projectContacts.organizationId, ctx.organizationId),
        inArray(projectContacts.contactId, loserIds),
      ),
    )

  await db
    .update(contactNotes)
    .set({ contactId: winnerId })
    .where(
      and(
        eq(contactNotes.organizationId, ctx.organizationId),
        inArray(contactNotes.contactId, loserIds),
      ),
    )

  await db
    .update(callLog)
    .set({ contactId: winnerId })
    .where(
      and(eq(callLog.organizationId, ctx.organizationId), inArray(callLog.contactId, loserIds)),
    )

  // P3 (C7) — relink meetings + SMS messages. The C6a schema added
  // both tables with `contact_id` FKs to contacts; without these
  // updates the activity feed loses entries when a contact is
  // soft-deleted via merge.
  await db
    .update(meetings)
    .set({ contactId: winnerId })
    .where(
      and(eq(meetings.organizationId, ctx.organizationId), inArray(meetings.contactId, loserIds)),
    )
  await db
    .update(smsMessages)
    .set({ contactId: winnerId })
    .where(
      and(
        eq(smsMessages.organizationId, ctx.organizationId),
        inArray(smsMessages.contactId, loserIds),
      ),
    )

  await db
    .update(opportunities)
    .set({ contactId: winnerId })
    .where(
      and(
        eq(opportunities.organizationId, ctx.organizationId),
        inArray(opportunities.contactId, loserIds),
      ),
    )

  await db
    .update(paymentInstallments)
    .set({ billingContactId: winnerId })
    .where(
      and(
        eq(paymentInstallments.organizationId, ctx.organizationId),
        inArray(paymentInstallments.billingContactId, loserIds),
      ),
    )

  await db
    .update(projects)
    .set({ referredByContactId: winnerId })
    .where(
      and(
        eq(projects.organizationId, ctx.organizationId),
        inArray(projects.referredByContactId, loserIds),
      ),
    )

  await db
    .update(contacts)
    .set({ referredByContactId: winnerId })
    .where(
      and(
        eq(contacts.organizationId, ctx.organizationId),
        inArray(contacts.referredByContactId, loserIds),
      ),
    )
  await db
    .update(contacts)
    .set({ referredByContactId: null })
    .where(
      and(
        eq(contacts.organizationId, ctx.organizationId),
        eq(contacts.id, winnerId),
        eq(contacts.referredByContactId, winnerId),
      ),
    )

  // Loser soft-delete already happened above (see P3 C4 comment) so
  // the winner UPDATE could pass the partial unique constraints.

  // P3 (C7 / polish #5 Fix 8) — bust the winner's AI cache. The
  // newly-relinked activities + the merged field values invalidate
  // any cached classifier output / summary / insights. The next
  // page render auto-regens with fresh facts.
  await invalidateContactAiCache(db, ctx.organizationId, winnerId)

  return { winnerId, mergedFromIds: loserIds }
}

// ─── Company merge ─────────────────────────────────────────────────────

export async function executeCompanyMerge(
  db: DbHandle,
  ctx: MergeExecutionContext,
  input: MergeCompaniesInput,
): Promise<{ winnerId: string; mergedFromIds: string[] }> {
  const { winnerId, loserIds, fieldChoices } = input
  validateInput(winnerId, loserIds)
  const allIds = [winnerId, ...loserIds]

  const locked = await db
    .select()
    .from(companies)
    .where(
      and(
        eq(companies.organizationId, ctx.organizationId),
        isNull(companies.deletedAt),
        inArray(companies.id, allIds),
      ),
    )
    .for("update")
  if (locked.length !== allIds.length) {
    throw new ActionError(
      "NOT_FOUND",
      "One or more companies in the merge no longer exist or have been deleted.",
    )
  }
  const winner = locked.find((r) => r.id === winnerId)
  if (!winner) throw new ActionError("NOT_FOUND", "Winner company missing.")
  const losers = locked.filter((r) => r.id !== winnerId)
  const losersById = new Map(losers.map((l) => [l.id, l.customFields]))

  const merged = {
    name: pickFieldValue("name", "name", winner, losers, fieldChoices),
    website: pickFieldValue("website", "website", winner, losers, fieldChoices),
    mainPhone: pickFieldValue("mainPhone", "mainPhone", winner, losers, fieldChoices),
    instagramHandle: pickFieldValue(
      "instagramHandle",
      "instagramHandle",
      winner,
      losers,
      fieldChoices,
    ),
    category: pickFieldValue("category", "category", winner, losers, fieldChoices),
  }
  const mergedCustom = mergeCustomFieldsJsonb(
    winner.customFields ?? null,
    losersById,
    winnerId,
    fieldChoices,
  )
  const oldestCreatedAt = pickOldestDate(locked)

  const existingMerged: string[] = Array.isArray(winner.mergedRecordIds)
    ? winner.mergedRecordIds
    : []
  const newMergedRecordIds = [...existingMerged, ...loserIds]

  await audit(
    {
      db,
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    "companies.merged",
    {
      resourceType: "company",
      resourceId: winnerId,
      metadata: {
        winnerId,
        loserIds,
        fieldChoices,
        oldestCreatedAtPreserved: oldestCreatedAt.toISOString(),
      },
    },
  )

  // companies_org_name_uidx partial-unique on (org, name) WHERE
  // deleted_at IS NULL — if winner adopts a loser's name, soft-delete
  // the losers FIRST so the unique-on-name doesn't trip.
  const nameWinningId = fieldChoices.name ?? winnerId
  const adoptingLoserName = nameWinningId !== winnerId

  if (adoptingLoserName) {
    await db
      .update(companies)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId })
      .where(and(eq(companies.organizationId, ctx.organizationId), inArray(companies.id, loserIds)))
  }

  await db
    .update(companies)
    .set({
      ...merged,
      customFields: mergedCustom,
      mergedRecordIds: newMergedRecordIds,
      createdAt: oldestCreatedAt,
      updatedAt: new Date(),
      updatedBy: ctx.userId,
    })
    .where(eq(companies.id, winnerId))

  await db
    .update(contacts)
    .set({ companyId: winnerId })
    .where(
      and(eq(contacts.organizationId, ctx.organizationId), inArray(contacts.companyId, loserIds)),
    )

  await db.delete(contactCompanyAssociations).where(
    and(
      eq(contactCompanyAssociations.organizationId, ctx.organizationId),
      inArray(contactCompanyAssociations.companyId, loserIds),
      sql`(${contactCompanyAssociations.contactId}, COALESCE(${contactCompanyAssociations.role}, '')) IN (
          SELECT contact_id, COALESCE(role, '')
          FROM contact_company_associations
          WHERE organization_id = ${ctx.organizationId}
            AND company_id = ${winnerId}
        )`,
    ),
  )
  await db
    .update(contactCompanyAssociations)
    .set({ companyId: winnerId })
    .where(
      and(
        eq(contactCompanyAssociations.organizationId, ctx.organizationId),
        inArray(contactCompanyAssociations.companyId, loserIds),
      ),
    )

  if (!adoptingLoserName) {
    await db
      .update(companies)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId })
      .where(and(eq(companies.organizationId, ctx.organizationId), inArray(companies.id, loserIds)))
  }

  return { winnerId, mergedFromIds: loserIds }
}
