import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { CustomFieldDefinition } from "@/modules/custom-fields/schema"
import type { FieldType } from "@/modules/custom-fields/types"
import { detectCustomFieldChanges } from "@/modules/custom-fields/changes"

function def(fieldType: FieldType, name = "Test"): CustomFieldDefinition {
  return {
    id: createId(),
    organizationId: createId(),
    recordType: "contact",
    name,
    fieldType,
    options: null,
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

describe("detectCustomFieldChanges", () => {
  it("returns [] when before and after are identical", () => {
    const d1 = def("text")
    const result = detectCustomFieldChanges({ [d1.id]: "alpha" }, { [d1.id]: "alpha" }, [d1])
    expect(result).toEqual([])
  })

  it("captures set→set with both values", () => {
    const d1 = def("text", "Lead Source")
    const result = detectCustomFieldChanges({ [d1.id]: "Google" }, { [d1.id]: "Referral" }, [d1])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      fieldId: d1.id,
      fieldName: "Lead Source",
      fieldType: "text",
      before: "Google",
      after: "Referral",
    })
  })

  it("captures null→set (added)", () => {
    const d1 = def("number")
    const result = detectCustomFieldChanges({}, { [d1.id]: 42 }, [d1])
    expect(result).toHaveLength(1)
    expect(result[0]?.before).toBeNull()
    expect(result[0]?.after).toBe(42)
  })

  it("captures set→null (cleared)", () => {
    const d1 = def("text")
    const result = detectCustomFieldChanges({ [d1.id]: "X" }, {}, [d1])
    expect(result).toHaveLength(1)
    expect(result[0]?.before).toBe("X")
    expect(result[0]?.after).toBeNull()
  })

  it("treats explicit null in both as a no-op", () => {
    const d1 = def("text")
    const result = detectCustomFieldChanges({ [d1.id]: null }, { [d1.id]: null }, [d1])
    expect(result).toEqual([])
  })

  it("captures multi_select array diffs structurally", () => {
    const d1 = def("multi_select")
    const result = detectCustomFieldChanges({ [d1.id]: ["a", "b"] }, { [d1.id]: ["a", "b"] }, [d1])
    expect(result).toEqual([])
    const result2 = detectCustomFieldChanges({ [d1.id]: ["a", "b"] }, { [d1.id]: ["a", "c"] }, [d1])
    expect(result2).toHaveLength(1)
  })

  it("skips fields not in the definitions list (orphan keys)", () => {
    const d1 = def("text")
    const orphanId = createId()
    const result = detectCustomFieldChanges(
      { [d1.id]: "X", [orphanId]: "ghost" },
      { [d1.id]: "Y", [orphanId]: "ghost2" },
      [d1],
    )
    expect(result).toHaveLength(1)
    expect(result[0]?.fieldId).toBe(d1.id)
  })

  it("handles null/undefined before/after gracefully", () => {
    const d1 = def("text")
    expect(detectCustomFieldChanges(null, null, [d1])).toEqual([])
    expect(detectCustomFieldChanges(null, { [d1.id]: "X" }, [d1])[0]?.after).toBe("X")
    expect(detectCustomFieldChanges({ [d1.id]: "X" }, null, [d1])[0]?.before).toBe("X")
  })
})
