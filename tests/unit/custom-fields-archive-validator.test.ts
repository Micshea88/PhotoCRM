import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { CustomFieldDefinition } from "@/modules/custom-fields/schema"
import type { FieldType } from "@/modules/custom-fields/types"
import {
  ArchivedFieldUpdateError,
  validateCustomFieldsPayloadWithArchive,
} from "@/modules/custom-fields/validators"

function def(
  fieldType: FieldType,
  opts: Partial<CustomFieldDefinition> = {},
): CustomFieldDefinition {
  return {
    id: createId(),
    organizationId: createId(),
    recordType: "contact",
    name: opts.name ?? "Test",
    fieldType,
    options: opts.options ?? null,
    folder: null,
    order: 0,
    required: false,
    formula: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    deletedBy: null,
    archivedAt: null,
    archivedBy: null,
  }
}

describe("validateCustomFieldsPayloadWithArchive — create mode", () => {
  it("silently drops keys for archived definitions", () => {
    const active = def("text", { name: "Allergies" })
    const archived = def("text", { name: "OldField" })
    const result = validateCustomFieldsPayloadWithArchive(
      new Map([[active.id, active]]),
      new Map([[archived.id, archived]]),
      { [active.id]: "peanuts", [archived.id]: "should be dropped" },
      "create",
    )
    expect(result).toEqual({ [active.id]: "peanuts" })
  })

  it("silently drops unknown keys via onUnknownKey callback", () => {
    const active = def("text")
    const orphan = createId()
    let warned = ""
    const result = validateCustomFieldsPayloadWithArchive(
      new Map([[active.id, active]]),
      new Map(),
      { [active.id]: "hi", [orphan]: "ghost" },
      "create",
      { onUnknownKey: (id) => (warned = id) },
    )
    expect(result).toEqual({ [active.id]: "hi" })
    expect(warned).toBe(orphan)
  })
})

describe("validateCustomFieldsPayloadWithArchive — update mode", () => {
  it("throws ArchivedFieldUpdateError on archived key in payload", () => {
    const active = def("text")
    const archived = def("text", { name: "OldField" })
    expect(() => {
      validateCustomFieldsPayloadWithArchive(
        new Map([[active.id, active]]),
        new Map([[archived.id, archived]]),
        { [archived.id]: "trying to change archived" },
        "update",
      )
    }).toThrow(ArchivedFieldUpdateError)
  })

  it("includes the field name in the error message", () => {
    const archived = def("text", { name: "Discontinued Field" })
    try {
      validateCustomFieldsPayloadWithArchive(
        new Map(),
        new Map([[archived.id, archived]]),
        { [archived.id]: "v" },
        "update",
      )
      throw new Error("should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(ArchivedFieldUpdateError)
      expect((e as Error).message).toContain("Discontinued Field")
      expect((e as Error).message).toContain("archived")
    }
  })

  it("passes through active-only entries when no archived keys present", () => {
    const active = def("text", { name: "Allergies" })
    const archived = def("text", { name: "OldField" })
    const result = validateCustomFieldsPayloadWithArchive(
      new Map([[active.id, active]]),
      new Map([[archived.id, archived]]),
      { [active.id]: "peanuts" },
      "update",
    )
    expect(result).toEqual({ [active.id]: "peanuts" })
  })

  it("validates active values per type and throws on malformed", () => {
    const numberDef = def("number")
    expect(() => {
      validateCustomFieldsPayloadWithArchive(
        new Map([[numberDef.id, numberDef]]),
        new Map(),
        { [numberDef.id]: "not a number" },
        "create",
      )
    }).toThrow()
  })
})
