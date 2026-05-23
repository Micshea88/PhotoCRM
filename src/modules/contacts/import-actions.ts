"use server"

import { revalidatePath } from "next/cache"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { z } from "zod"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { contacts } from "./schema"
import {
  CSV_MAX_ROWS,
  IMPORTABLE_FIELDS,
  normalizePhone,
  type ImportableField,
} from "./import-spec"
import { contactTypeSchema, lifecycleStatusSchema } from "./types"

/**
 * Push 2c — CSV import. Two-step server contract:
 *
 *   1. previewContactsImport(rows) → returns dedupe info for each row so
 *      the wizard preview step can show "this looks like the existing
 *      contact X" + propose a default action.
 *   2. runContactsImport(rows + per-row action) → executes. Returns per-
 *      row success / error, capped at CSV_MAX_ROWS rows total.
 *
 * Both actions are scoped via orgAction so RLS is enforced + audit-ctx
 * flows automatically.
 *
 * The "rows" payload shape is generic — fields are passed through as
 * keyed by IMPORTABLE_FIELDS. This avoids a wire schema explosion as
 * we add fields.
 */

type ImportRowValues = Partial<Record<ImportableField, string>>
const importableFieldsSet = new Set<string>(IMPORTABLE_FIELDS)

// Values are a partial map keyed by ImportableField. Zod's record-with-
// enum-key infers Record<Enum, T> (all keys required), which doesn't
// match the actual partial shape. We accept loose string→string here +
// filter unknown keys in pickValues.
const importRowSchema = z.object({
  rowIndex: z.number().int().min(1),
  values: z.record(z.string(), z.string()),
})

const previewInput = z.object({
  rows: z.array(importRowSchema).max(CSV_MAX_ROWS),
})

const runInput = z.object({
  rows: z
    .array(
      importRowSchema.extend({
        action: z.enum(["create", "update", "skip"]),
        matchedContactId: z.string().nullable().optional(),
      }),
    )
    .max(CSV_MAX_ROWS),
})

export const previewContactsImport = orgAction
  .metadata({ actionName: "contacts.import.preview" })
  .inputSchema(previewInput)
  .action(async ({ parsedInput, ctx }) => {
    if (parsedInput.rows.length === 0) {
      return { rows: [] }
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

    // Lookup existing contacts that match either side. RLS scopes to org.
    const emailList = [...emails]
    const phoneList = [...phones]
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
          // Either email match (case-insensitive) OR phone match (digits-only).
          // Drizzle's array binding doesn't support empty arrays, so we
          // skip the predicate if a side is empty.
          emailList.length > 0 || phoneList.length > 0
            ? sql`(${
                emailList.length > 0
                  ? sql`LOWER(${contacts.primaryEmail}) = ANY(${emailList}::text[])`
                  : sql`false`
              } OR ${
                phoneList.length > 0
                  ? sql`REGEXP_REPLACE(COALESCE(${contacts.primaryPhone}, ''), '\\D', '', 'g') = ANY(${phoneList}::text[])`
                  : sql`false`
              })`
            : sql`false`,
        ),
      )

    const byEmail = new Map<string, (typeof matches)[number]>()
    const byPhone = new Map<string, (typeof matches)[number]>()
    for (const m of matches) {
      if (m.primaryEmail) byEmail.set(m.primaryEmail.toLowerCase(), m)
      const phone = normalizePhone(m.primaryPhone)
      if (phone) byPhone.set(phone, m)
    }

    return {
      rows: parsedInput.rows.map((r) => {
        const email = (r.values.primaryEmail ?? "").trim().toLowerCase()
        const phone = normalizePhone(r.values.primaryPhone)
        const emailMatch = email ? (byEmail.get(email) ?? null) : null
        const phoneMatch = phone ? (byPhone.get(phone) ?? null) : null
        // Email match takes precedence over phone.
        const match = emailMatch ?? phoneMatch
        const proposedAction: "create" | "update" | "skip" = match ? "update" : "create"
        return {
          rowIndex: r.rowIndex,
          matchedContactId: match?.id ?? null,
          matchedContactName: match ? `${match.firstName} ${match.lastName}` : null,
          proposedAction,
        }
      }),
    }
  })

interface PerRowResult {
  rowIndex: number
  ok: boolean
  contactId?: string
  error?: string
}

function pickValues(rawValues: Record<string, string>): Partial<typeof contacts.$inferInsert> {
  // Drop any keys the import wizard shouldn't have sent. The wizard is
  // the only caller, but defense-in-depth — the action layer is the
  // RLS-trusted boundary.
  const values: ImportRowValues = {}
  for (const [k, v] of Object.entries(rawValues)) {
    if (importableFieldsSet.has(k)) {
      values[k as ImportableField] = v
    }
  }
  const out: Partial<typeof contacts.$inferInsert> = {}
  if (values.firstName) out.firstName = values.firstName
  if (values.lastName) out.lastName = values.lastName
  if (values.primaryEmail) out.primaryEmail = values.primaryEmail
  if (values.primaryPhone) out.primaryPhone = values.primaryPhone
  if (values.secondaryEmail) out.secondaryEmail = values.secondaryEmail
  if (values.secondaryPhone) out.secondaryPhone = values.secondaryPhone
  if (values.leadSource) out.leadSource = values.leadSource
  if (values.sourceDetail) out.sourceDetail = values.sourceDetail
  if (values.notes) out.notes = values.notes
  if (values.website) out.website = values.website
  if (values.instagramHandle) out.instagramHandle = values.instagramHandle
  if (values.contactType) {
    const r = contactTypeSchema.safeParse(values.contactType)
    if (r.success) out.contactType = r.data
  }
  if (values.lifecycleStatus) {
    const r = lifecycleStatusSchema.safeParse(values.lifecycleStatus)
    if (r.success) out.lifecycleStatus = r.data
  }
  if (values.tags) {
    const parts = values.tags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && t.length <= 80)
    if (parts.length > 0) out.tags = parts
  }
  return out
}

export const runContactsImport = orgAction
  .metadata({ actionName: "contacts.import.run" })
  .inputSchema(runInput)
  .action(async ({ parsedInput, ctx }) => {
    if (parsedInput.rows.length === 0) {
      return { results: [], successCount: 0, errorCount: 0 }
    }

    // Pre-resolve the set of matchedContactIds we need for "update" so a
    // bogus client-side id can't trick us into updating a contact in
    // another org (RLS is the real gate; this is a friendlier error).
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
      const patch = pickValues(r.values)
      try {
        if (r.action === "create") {
          if (!patch.firstName || !patch.lastName) {
            throw new ActionError(
              "VALIDATION",
              "firstName and lastName are required to create a contact",
            )
          }
          const id = createId()
          await ctx.db.insert(contacts).values({
            id,
            organizationId: ctx.activeOrg.id,
            firstName: patch.firstName,
            lastName: patch.lastName,
            primaryEmail: patch.primaryEmail ?? null,
            primaryPhone: patch.primaryPhone ?? null,
            secondaryEmail: patch.secondaryEmail ?? null,
            secondaryPhone: patch.secondaryPhone ?? null,
            leadSource: patch.leadSource ?? null,
            sourceDetail: patch.sourceDetail ?? null,
            notes: patch.notes ?? null,
            website: patch.website ?? null,
            instagramHandle: patch.instagramHandle ?? null,
            contactType: patch.contactType ?? null,
            lifecycleStatus: patch.lifecycleStatus ?? null,
            tags: patch.tags ?? null,
            ownerUserId: ctx.session.user.id,
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
