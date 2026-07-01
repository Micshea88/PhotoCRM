import { describe, expect, it } from "vitest"
import { filterProviders, getAllProviders } from "@/modules/integrations/registry"

/**
 * Predictive-filter behavior for the Browse view. The filter is the
 * pure helper exported from registry.ts — the React component
 * (IntegrationsBrowser) just renders its output.
 */

describe("integrations browser — filterProviders", () => {
  it("returns the full set when the query is empty", () => {
    const all = getAllProviders()
    expect(filterProviders("")).toEqual(all)
  })

  it("returns the full set when the query is whitespace-only", () => {
    const all = getAllProviders()
    expect(filterProviders("   ").length).toBe(all.length)
  })

  it("matches against provider name (case-insensitive)", () => {
    const hits = filterProviders("ringcentral")
    expect(hits.map((p) => p.id)).toEqual(["ringcentral"])
    const upper = filterProviders("RINGCENTRAL")
    expect(upper.map((p) => p.id)).toEqual(["ringcentral"])
  })

  it("matches against the category name", () => {
    // "Phone & SMS" — searching "phone" should pull every Phone-category
    // provider.
    const hits = filterProviders("phone")
    expect(hits.map((p) => p.id).sort()).toEqual(["google_voice", "ringcentral", "tel"])
  })

  it("matches against an enabled capability name", () => {
    // "webhook" is a clean capability discriminator — it appears only
    // in RingCentral's `webhookInbound` flag, NOT in any provider's
    // name, description, or the category name ("Phone & SMS"). A search
    // for "webhook" pulls every provider with the webhookInbound
    // capability — RingCentral plus the email providers (which auto-log
    // replies via an inbound webhook). Order follows the registry.
    //
    // (We avoid using "sms" here even though only RC has SMS enabled:
    // the category name contains "SMS" so every phone provider would
    // legitimately match. That's the filter doing its job — we just
    // pick a token that proves the capability-only path.)
    const hits = filterProviders("webhook")
    expect(hits.map((p) => p.id)).toEqual(["ringcentral", "gmail", "microsoft", "other"])
  })

  it("requires every whitespace-split token to match (AND)", () => {
    // "ringcentral phone" — both tokens hit (name + category) → 1 result.
    // "ringcentral xyz" — second token misses → 0 results.
    expect(filterProviders("ringcentral phone").map((p) => p.id)).toEqual(["ringcentral"])
    expect(filterProviders("ringcentral xyz").length).toBe(0)
  })

  it("returns 0 results when nothing matches", () => {
    expect(filterProviders("zzzzzz-not-a-real-thing").length).toBe(0)
  })
})
