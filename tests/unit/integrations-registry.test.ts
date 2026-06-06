import { describe, expect, it } from "vitest"
import {
  getAllCategories,
  getAllProviders,
  getCategoryById,
  getProviderById,
  getProvidersByCategory,
} from "@/modules/integrations/registry"
import type { CapabilityFlags } from "@/modules/integrations/types"

/**
 * Registry honesty proof. The whole point of the in-code registry is
 * that capability flags are HONEST per provider so the UI never shows
 * dead affordances ("absent never broken"). These tests pin that
 * matrix in place — adding a provider that lies about its capabilities
 * will fail here before reaching a card render.
 */

describe("integrations registry — Phone category resolution", () => {
  it("Phone category exists with the expected metadata", () => {
    const phone = getCategoryById("phone")
    expect(phone).not.toBeNull()
    expect(phone?.id).toBe("phone")
    expect(phone?.name).toBe("Phone & SMS")
  })

  it("Phone resolves exactly its three V1 providers", () => {
    const providers = getProvidersByCategory("phone")
    expect(providers.map((p) => p.id).sort()).toEqual(["google_voice", "ringcentral", "tel"])
  })
})

describe("integrations registry — capability honesty matrix", () => {
  it("RingCentral declares the full capability set", () => {
    const rc = getProviderById("ringcentral")
    expect(rc).not.toBeNull()
    const expected: CapabilityFlags = {
      calling: true,
      sms: true,
      autoLogActivity: true,
      webhookInbound: true,
      dialerHandoff: true,
    }
    expect(rc?.capabilityFlags).toEqual(expected)
    expect(rc?.connectKind).toBe("oauth")
  })

  it("Google Voice is hand-off-only (no calling/SMS/auto-log/webhook)", () => {
    const gv = getProviderById("google_voice")
    expect(gv).not.toBeNull()
    const expected: CapabilityFlags = {
      calling: false,
      sms: false,
      autoLogActivity: false,
      webhookInbound: false,
      dialerHandoff: true,
    }
    expect(gv?.capabilityFlags).toEqual(expected)
    expect(gv?.connectKind).toBe("handoff_only")
  })

  it("tel: is dialer-only and always-available (no auth)", () => {
    const tel = getProviderById("tel")
    expect(tel).not.toBeNull()
    const expected: CapabilityFlags = {
      calling: false,
      sms: false,
      autoLogActivity: false,
      webhookInbound: false,
      dialerHandoff: true,
    }
    expect(tel?.capabilityFlags).toEqual(expected)
    expect(tel?.connectKind).toBe("none")
    expect(tel?.connectState).toBe("always_available")
  })
})

describe("integrations registry — lookup helpers", () => {
  it("getCategoryById returns null for an unknown id", () => {
    expect(getCategoryById("not-a-category")).toBeNull()
  })

  it("getProviderById returns null for an unknown id", () => {
    expect(getProviderById("not-a-provider")).toBeNull()
  })

  it("getAllCategories surfaces all V1 category placeholders", () => {
    const ids = getAllCategories()
      .map((c) => c.id)
      .sort()
    expect(ids).toEqual(["calendar", "email", "payments", "phone"])
  })

  it("getAllProviders returns every wired provider", () => {
    const ids = getAllProviders()
      .map((p) => p.id)
      .sort()
    expect(ids).toEqual(["google_voice", "ringcentral", "tel"])
  })
})
