"use server"

import { revalidatePath } from "next/cache"
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { z } from "zod"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { member, user } from "@/modules/auth/schema"
import { companies } from "@/modules/companies/schema"
import { contacts } from "./schema"
import {
  CSV_MAX_ROWS,
  IMPORTABLE_FIELDS,
  normalizePhone,
  parseTagsCell,
  type ImportableField,
} from "./import-spec"

/**
 * Push 2c / 2c.1 — CSV import. Two-step server contract:
 *
 *   1. previewContactsImport(rows) → returns per-row dedupe info +
 *      surfaces the org-member emails so the wizard's "Use the column
 *      from the CSV" owner mode can show a quick "X of Y emails will
 *      resolve" hint at preview time (no per-row roundtrip).
 *   2. runContactsImport(rows + per-row action + bulk-owner mode +
 *      bulk-tag list + error-mode toggle) → executes. Returns per-row
 *      success / error, capped at CSV_MAX_ROWS.
 *
 * Both actions are scoped via orgAction so RLS is enforced + audit-ctx
 * flows automatically.
 */

type ImportRowValues = Partial<Record<ImportableField, string>>
const importableFieldsSet = new Set<string>(IMPORTABLE_FIELDS)

const importRowSchema = z.object({
  rowIndex: z.number().int().min(1),
  values: z.record(z.string(), z.string()),
})

const previewInput = z.object({
  rows: z.array(importRowSchema).max(CSV_MAX_ROWS),
})

const ownerModeEnum = z.enum(["self", "specific", "from_csv"])

// Push 2c.3 — `errorMode` (skip vs stop) removed from the input
// schema. The wizard always skips error rows now; HubSpot doesn't
// expose this choice and it bloated the Preview-step UX without
// real user value. Any old callers still sending the field hit
// Zod's "unknown key" strip (z.object is strict-stripping by
// default).
const runInput = z.object({
  rows: z
    .array(
      importRowSchema.extend({
        action: z.enum(["create", "update", "skip"]),
        matchedContactId: z.string().nullable().optional(),
      }),
    )
    .max(CSV_MAX_ROWS),
  ownerMode: ownerModeEnum.default("self"),
  ownerUserId: z.string().min(1).nullable().optional(),
  applyTags: z.array(z.string().min(1).max(80)).max(32).optional(),
})

export const previewContactsImport = orgAction
  .metadata({ actionName: "contacts.import.preview" })
  .inputSchema(previewInput)
  .action(async ({ parsedInput, ctx }) => {
    if (parsedInput.rows.length === 0) {
      return { rows: [], orgMemberEmails: [] }
    }

    // Build the sets of (email, phone-digits) we'll need to look up.
    const emails = new Set<string>()
    const phones = new Set<string>()
    for (const r of parsedInput.rows) {
      const email = (r.values.primaryEmail ?? "").trim().toLowerCase()
      if (email) emails.add(email)
      const phone = normalizePhone(r.values.primaryPhone)
      if (phone) phones.add(phone)
    }

    const emailList = [...emails]
    const phoneList = [...phones]
    // Build the dedupe predicate with Drizzle's `inArray` helper.
    // Earlier (Push 2c) this used a hand-rolled `= ANY(${arr}::text[])`
    // template which Drizzle expands into `($2, $3, ...)::text[]` —
    // PG rejects that as "cannot cast type record to text[]". A
    // single-row import slipped past every test until 2c.1's
    // production trace surfaced it. `inArray` produces `col IN ($1, ...)`
    // which PG accepts.
    const orParts: SQL[] = []
    if (emailList.length > 0) {
      orParts.push(inArray(sql`LOWER(${contacts.primaryEmail})`, emailList))
    }
    if (phoneList.length > 0) {
      orParts.push(
        inArray(
          sql`REGEXP_REPLACE(COALESCE(${contacts.primaryPhone}, ''), '\\D', '', 'g')`,
          phoneList,
        ),
      )
    }
    // If nothing to match against, return no matches — but still keep
    // the predicate well-formed so Drizzle emits a valid query.
    const matchPredicate = orParts.length > 0 ? or(...orParts) : sql`false`
    const matches = await ctx.db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        primaryEmail: contacts.primaryEmail,
        primaryPhone: contacts.primaryPhone,
      })
      .from(contacts)
      .where(
        and(
          eq(contacts.organizationId, ctx.activeOrg.id),
          isNull(contacts.deletedAt),
          isNull(contacts.archivedAt),
          matchPredicate,
        ),
      )

    const byEmail = new Map<string, (typeof matches)[number]>()
    const byPhone = new Map<string, (typeof matches)[number]>()
    for (const m of matches) {
      if (m.primaryEmail) byEmail.set(m.primaryEmail.toLowerCase(), m)
      const phone = normalizePhone(m.primaryPhone)
      if (phone) byPhone.set(phone, m)
    }

    // Surface the org-member emails so the wizard can validate the
    // "Use the column from the CSV" owner mode upfront. We only return
    // lowercased emails — the wizard uses them as a Set for lookup.
    const orgMembers = await ctx.db
      .select({ email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, ctx.activeOrg.id))

    return {
      rows: parsedInput.rows.map((r) => {
        const email = (r.values.primaryEmail ?? "").trim().toLowerCase()
        const phone = normalizePhone(r.values.primaryPhone)
        const emailMatch = email ? (byEmail.get(email) ?? null) : null
        const phoneMatch = phone ? (byPhone.get(phone) ?? null) : null
        const match = emailMatch ?? phoneMatch
        const proposedAction: "create" | "update" | "skip" = match ? "update" : "create"
        return {
          rowIndex: r.rowIndex,
          matchedContactId: match?.id ?? null,
          matchedContactName: match ? `${match.firstName} ${match.lastName}` : null,
          proposedAction,
        }
      }),
      orgMemberEmails: orgMembers.map((m) => m.email.toLowerCase()),
    }
  })

interface PerRowResult {
  rowIndex: number
  ok: boolean
  contactId?: string
  error?: string
}

function pickValuesCore(rawValues: Record<string, string>): ImportRowValues {
  // Drop any keys the import wizard shouldn't have sent. The wizard is
  // the only caller, but defense-in-depth — the action layer is the
  // RLS-trusted boundary.
  const values: ImportRowValues = {}
  for (const [k, v] of Object.entries(rawValues)) {
    if (importableFieldsSet.has(k)) {
      values[k as ImportableField] = v
    }
  }
  return values
}

interface BulkContext {
  /** Map of lowercased company name → companyId for the active org. */
  companiesByName: Map<string, string>
  /** Map of lowercased member email → userId for the active org. */
  membersByEmail: Map<string, string>
  /** Bulk tags applied to every row regardless of per-row tags column. */
  applyTags: string[]
}

/**
 * Build the patch sent to insert / update for one row, merging the
 * row's values with the bulk-import context (company name resolution,
 * mailing jsonb assembly, bulk-tag union).
 *
 * Per-row owner resolution is NOT done here — runContactsImport handles
 * the ownerMode branch (self / specific / from-csv) inline so the
 * "from_csv" miss path can route to a row-level error rather than
 * silently dropping ownership.
 */
function buildPatch(
  values: ImportRowValues,
  bulk: BulkContext,
): { patch: Partial<typeof contacts.$inferInsert>; warnings: string[] } {
  const patch: Partial<typeof contacts.$inferInsert> = {}
  const warnings: string[] = []

  if (values.firstName) patch.firstName = values.firstName
  if (values.lastName) patch.lastName = values.lastName
  // firstName defaults to "Unknown" when only lastName / email provided
  // so the NOT NULL constraint on the column doesn't reject the row.
  // (The wizard already emitted a warning for this case.)
  if (!patch.firstName && (values.lastName || values.primaryEmail)) {
    patch.firstName = "Unknown"
  }
  if (!patch.lastName && values.primaryEmail && !values.lastName) {
    // Same fallback for last name when only email is provided.
    patch.lastName = "Unknown"
  }
  if (values.primaryEmail) patch.primaryEmail = values.primaryEmail
  if (values.primaryPhone) patch.primaryPhone = values.primaryPhone
  if (values.secondaryEmail) patch.secondaryEmail = values.secondaryEmail
  if (values.secondaryPhone) patch.secondaryPhone = values.secondaryPhone
  if (values.leadSource) patch.leadSource = values.leadSource
  if (values.sourceDetail) patch.sourceDetail = values.sourceDetail
  if (values.notes) patch.notes = values.notes
  if (values.website) patch.website = values.website
  if (values.instagramHandle) patch.instagramHandle = values.instagramHandle
  if (values.contactType) patch.contactType = values.contactType
  if (values.lifecycleStatus) patch.lifecycleStatus = values.lifecycleStatus

  // Company by name — soft match (case-insensitive). Unknown company
  // names surface a warning and the row imports without a companyId
  // (no auto-create — that would silently inflate the company list).
  if (values.companyName) {
    const lookup = bulk.companiesByName.get(values.companyName.toLowerCase())
    if (lookup) {
      patch.companyId = lookup
    } else {
      warnings.push(`Company "${values.companyName}" not found — imported without company link`)
    }
  }

  // Mailing fields → mailing_address jsonb. Only include keys the
  // user actually mapped.
  const mailing: Record<string, string> = {}
  if (values.mailingStreet) mailing.street1 = values.mailingStreet
  if (values.mailingCity) mailing.city = values.mailingCity
  if (values.mailingState) mailing.state = values.mailingState.toUpperCase()
  if (values.mailingPostalCode) mailing.zip = values.mailingPostalCode
  if (Object.keys(mailing).length > 0) {
    patch.mailingAddress = mailing
  }

  // Tags — union of per-row tags + bulk-apply tags. Deduped + cased
  // as-received.
  const tagSet = new Set<string>()
  if (values.tags) {
    for (const t of parseTagsCell(values.tags)) tagSet.add(t)
  }
  for (const t of bulk.applyTags) tagSet.add(t)
  if (tagSet.size > 0) patch.tags = [...tagSet]

  return { patch, warnings }
}

async function loadBulkContext(
  ctx: Parameters<Parameters<typeof orgAction.action>[0]>[0]["ctx"],
  parsed: z.infer<typeof runInput>,
): Promise<BulkContext> {
  // Distinct company names from all rows that map one.
  const companyNames = new Set<string>()
  for (const r of parsed.rows) {
    const name = r.values.companyName?.trim().toLowerCase()
    if (name) companyNames.add(name)
  }
  const companiesByName = new Map<string, string>()
  if (companyNames.size > 0) {
    // Same Drizzle `ANY(record)::text[]` trap as the contact-matcher
    // above had — also, `ilike(col, ANY(...))` was nonsensical (ilike
    // takes a single pattern). Use case-insensitive equality via
    // LOWER + inArray. companyNames is already lowercased.
    const rows = await ctx.db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(
        and(
          eq(companies.organizationId, ctx.activeOrg.id),
          isNull(companies.deletedAt),
          inArray(sql`LOWER(${companies.name})`, [...companyNames]),
        ),
      )
    for (const r of rows) companiesByName.set(r.name.toLowerCase(), r.id)
  }

  // Distinct owner emails from from_csv mode.
  const membersByEmail = new Map<string, string>()
  if (parsed.ownerMode === "from_csv") {
    const ownerEmails = new Set<string>()
    for (const r of parsed.rows) {
      const e = r.values.ownerUserId?.trim().toLowerCase()
      if (e) ownerEmails.add(e)
    }
    if (ownerEmails.size > 0) {
      const rows = await ctx.db
        .select({ userId: member.userId, email: user.email })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(
          and(
            eq(member.organizationId, ctx.activeOrg.id),
            inArray(sql`LOWER(${user.email})`, [...ownerEmails]),
          ),
        )
      for (const r of rows) membersByEmail.set(r.email.toLowerCase(), r.userId)
    }
  }

  return {
    companiesByName,
    membersByEmail,
    applyTags: parsed.applyTags ?? [],
  }
}

function resolveRowOwner(
  values: ImportRowValues,
  parsed: z.infer<typeof runInput>,
  bulk: BulkContext,
  fallbackUserId: string,
): { ownerUserId: string | null; error: string | null } {
  if (parsed.ownerMode === "specific") {
    return { ownerUserId: parsed.ownerUserId ?? fallbackUserId, error: null }
  }
  if (parsed.ownerMode === "from_csv") {
    const email = values.ownerUserId?.trim().toLowerCase()
    if (!email) {
      return {
        ownerUserId: null,
        error: "Owner email column is empty for this row",
      }
    }
    const resolved = bulk.membersByEmail.get(email)
    if (!resolved) {
      return {
        ownerUserId: null,
        error: `Owner email "${email}" is not a member of this organization`,
      }
    }
    return { ownerUserId: resolved, error: null }
  }
  // "self"
  return { ownerUserId: fallbackUserId, error: null }
}

export const runContactsImport = orgAction
  .metadata({ actionName: "contacts.import.run" })
  .inputSchema(runInput)
  .action(async ({ parsedInput, ctx }) => {
    if (parsedInput.rows.length === 0) {
      return { results: [], successCount: 0, errorCount: 0 }
    }

    // Validate "specific" owner is actually an org member upfront.
    if (parsedInput.ownerMode === "specific") {
      const targetUserId = parsedInput.ownerUserId ?? ctx.session.user.id
      const [row] = await ctx.db
        .select({ userId: member.userId })
        .from(member)
        .where(and(eq(member.organizationId, ctx.activeOrg.id), eq(member.userId, targetUserId)))
        .limit(1)
      if (!row) {
        throw new ActionError("VALIDATION", "Selected owner is not a member of this organization.")
      }
    }

    const bulk = await loadBulkContext(ctx, parsedInput)

    // Pre-resolve update target ids so a stale client id can't update
    // a row in another org. RLS would catch it but error messages are
    // better when we fail-fast.
    const matchedIds = [
      ...new Set(
        parsedInput.rows
          .filter((r) => r.action === "update" && r.matchedContactId)
          .map((r) => r.matchedContactId)
          .filter((id): id is string => !!id),
      ),
    ]
    const validIds = new Set<string>()
    if (matchedIds.length > 0) {
      const rows = await ctx.db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.organizationId, ctx.activeOrg.id),
            isNull(contacts.deletedAt),
            inArray(contacts.id, matchedIds),
          ),
        )
      for (const r of rows) validIds.add(r.id)
    }

    const results: PerRowResult[] = []
    let successCount = 0
    let errorCount = 0

    for (const r of parsedInput.rows) {
      if (r.action === "skip") {
        results.push({ rowIndex: r.rowIndex, ok: true })
        continue
      }
      const values = pickValuesCore(r.values)
      const ownerResolution = resolveRowOwner(values, parsedInput, bulk, ctx.session.user.id)
      if (ownerResolution.error) {
        results.push({ rowIndex: r.rowIndex, ok: false, error: ownerResolution.error })
        errorCount++
        continue
      }
      const ownerUserId = ownerResolution.ownerUserId ?? ctx.session.user.id
      const { patch } = buildPatch(values, bulk)
      try {
        if (r.action === "create") {
          if (!patch.firstName || !patch.lastName) {
            throw new ActionError("VALIDATION", "Cannot create a contact without a name or email")
          }
          const id = createId()
          await ctx.db.insert(contacts).values({
            id,
            organizationId: ctx.activeOrg.id,
            firstName: patch.firstName,
            lastName: patch.lastName,
            companyId: patch.companyId ?? null,
            primaryEmail: patch.primaryEmail ?? null,
            primaryPhone: patch.primaryPhone ?? null,
            secondaryEmail: patch.secondaryEmail ?? null,
            secondaryPhone: patch.secondaryPhone ?? null,
            mailingAddress: patch.mailingAddress ?? null,
            leadSource: patch.leadSource ?? null,
            sourceDetail: patch.sourceDetail ?? null,
            notes: patch.notes ?? null,
            website: patch.website ?? null,
            instagramHandle: patch.instagramHandle ?? null,
            contactType: patch.contactType ?? null,
            lifecycleStatus: patch.lifecycleStatus ?? null,
            tags: patch.tags ?? null,
            ownerUserId,
            createdBy: ctx.session.user.id,
            updatedBy: ctx.session.user.id,
          })
          await audit(
            {
              db: ctx.db,
              organizationId: ctx.activeOrg.id,
              actorUserId: ctx.session.user.id,
              ipAddress: ctx.ipAddress,
              userAgent: ctx.userAgent,
            },
            "contacts.created",
            {
              resourceType: "contact",
              resourceId: id,
              metadata: { import: true, rowIndex: r.rowIndex },
            },
          )
          results.push({ rowIndex: r.rowIndex, ok: true, contactId: id })
          successCount++
        } else {
          // action === "update"
          if (!r.matchedContactId || !validIds.has(r.matchedContactId)) {
            throw new ActionError("NOT_FOUND", "Match contact no longer exists")
          }
          await ctx.db
            .update(contacts)
            .set({
              ...patch,
              // Owner is updated on bulk-update only when the import
              // ownerMode is "from_csv" (per-row) or "specific" (bulk).
              // "self" mode leaves existing contact owners alone on
              // update to avoid silently reassigning others' contacts.
              ...(parsedInput.ownerMode === "self" ? {} : { ownerUserId }),
              updatedAt: new Date(),
              updatedBy: ctx.session.user.id,
            })
            .where(
              and(
                eq(contacts.id, r.matchedContactId),
                eq(contacts.organizationId, ctx.activeOrg.id),
                isNull(contacts.deletedAt),
              ),
            )
          await audit(
            {
              db: ctx.db,
              organizationId: ctx.activeOrg.id,
              actorUserId: ctx.session.user.id,
              ipAddress: ctx.ipAddress,
              userAgent: ctx.userAgent,
            },
            "contacts.updated",
            {
              resourceType: "contact",
              resourceId: r.matchedContactId,
              metadata: { import: true, rowIndex: r.rowIndex },
            },
          )
          results.push({ rowIndex: r.rowIndex, ok: true, contactId: r.matchedContactId })
          successCount++
        }
      } catch (err) {
        const message =
          err instanceof ActionError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Unknown error"
        results.push({ rowIndex: r.rowIndex, ok: false, error: message })
        errorCount++
      }
    }

    revalidatePath("/contacts")
    return { results, successCount, errorCount }
  })
