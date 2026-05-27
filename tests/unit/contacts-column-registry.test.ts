/**
 * Push 2c.6 — column registry expansion contract.
 *
 * The Edit columns drawer reads CONTACT_COLUMN_REGISTRY. New column
 * defs added to the registry surface to existing users via
 * resolveContactColumns, which appends unknown registry ids as
 * visible: false. The pre-existing 10 column ids must remain
 * present + identically labeled so saved_views.column_config entries
 * already in the DB don't drop or rename their columns.
 */

import { describe, it, expect } from "vitest"
import {
  CONTACT_COLUMN_REGISTRY,
  DEFAULT_CONTACT_COLUMNS,
  resolveContactColumns,
  type ColumnConfigItem,
  type ContactRow,
} from "@/modules/contacts/ui/columns"

const PRE_EXISTING_IDS = [
  "displayLabel",
  "firstName",
  "lastName",
  "primaryEmail",
  "primaryPhone",
  "contactType",
  "lifecycleStatus",
  "tags",
  "companyName",
  "createdAt",
] as const

const NEW_IDS_PUSH_2C_6 = [
  "secondaryEmail",
  "secondaryPhone",
  "mailingCity",
  "mailingState",
  "mailingZip",
  "dob",
  "anniversaryDate",
  "instagramHandle",
  "facebookUrl",
  "website",
  "leadSource",
  "sourceDetail",
  "ownerName",
  "updatedAt",
  "notes",
] as const

function makeRow(overrides: Partial<ContactRow> = {}): ContactRow {
  return {
    id: "c1",
    firstName: "Jane",
    lastName: "Doe",
    primaryEmail: null,
    primaryPhone: null,
    contactType: null,
    lifecycleStatus: null,
    tags: null,
    companyName: null,
    createdAt: "2026-05-20T00:00:00.000Z",
    secondaryEmail: null,
    secondaryPhone: null,
    mailingCity: null,
    mailingState: null,
    mailingZip: null,
    dob: null,
    anniversaryDate: null,
    instagramHandle: null,
    facebookUrl: null,
    website: null,
    leadSource: null,
    sourceDetail: null,
    ownerName: null,
    updatedAt: null,
    notes: null,
    customFields: null,
    ...overrides,
  }
}

describe("CONTACT_COLUMN_REGISTRY (Push 2c.6 expansion)", () => {
  it("retains all 10 pre-existing column ids", () => {
    for (const id of PRE_EXISTING_IDS) {
      expect(CONTACT_COLUMN_REGISTRY[id], `missing id: ${id}`).toBeDefined()
    }
  })

  it("registers all 15 new Push 2c.6 column ids", () => {
    for (const id of NEW_IDS_PUSH_2C_6) {
      expect(CONTACT_COLUMN_REGISTRY[id], `missing new id: ${id}`).toBeDefined()
    }
  })

  it("does not include any unexpected column ids", () => {
    const expected = new Set<string>([...PRE_EXISTING_IDS, ...NEW_IDS_PUSH_2C_6])
    for (const id of Object.keys(CONTACT_COLUMN_REGISTRY)) {
      expect(expected.has(id), `unexpected id: ${id}`).toBe(true)
    }
  })

  it("preserves DEFAULT_CONTACT_COLUMNS exactly (existing All Contacts shape)", () => {
    expect(DEFAULT_CONTACT_COLUMNS).toEqual([
      "displayLabel",
      "primaryEmail",
      "primaryPhone",
      "contactType",
      "lifecycleStatus",
      "tags",
    ])
  })
})

describe("resolveContactColumns backward compat", () => {
  it("appends new registry ids as visible: false when the saved config predates them", () => {
    // Simulate a saved view created before Push 2c.6 — contains only
    // the 6 default ids, all visible, in order.
    const saved: ColumnConfigItem[] = DEFAULT_CONTACT_COLUMNS.map((id, i) => ({
      id,
      visible: true,
      order: i,
      width: null,
    }))

    const { visible, all } = resolveContactColumns(saved)

    // Visible set is unchanged — exactly the 6 defaults, in order.
    expect(visible.map((d) => d.id)).toEqual(DEFAULT_CONTACT_COLUMNS)

    // `all` includes every registry id; the new ones are appended
    // with visible: false at the end.
    const allIds = all.map((c) => c.id)
    for (const id of [...PRE_EXISTING_IDS, ...NEW_IDS_PUSH_2C_6]) {
      expect(allIds, `missing id in resolved 'all': ${id}`).toContain(id)
    }
    for (const newId of NEW_IDS_PUSH_2C_6) {
      const entry = all.find((c) => c.id === newId)
      expect(entry?.visible, `new column ${newId} must default to visible: false`).toBe(false)
    }
  })

  it("renders every new column without throwing on a null-heavy row", () => {
    const row = makeRow()
    for (const id of NEW_IDS_PUSH_2C_6) {
      const def = CONTACT_COLUMN_REGISTRY[id]
      if (!def) throw new Error(`registry missing id: ${id}`)
      expect(typeof def.render(row)).toBe("string")
      expect(typeof def.measureText(row)).toBe("string")
    }
  })

  it("formats secondaryPhone via formatPhoneDisplay (matches primary)", () => {
    const row = makeRow({ primaryPhone: "5551234567", secondaryPhone: "5559876543" })
    const primary = registryDef("primaryPhone").render(row)
    const secondary = registryDef("secondaryPhone").render(row)
    // Both go through the same formatter — different numbers, same
    // shape. Just assert the secondary cell ISN'T the raw digits.
    expect(primary).not.toBe("5551234567")
    expect(secondary).not.toBe("5559876543")
  })

  it("collapses multi-line notes into a single line for the Notes column", () => {
    const row = makeRow({ notes: "Line one.\n\nLine two." })
    expect(registryDef("notes").render(row)).toBe("Line one. Line two.")
  })

  it("renders dob and anniversaryDate as YYYY-MM-DD pass-through", () => {
    const row = makeRow({ dob: "1990-04-15", anniversaryDate: "2015-09-21" })
    expect(registryDef("dob").render(row)).toBe("1990-04-15")
    expect(registryDef("anniversaryDate").render(row)).toBe("2015-09-21")
  })

  it("renders updatedAt as YYYY-MM-DD slice (matches createdAt format)", () => {
    const row = makeRow({ updatedAt: "2026-05-23T15:14:13.000Z" })
    expect(registryDef("updatedAt").render(row)).toBe("2026-05-23")
  })

  it("renders ownerName from the row, falling back to empty string", () => {
    expect(registryDef("ownerName").render(makeRow({ ownerName: "Mike Kelly" }))).toBe("Mike Kelly")
    expect(registryDef("ownerName").render(makeRow())).toBe("")
  })
})

describe("displayLabel column (Push 4 hotfix v2)", () => {
  it("renders bare first + last name — NOT the picker-style 'Name — email' form", () => {
    const def = registryDef("displayLabel")
    expect(
      def.render(
        makeRow({ firstName: "Ada", lastName: "Lovelace", primaryEmail: "ada@example.com" }),
      ),
    ).toBe("Ada Lovelace")
  })

  it("trims trailing whitespace when one name component is empty", () => {
    const def = registryDef("displayLabel")
    expect(def.render(makeRow({ firstName: "Ada", lastName: "" }))).toBe("Ada")
    expect(def.render(makeRow({ firstName: "", lastName: "Lovelace" }))).toBe("Lovelace")
  })

  it("falls back to em-dash when both name parts are empty", () => {
    const def = registryDef("displayLabel")
    expect(def.render(makeRow({ firstName: "", lastName: "" }))).toBe("—")
  })

  it("measureText returns the same string as render (auto-fit accuracy)", () => {
    const def = registryDef("displayLabel")
    const row = makeRow({ firstName: "Ada", lastName: "Lovelace" })
    expect(def.measureText(row)).toBe(def.render(row))
  })
})

function registryDef(id: string) {
  const def = CONTACT_COLUMN_REGISTRY[id]
  if (!def) throw new Error(`registry missing id: ${id}`)
  return def
}
