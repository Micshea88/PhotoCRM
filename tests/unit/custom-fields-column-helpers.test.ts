import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import {
  buildCustomFieldColumnId,
  customFieldColumnLabel,
  formatCustomFieldCell,
  isCustomFieldColumnId,
  parseCustomFieldColumnId,
  readCustomFieldValue,
  type ListCustomFieldDef,
} from "@/modules/custom-fields/ui/column-helpers"

function def(fieldType: string, overrides: Partial<ListCustomFieldDef> = {}): ListCustomFieldDef {
  return {
    id: overrides.id ?? createId(),
    name: overrides.name ?? "Test Field",
    fieldType,
    options: overrides.options ?? null,
    archivedAt: overrides.archivedAt ?? null,
  }
}

describe("custom-fields column helpers", () => {
  it("namespaces column ids via cf:<fieldId>", () => {
    const id = "ck1abc"
    expect(buildCustomFieldColumnId(id)).toBe("cf:ck1abc")
    expect(parseCustomFieldColumnId("cf:ck1abc")).toBe(id)
    expect(isCustomFieldColumnId("cf:ck1abc")).toBe(true)
    expect(isCustomFieldColumnId("firstName")).toBe(false)
  })

  it("suffixes archived defs with '(archived)' in the column label", () => {
    const d = def("text", { name: "Allergies" })
    expect(customFieldColumnLabel(d)).toBe("Allergies")
    const archived = def("text", { name: "Allergies", archivedAt: "2026-05-01T00:00:00Z" })
    expect(customFieldColumnLabel(archived)).toBe("Allergies (archived)")
  })

  it("reads raw values out of the custom_fields jsonb defensively", () => {
    const d = def("text")
    expect(readCustomFieldValue(null, d.id)).toBeNull()
    expect(readCustomFieldValue({}, d.id)).toBeNull()
    expect(readCustomFieldValue({ [d.id]: "hi" }, d.id)).toBe("hi")
  })

  it("formats currency as USD", () => {
    const d = def("currency")
    expect(formatCustomFieldCell(d, 1500)).toBe("$1,500.00")
    expect(formatCustomFieldCell(d, null)).toBe("")
  })

  it("formats checkbox as Yes/No", () => {
    const d = def("checkbox")
    expect(formatCustomFieldCell(d, true)).toBe("Yes")
    expect(formatCustomFieldCell(d, false)).toBe("No")
    expect(formatCustomFieldCell(d, null)).toBe("")
  })

  it("resolves single_select via choice label", () => {
    const d = def("single_select", {
      options: { choices: [{ value: "g", label: "Gold" }] },
    })
    expect(formatCustomFieldCell(d, "g")).toBe("Gold")
  })

  it("joins multi_select labels with commas", () => {
    const d = def("multi_select", {
      options: {
        choices: [
          { value: "a", label: "Apple" },
          { value: "b", label: "Banana" },
        ],
      },
    })
    expect(formatCustomFieldCell(d, ["a", "b"])).toBe("Apple, Banana")
  })

  it("returns '' for unset / null / undefined", () => {
    const d = def("text")
    expect(formatCustomFieldCell(d, "")).toBe("")
    expect(formatCustomFieldCell(d, null)).toBe("")
    expect(formatCustomFieldCell(d, undefined)).toBe("")
  })

  it("formula renders scalars passed through and skips objects", () => {
    const d = def("formula")
    expect(formatCustomFieldCell(d, "42")).toBe("42")
    expect(formatCustomFieldCell(d, 42)).toBe("42")
    expect(formatCustomFieldCell(d, true)).toBe("Yes")
    expect(formatCustomFieldCell(d, { something: 1 })).toBe("")
  })
})
