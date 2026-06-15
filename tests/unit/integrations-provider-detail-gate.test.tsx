import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// ProviderDetail now imports ProviderConnectButton + ProviderDisconnectButton,
// which import the telephony server actions; those transitively pull in
// @/lib/auth → @/lib/db → @/lib/env, and the t3-env client guard refuses
// the env access in jsdom. Stub the action surface that ProviderDetail's
// children call. Mirrors tests/unit/contacts-bulk-edit-drawer.test.tsx.
vi.mock("@/modules/telephony/actions", () => ({
  beginRingCentralConnect: vi.fn(() => Promise.resolve({ data: { authorizeUrl: "stub" } })),
  disconnectTelephony: vi.fn(() => Promise.resolve({ data: { ok: true } })),
}))

// ProviderCallSyncButton (RingCentral connected branch) imports the rc-sync
// server action, which transitively pulls @/lib/db → @/lib/env (same client
// guard problem as the telephony actions above). Stub it too.
vi.mock("@/modules/rc-sync/actions", () => ({
  bootstrapRcWebhook: vi.fn(() => Promise.resolve({ data: { ok: true, action: "created" } })),
}))

import { ProviderDetail } from "@/modules/integrations/ui/provider-detail"
import { getCategoryById, getProviderById } from "@/modules/integrations/registry"

/**
 * Provider-detail owner/admin gate. The route guard redirects
 * non-owner/admin away, but the component is the single source of
 * truth on what's gated — so we test it directly with both
 * `canManage` values.
 */

function loadFixture() {
  const category = getCategoryById("phone")
  const provider = getProviderById("ringcentral")
  if (!category || !provider) throw new Error("fixture missing — registry shape changed")
  return { category, provider }
}

describe("ProviderDetail — owner/admin gate", () => {
  it("renders the Connect CTA when canManage is true", () => {
    const { category, provider } = loadFixture()
    render(<ProviderDetail category={category} provider={provider} canManage={true} />)
    // CTA label = "Connect" for the OAuth provider (RingCentral).
    const cta = screen.getByTestId(`integrations-provider-${provider.id}-cta`)
    expect(cta).toBeInTheDocument()
    expect(cta).toHaveTextContent("Connect")
    // Gated explainer must NOT render in the owner/admin path.
    expect(
      screen.queryByTestId(`integrations-provider-${provider.id}-gated`),
    ).not.toBeInTheDocument()
  })

  it("renders the gated explainer (and no CTA) when canManage is false", () => {
    const { category, provider } = loadFixture()
    render(<ProviderDetail category={category} provider={provider} canManage={false} />)
    const explainer = screen.getByTestId(`integrations-provider-${provider.id}-gated`)
    expect(explainer).toBeInTheDocument()
    expect(explainer).toHaveTextContent(/only owners and admins/i)
    expect(screen.queryByTestId(`integrations-provider-${provider.id}-cta`)).not.toBeInTheDocument()
  })

  it("uses connectKind-aware CTA copy for a handoff_only provider", () => {
    const category = getCategoryById("phone")
    const provider = getProviderById("google_voice")
    if (!category || !provider) throw new Error("fixture missing — registry shape changed")
    render(<ProviderDetail category={category} provider={provider} canManage={true} />)
    const cta = screen.getByTestId(`integrations-provider-${provider.id}-cta`)
    expect(cta).toHaveTextContent("Use as dialer")
  })

  it("uses connectKind-aware CTA copy (and disables it) for a none-kind provider", () => {
    const category = getCategoryById("phone")
    const provider = getProviderById("tel")
    if (!category || !provider) throw new Error("fixture missing — registry shape changed")
    render(<ProviderDetail category={category} provider={provider} canManage={true} />)
    const cta = screen.getByTestId(`integrations-provider-${provider.id}-cta`)
    expect(cta).toHaveTextContent("Always available")
    expect(cta).toBeDisabled()
  })
})

describe("ProviderDetail — capability honesty in the header chips", () => {
  it("RingCentral surfaces all 5 capability chips", () => {
    const { category, provider } = loadFixture()
    render(<ProviderDetail category={category} provider={provider} canManage={true} />)
    const chips = screen.getByTestId(`integrations-provider-${provider.id}-capabilities`)
    expect(chips).toHaveTextContent("Calls")
    expect(chips).toHaveTextContent("SMS")
    expect(chips).toHaveTextContent("Auto-log activity")
    expect(chips).toHaveTextContent("Inbound webhooks")
    expect(chips).toHaveTextContent("Dialer hand-off")
  })

  it("Google Voice surfaces ONLY the dialer-handoff chip (no dead SMS/Calls/etc.)", () => {
    const category = getCategoryById("phone")
    const provider = getProviderById("google_voice")
    if (!category || !provider) throw new Error("fixture missing — registry shape changed")
    render(<ProviderDetail category={category} provider={provider} canManage={true} />)
    const chips = screen.getByTestId(`integrations-provider-${provider.id}-capabilities`)
    expect(chips).toHaveTextContent("Dialer hand-off")
    expect(chips).not.toHaveTextContent("Calls")
    expect(chips).not.toHaveTextContent("SMS")
    expect(chips).not.toHaveTextContent("Auto-log activity")
    expect(chips).not.toHaveTextContent("Inbound webhooks")
  })
})
