import { describe, it, expect } from "vitest"
import {
  findDuplicateCompanyGroups,
  findDuplicateContactGroups,
  normalizeDomain,
  type CompanyCandidate,
  type ContactCandidate,
} from "@/modules/duplicates/matching"

/**
 * Push 4 (B1) — pins every contact + company duplicate rule branch,
 * the transitive grouping behaviour, and the normalization helpers
 * (phone via parsePhoneInput, domain via normalizeDomain).
 */

function contact(
  id: string,
  overrides: Partial<Omit<ContactCandidate, "id">> = {},
): ContactCandidate {
  return {
    id,
    firstName: null,
    lastName: null,
    primaryEmail: null,
    secondaryEmail: null,
    primaryPhone: null,
    secondaryPhone: null,
    primaryCompanyName: null,
    ...overrides,
  }
}

function company(
  id: string,
  overrides: Partial<Omit<CompanyCandidate, "id">> = {},
): CompanyCandidate {
  return {
    id,
    name: "Default Co",
    website: null,
    mainPhone: null,
    category: null,
    ...overrides,
  }
}

describe("duplicates engine — normalizeDomain", () => {
  it("strips www. prefix and lowercases", () => {
    expect(normalizeDomain("https://WWW.Example.com/path")).toBe("example.com")
    expect(normalizeDomain("www.example.com")).toBe("example.com")
    expect(normalizeDomain("Example.com")).toBe("example.com")
  })

  it("returns null for empty / null", () => {
    expect(normalizeDomain(null)).toBeNull()
    expect(normalizeDomain("")).toBeNull()
    expect(normalizeDomain("   ")).toBeNull()
  })

  it("strips trailing port and path", () => {
    expect(normalizeDomain("https://example.com:8080/foo?bar=1")).toBe("example.com")
  })
})

describe("duplicates engine — contacts", () => {
  it("Rule 1: matches on primary_email case-insensitively", () => {
    const groups = findDuplicateContactGroups([
      contact("a", { primaryEmail: "Ada@Example.com" }),
      contact("b", { primaryEmail: "ada@example.com" }),
    ])
    expect(groups).toHaveLength(1)
    expect(new Set(groups[0]?.ids)).toEqual(new Set(["a", "b"]))
    expect(groups[0]?.reasons).toContain("email")
  })

  it("Rule 1: secondary_email participates the same as primary", () => {
    const groups = findDuplicateContactGroups([
      contact("a", { primaryEmail: "ada@example.com" }),
      contact("b", { secondaryEmail: "ada@example.com" }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.reasons).toContain("email")
  })

  it("Rule 2: phones with different formats but same digits match", () => {
    const groups = findDuplicateContactGroups([
      contact("a", { primaryPhone: "(727) 555-0100" }),
      contact("b", { primaryPhone: "7275550100" }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.reasons).toContain("phone")
  })

  it("Rule 2: un-parseable phones are ignored", () => {
    const groups = findDuplicateContactGroups([
      contact("a", { primaryPhone: "abc" }),
      contact("b", { primaryPhone: "abc" }),
    ])
    expect(groups).toHaveLength(0)
  })

  it("Rule 3: name + company match case-insensitively", () => {
    const groups = findDuplicateContactGroups([
      contact("a", {
        firstName: "Ada",
        lastName: "Lovelace",
        primaryCompanyName: "Evergreen",
      }),
      contact("b", {
        firstName: "ada",
        lastName: "LOVELACE",
        primaryCompanyName: "evergreen",
      }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.reasons).toContain("name_and_company")
  })

  it("Rule 3: requires all three components — missing company = no match", () => {
    const groups = findDuplicateContactGroups([
      contact("a", { firstName: "Ada", lastName: "Lovelace" }),
      contact("b", { firstName: "Ada", lastName: "Lovelace" }),
    ])
    expect(groups).toHaveLength(0)
  })

  it("transitively groups A↔B (email) + B↔C (phone) into {A,B,C}", () => {
    const groups = findDuplicateContactGroups([
      contact("a", { primaryEmail: "shared@x.com" }),
      contact("b", { primaryEmail: "shared@x.com", primaryPhone: "7275550100" }),
      contact("c", { primaryPhone: "7275550100" }),
    ])
    expect(groups).toHaveLength(1)
    expect(new Set(groups[0]?.ids)).toEqual(new Set(["a", "b", "c"]))
    expect(new Set(groups[0]?.reasons)).toEqual(new Set(["email", "phone"]))
  })

  it("excludes a contact from its own match (no self-pair)", () => {
    const groups = findDuplicateContactGroups([contact("a", { primaryEmail: "shared@x.com" })])
    expect(groups).toHaveLength(0)
  })

  it("nullish emails / phones are ignored", () => {
    const groups = findDuplicateContactGroups([
      contact("a", { primaryEmail: null, primaryPhone: null }),
      contact("b", { primaryEmail: "", primaryPhone: "" }),
    ])
    expect(groups).toHaveLength(0)
  })

  // ─── HubSpot-parity similarity rules (Push 4 followup) ────────────

  describe("similarity scoring", () => {
    it("Wendy Feldposh vs Wendy Feldposh f w/ same-local cross-domain email → similar_name_and_email", () => {
      const groups = findDuplicateContactGroups([
        contact("a", {
          firstName: "Wendy",
          lastName: "Feldposh",
          primaryEmail: "weeeendy@yoohoo.uk",
          primaryPhone: "7275550100",
        }),
        contact("b", {
          firstName: "Wendy",
          lastName: "Feldposh f",
          primaryEmail: "weeeendy@yoohoo.com",
          primaryPhone: null,
        }),
      ])
      expect(groups).toHaveLength(1)
      expect(new Set(groups[0]?.ids)).toEqual(new Set(["a", "b"]))
      expect(groups[0]?.reasons).toContain("similar_name_and_email")
    })

    it("name-only similarity NEVER surfaces (two different 'John Smith's, no other signal)", () => {
      const groups = findDuplicateContactGroups([
        contact("a", {
          firstName: "John",
          lastName: "Smith",
          primaryEmail: "john.smith@acme.com",
          primaryPhone: "7275550100",
        }),
        contact("b", {
          firstName: "John",
          lastName: "Smith",
          primaryEmail: "jsmith@globex.io",
          primaryPhone: "7275550200",
        }),
      ])
      expect(groups).toHaveLength(0)
    })

    it("name-only with one shared first name and NO other signal does NOT surface", () => {
      const groups = findDuplicateContactGroups([
        contact("a", { firstName: "Alex", lastName: "Brown" }),
        contact("b", { firstName: "Alex", lastName: "Chen" }),
      ])
      expect(groups).toHaveLength(0)
    })

    it("same company only (different name + no other signal) does NOT surface", () => {
      const groups = findDuplicateContactGroups([
        contact("a", {
          firstName: "Ada",
          lastName: "Lovelace",
          primaryCompanyName: "Evergreen",
        }),
        contact("b", {
          firstName: "Grace",
          lastName: "Hopper",
          primaryCompanyName: "Evergreen",
        }),
      ])
      expect(groups).toHaveLength(0)
    })

    it("similar name + similar company → similar_name_and_company (HubSpot-style fuzzy variant)", () => {
      const groups = findDuplicateContactGroups([
        contact("a", {
          firstName: "Ada",
          lastName: "Lovelace",
          primaryCompanyName: "K&K Photography",
        }),
        contact("b", {
          firstName: "Ada",
          lastName: "Lovelace",
          primaryCompanyName: "K & K Photography Inc",
        }),
      ])
      expect(groups).toHaveLength(1)
      expect(groups[0]?.reasons).toContain("name_and_company")
    })

    it("name-only (no email/phone/company signal at all) does NOT surface even when name is identical", () => {
      const groups = findDuplicateContactGroups([
        contact("a", { firstName: "Ada", lastName: "Lovelace" }),
        contact("b", { firstName: "Ada", lastName: "Lovelace" }),
      ])
      expect(groups).toHaveLength(0)
    })

    it("inverted name order ('Smith John' vs 'John Smith') matches via inverted-token max", () => {
      // The spec calls for testing both forward + inverted name
      // tokens. Pair with a same-local email signal to satisfy the
      // surface rule.
      const groups = findDuplicateContactGroups([
        contact("a", {
          firstName: "John",
          lastName: "Smith",
          primaryEmail: "jsmith@a.com",
        }),
        contact("b", {
          firstName: "Smith",
          lastName: "John",
          primaryEmail: "jsmith@b.com",
        }),
      ])
      expect(groups).toHaveLength(1)
      expect(groups[0]?.reasons).toContain("similar_name_and_email")
    })

    it("ranks pairs by composite score — exact-email pair sorts ahead of similar-name pair", () => {
      // Two distinct dup pairs in the same scan; verify ordering.
      const groups = findDuplicateContactGroups([
        // Strong: same email
        contact("a1", { primaryEmail: "ada@example.com" }),
        contact("a2", { primaryEmail: "ada@example.com" }),
        // Weaker: similar name + similar email
        contact("b1", {
          firstName: "Wendy",
          lastName: "Feldposh",
          primaryEmail: "weeeendy@yoohoo.uk",
        }),
        contact("b2", {
          firstName: "Wendy",
          lastName: "Feldposh f",
          primaryEmail: "weeeendy@yoohoo.com",
        }),
      ])
      expect(groups).toHaveLength(2)
      // The exact-email group ranks first (top score 100+).
      expect(new Set(groups[0]?.ids)).toEqual(new Set(["a1", "a2"]))
      expect(new Set(groups[1]?.ids)).toEqual(new Set(["b1", "b2"]))
    })
  })
})

describe("duplicates engine — companies", () => {
  it("Rule 1: domain alone is enough; www. prefix normalized", () => {
    const groups = findDuplicateCompanyGroups([
      company("a", { website: "https://www.example.com/about" }),
      company("b", { website: "https://example.com" }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.reasons).toContain("domain")
  })

  it("Rule 2: name + phone (different name = no match)", () => {
    const groups = findDuplicateCompanyGroups([
      company("a", { name: "Evergreen", mainPhone: "(727) 555-0100" }),
      company("b", { name: "Evergreen", mainPhone: "7275550100" }),
      company("c", { name: "Different", mainPhone: "7275550100" }),
    ])
    // a + b share name + phone; c shares only phone (and rule 2 requires name match too).
    expect(groups).toHaveLength(1)
    expect(new Set(groups[0]?.ids)).toEqual(new Set(["a", "b"]))
    expect(groups[0]?.reasons).toContain("name_and_phone")
  })

  it("Rule 3: name + industry (category)", () => {
    const groups = findDuplicateCompanyGroups([
      company("a", { name: "Evergreen", category: "Florist" }),
      company("b", { name: "evergreen", category: "FLORIST" }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.reasons).toContain("name_and_industry")
  })

  it("transitively unions across rules", () => {
    const groups = findDuplicateCompanyGroups([
      company("a", { name: "Evergreen", category: "Florist" }),
      company("b", { name: "Evergreen", mainPhone: "7275550100", category: "Florist" }),
      company("c", {
        website: "https://evergreen.example",
        mainPhone: "7275550100",
        name: "Evergreen",
      }),
    ])
    expect(groups).toHaveLength(1)
    expect(new Set(groups[0]?.ids)).toEqual(new Set(["a", "b", "c"]))
  })

  it("excludes self-match", () => {
    const groups = findDuplicateCompanyGroups([company("a", { website: "https://example.com" })])
    expect(groups).toHaveLength(0)
  })
})
