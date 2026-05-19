import { sql } from "drizzle-orm"
import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"

/**
 * Custom field DEFINITIONS. Values live in each host table's
 * `custom_fields jsonb` column, keyed by this row's `id` (cuid2).
 *
 * Build Spec §2 lists `(id, organization_id, record_type, name, field_type,
 * options jsonb, folder, order, required, formula)`. This implementation
 * adds the standard lifecycle columns (created/updated/deleted by/at), as
 * required by every app table.
 *
 * Field type is `text` (not a pg enum). Pg enums require migrations to add
 * values; field-type expansion is a soft requirement (e.g., adding "address"
 * later). The 18 V1 values are validated app-side via the Zod enum in
 * `types.ts`.
 *
 * Uniqueness: (organization_id, record_type, name) WHERE deleted_at IS NULL.
 * Partial so deleting a field and recreating one with the same name works.
 */
export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    recordType: text("record_type").notNull(),
    name: text("name").notNull(),
    fieldType: text("field_type").notNull(),
    // For single_select/multi_select/radio: { choices: [{value, label}] }.
    // For other types: typically null (file/image use this to pin mimes; future).
    options: jsonb("options").$type<Record<string, unknown>>(),
    folder: text("folder"),
    order: integer("order").notNull().default(0),
    required: boolean("required").notNull().default(false),
    // Formula expression as text. Evaluator deferred to Phase 4 stretch
    // (STEP 2 Q8). Storing the source here now means future migration is
    // additive (evaluator + compiled cache) and the schema doesn't move.
    formula: text("formula"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("custom_field_definitions_org_record_name_uidx")
      .on(t.organizationId, t.recordType, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    index("custom_field_definitions_org_record_order_idx").on(
      t.organizationId,
      t.recordType,
      t.deletedAt,
      t.order,
    ),
  ],
)

export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect
export type NewCustomFieldDefinition = typeof customFieldDefinitions.$inferInsert
