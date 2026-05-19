import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { customFieldDefinitions } from "./schema"

/**
 * Definitions for one record type, ordered by the explicit `order` column
 * then alphabetical by name. Soft-deleted rows excluded by default. RLS
 * scopes to the active org; no manual organizationId filter needed.
 *
 * Typical caller: a host module's `actions.ts` validating
 * `custom_fields` payloads against the org's definitions, or an admin UI
 * rendering the field list.
 */
export async function listFieldDefinitionsForRecordType(recordType: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.recordType, recordType),
          isNull(customFieldDefinitions.deletedAt),
        ),
      )
      .orderBy(customFieldDefinitions.order, customFieldDefinitions.name)
  })
}

/**
 * Lookup by id. Used by host-module value validators ("does this jsonb key
 * correspond to a real definition, of the right type?"). Returns null for
 * not-found, including soft-deleted definitions — caller cannot distinguish
 * "never existed" from "deleted," which is the right behavior for value
 * resolution.
 */
export async function getFieldDefinition(id: string) {
  return withOrgContext(async (tx) => {
    const [row] = await tx
      .select()
      .from(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.id, id), isNull(customFieldDefinitions.deletedAt)))
      .limit(1)
    return row ?? null
  })
}
