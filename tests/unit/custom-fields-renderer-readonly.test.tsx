import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { render, screen } from "@testing-library/react"
import type { CustomFieldDefinition } from "@/modules/custom-fields/schema"
import type { FieldType } from "@/modules/custom-fields/types"
import { CustomFieldsRenderer } from "@/modules/custom-fields/ui/custom-fields-renderer"

/**
 * Push 4 (A3) — pins the read-only display contract for every V1
 * field type. The renderer ships now (built but not yet consumed —
 * Push 3's HubSpot detail rebuild is its first reader); these tests
 * are the reference for what each type renders to.
 */

function def(
  fieldType: FieldType,
  overrides: Partial<CustomFieldDefinition> & { name?: string } = {},
): CustomFieldDefinition {
  return {
    id: createId(),
    organizationId: createId(),
    recordType: "contact",
    name: overrides.name ?? "Test Field",
    fieldType,
    options: overrides.options ?? null,
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

describe("CustomFieldsRenderer — readOnly mode", () => {
  it("renders empty value as em-dash for an unset text field", () => {
    const d = def("text")
    render(<CustomFieldsRenderer definitions={[d]} values={{}} readOnly />)
    expect(screen.getByText("Test Field")).toBeInTheDocument()
    expect(screen.getByText("—")).toBeInTheDocument()
  })

  it("renders set text value as plain string", () => {
    const d = def("text", { name: "Allergies" })
    render(<CustomFieldsRenderer definitions={[d]} values={{ [d.id]: "peanuts" }} readOnly />)
    expect(screen.getByText("peanuts")).toBeInTheDocument()
  })

  it("renders currency value formatted as USD", () => {
    const d = def("currency", { name: "Retainer" })
    render(<CustomFieldsRenderer definitions={[d]} values={{ [d.id]: 1500 }} readOnly />)
    expect(screen.getByText("$1,500.00")).toBeInTheDocument()
  })

  it("renders checkbox as Yes/No", () => {
    const d1 = def("checkbox", { name: "Confirmed" })
    const d2 = def("checkbox", { name: "Optional" })
    render(
      <CustomFieldsRenderer
        definitions={[d1, d2]}
        values={{ [d1.id]: true, [d2.id]: false }}
        readOnly
      />,
    )
    expect(screen.getByText("Yes")).toBeInTheDocument()
    expect(screen.getByText("No")).toBeInTheDocument()
  })

  it("renders single_select via the matched choice label", () => {
    const d = def("single_select", {
      name: "Preference",
      options: { choices: [{ value: "a", label: "Apple" }] },
    })
    render(<CustomFieldsRenderer definitions={[d]} values={{ [d.id]: "a" }} readOnly />)
    expect(screen.getByText("Apple")).toBeInTheDocument()
  })

  it("renders multi_select as comma-joined labels", () => {
    const d = def("multi_select", {
      name: "Tags",
      options: {
        choices: [
          { value: "a", label: "Apple" },
          { value: "b", label: "Banana" },
        ],
      },
    })
    render(<CustomFieldsRenderer definitions={[d]} values={{ [d.id]: ["a", "b"] }} readOnly />)
    expect(screen.getByText("Apple, Banana")).toBeInTheDocument()
  })

  it("renders url as a clickable link", () => {
    const d = def("url", { name: "Website" })
    render(
      <CustomFieldsRenderer
        definitions={[d]}
        values={{ [d.id]: "https://example.com" }}
        readOnly
      />,
    )
    const link = screen.getByRole("link", { name: "https://example.com" })
    expect(link).toHaveAttribute("href", "https://example.com")
  })

  it("renders file as Download link, image as next/image", () => {
    const d1 = def("file", { name: "Doc" })
    const d2 = def("image", { name: "Cover" })
    render(
      <CustomFieldsRenderer
        definitions={[d1, d2]}
        values={{
          [d1.id]: "https://blob.test/doc.pdf",
          [d2.id]: "https://blob.test/cover.png",
        }}
        readOnly
      />,
    )
    expect(screen.getByRole("link", { name: "Download file" })).toHaveAttribute(
      "href",
      "https://blob.test/doc.pdf",
    )
    expect(screen.getByAltText("Cover")).toBeInTheDocument()
  })

  it("user_ref renders the user's name when userOptions supplies a match", () => {
    const d = def("user_ref", { name: "Owner" })
    const userId = createId()
    render(
      <CustomFieldsRenderer
        definitions={[d]}
        values={{ [d.id]: userId }}
        readOnly
        userOptions={[{ id: userId, name: "Jane Doe", email: "j@x.com" }]}
      />,
    )
    expect(screen.getByText("Jane Doe")).toBeInTheDocument()
  })

  it("contact_ref renders the contact's full name when contactOptions supplies a match", () => {
    const d = def("contact_ref", { name: "Referred By" })
    const cid = createId()
    render(
      <CustomFieldsRenderer
        definitions={[d]}
        values={{ [d.id]: cid }}
        readOnly
        contactOptions={[{ id: cid, firstName: "Alex", lastName: "Smith" }]}
      />,
    )
    expect(screen.getByText("Alex Smith")).toBeInTheDocument()
  })

  it("formula with no computed value renders placeholder", () => {
    const d = def("formula", { name: "Total" })
    render(<CustomFieldsRenderer definitions={[d]} values={{}} readOnly />)
    expect(screen.getByText("—")).toBeInTheDocument()
  })

  it("formula with a stored scalar renders the value", () => {
    const d = def("formula", { name: "Total" })
    render(<CustomFieldsRenderer definitions={[d]} values={{ [d.id]: "42" }} readOnly />)
    expect(screen.getByText("42")).toBeInTheDocument()
  })
})
