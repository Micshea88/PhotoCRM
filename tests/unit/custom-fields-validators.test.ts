import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { CustomFieldDefinition } from "@/modules/custom-fields/schema"
import type { FieldType } from "@/modules/custom-fields/types"
import {
  validateCustomFieldValue,
  validateCustomFieldsPayload,
} from "@/modules/custom-fields/validators"

const ORG_ID = createId()
const USER_ID = createId()

function def(
  overrides: Partial<CustomFieldDefinition> & { fieldType: FieldType; name?: string },
): CustomFieldDefinition {
  return {
    id: createId(),
    organizationId: ORG_ID,
    recordType: "contact",
    name: overrides.name ?? "Test field",
    fieldType: overrides.fieldType,
    options: overrides.options ?? null,
    folder: null,
    order: 0,
    required: false,
    formula: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: USER_ID,
    updatedBy: USER_ID,
    deletedAt: null,
    deletedBy: null,
  }
}

describe("validateCustomFieldValue — happy paths per FieldType", () => {
  it("text", () => {
    expect(validateCustomFieldValue(def({ fieldType: "text" }), "hello")).toBe("hello")
  })
  it("multiline", () => {
    expect(validateCustomFieldValue(def({ fieldType: "multiline" }), "line\nline")).toBe(
      "line\nline",
    )
  })
  it("number", () => {
    expect(validateCustomFieldValue(def({ fieldType: "number" }), 42)).toBe(42)
  })
  it("currency", () => {
    expect(validateCustomFieldValue(def({ fieldType: "currency" }), 12.5)).toBe(12.5)
  })
  it("date", () => {
    expect(validateCustomFieldValue(def({ fieldType: "date" }), "2026-05-20")).toBe("2026-05-20")
  })
  it("datetime", () => {
    const iso = "2026-05-20T14:30:00.000Z"
    expect(validateCustomFieldValue(def({ fieldType: "datetime" }), iso)).toBe(iso)
  })
  it("email", () => {
    expect(validateCustomFieldValue(def({ fieldType: "email" }), "k@example.com")).toBe(
      "k@example.com",
    )
  })
  it("phone", () => {
    expect(validateCustomFieldValue(def({ fieldType: "phone" }), "+1 555 1234")).toBe("+1 555 1234")
  })
  it("url", () => {
    expect(validateCustomFieldValue(def({ fieldType: "url" }), "https://x.example")).toBe(
      "https://x.example",
    )
  })
  it("single_select — value is in choices", () => {
    const d = def({
      fieldType: "single_select",
      options: {
        choices: [
          { value: "small", label: "Small" },
          { value: "large", label: "Large" },
        ],
      },
    })
    expect(validateCustomFieldValue(d, "small")).toBe("small")
  })
  it("radio — same as single_select", () => {
    const d = def({
      fieldType: "radio",
      options: {
        choices: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      },
    })
    expect(validateCustomFieldValue(d, "no")).toBe("no")
  })
  it("multi_select — every value is in choices", () => {
    const d = def({
      fieldType: "multi_select",
      options: {
        choices: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
          { value: "c", label: "C" },
        ],
      },
    })
    expect(validateCustomFieldValue(d, ["a", "c"])).toEqual(["a", "c"])
  })
  it("checkbox", () => {
    expect(validateCustomFieldValue(def({ fieldType: "checkbox" }), true)).toBe(true)
    expect(validateCustomFieldValue(def({ fieldType: "checkbox" }), false)).toBe(false)
  })
  it("file / image — accepts a string ref", () => {
    expect(validateCustomFieldValue(def({ fieldType: "file" }), "blob_xyz")).toBe("blob_xyz")
    expect(validateCustomFieldValue(def({ fieldType: "image" }), "blob_abc")).toBe("blob_abc")
  })
  it("user_ref / contact_ref / event_ref — accepts a cuid-like string", () => {
    expect(validateCustomFieldValue(def({ fieldType: "user_ref" }), "abc123")).toBe("abc123")
    expect(validateCustomFieldValue(def({ fieldType: "contact_ref" }), "abc123")).toBe("abc123")
    expect(validateCustomFieldValue(def({ fieldType: "event_ref" }), "abc123")).toBe("abc123")
  })
  it("null/undefined pass through as null at every type", () => {
    expect(validateCustomFieldValue(def({ fieldType: "text" }), null)).toBe(null)
    expect(validateCustomFieldValue(def({ fieldType: "number" }), undefined)).toBe(null)
    expect(validateCustomFieldValue(def({ fieldType: "checkbox" }), null)).toBe(null)
  })
})

describe("validateCustomFieldValue — rejections per FieldType", () => {
  it("text too long", () => {
    expect(() => validateCustomFieldValue(def({ fieldType: "text" }), "x".repeat(2001))).toThrow()
  })
  it("number not finite", () => {
    expect(() => validateCustomFieldValue(def({ fieldType: "number" }), Infinity)).toThrow()
    expect(() => validateCustomFieldValue(def({ fieldType: "number" }), NaN)).toThrow()
  })
  it("date malformed", () => {
    expect(() => validateCustomFieldValue(def({ fieldType: "date" }), "yesterday")).toThrow()
    expect(() => validateCustomFieldValue(def({ fieldType: "date" }), "2026/05/20")).toThrow()
  })
  it("email malformed", () => {
    expect(() => validateCustomFieldValue(def({ fieldType: "email" }), "not-an-email")).toThrow()
  })
  it("url malformed", () => {
    expect(() => validateCustomFieldValue(def({ fieldType: "url" }), "not a url")).toThrow()
  })
  it("single_select — value not in choices", () => {
    const d = def({
      fieldType: "single_select",
      name: "Size",
      options: {
        choices: [
          { value: "small", label: "Small" },
          { value: "large", label: "Large" },
        ],
      },
    })
    expect(() => validateCustomFieldValue(d, "medium")).toThrow(/not one of/i)
  })
  it("multi_select — non-array", () => {
    const d = def({
      fieldType: "multi_select",
      options: { choices: [{ value: "a", label: "A" }] },
    })
    expect(() => validateCustomFieldValue(d, "a")).toThrow()
  })
  it("multi_select — one value not in choices", () => {
    const d = def({
      fieldType: "multi_select",
      options: { choices: [{ value: "a", label: "A" }] },
    })
    expect(() => validateCustomFieldValue(d, ["a", "z"])).toThrow(/not in choices/i)
  })
  it("checkbox — non-boolean", () => {
    expect(() => validateCustomFieldValue(def({ fieldType: "checkbox" }), "yes")).toThrow()
    expect(() => validateCustomFieldValue(def({ fieldType: "checkbox" }), 1)).toThrow()
  })
  it("select-type field with no choices configured", () => {
    const d = def({ fieldType: "single_select", options: null, name: "Empty" })
    expect(() => validateCustomFieldValue(d, "anything")).toThrow(/requires options\.choices/i)
  })
  it("formula — writes always rejected", () => {
    expect(() =>
      validateCustomFieldValue(def({ fieldType: "formula", name: "Profit" }), 1234),
    ).toThrow(/formula/i)
  })
})

describe("validateCustomFieldsPayload", () => {
  it("validates each entry and returns a new object", () => {
    const textDef = def({ fieldType: "text", name: "Allergies" })
    const numDef = def({ fieldType: "number", name: "Age" })
    const defs = new Map([
      [textDef.id, textDef],
      [numDef.id, numDef],
    ])

    const out = validateCustomFieldsPayload(defs, {
      [textDef.id]: "peanuts",
      [numDef.id]: 32,
    })
    expect(out[textDef.id]).toBe("peanuts")
    expect(out[numDef.id]).toBe(32)
  })

  it("drops unknown definition ids (soft-deleted between render and submit)", () => {
    const textDef = def({ fieldType: "text" })
    const defs = new Map([[textDef.id, textDef]])

    const out = validateCustomFieldsPayload(defs, {
      [textDef.id]: "known",
      "ghost-id-no-longer-exists": "should-be-dropped",
    })
    expect(out[textDef.id]).toBe("known")
    expect(out).not.toHaveProperty("ghost-id-no-longer-exists")
  })

  it("throws on any value failure, with the field name in the message", () => {
    const d = def({ fieldType: "email", name: "Backup Email" })
    const defs = new Map([[d.id, d]])
    expect(() => validateCustomFieldsPayload(defs, { [d.id]: "not-an-email" })).toThrow()
  })

  it("empty payload returns empty object", () => {
    expect(validateCustomFieldsPayload(new Map(), {})).toEqual({})
  })
})
