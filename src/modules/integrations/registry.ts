import type { CapabilityFlags, CategoryId, IntegrationCategory, IntegrationProvider } from "./types"

/**
 * STATIC in-code registry of integration categories + providers.
 *
 * Why a code registry and not a DB table:
 *   - Provider metadata changes ~never (RingCentral does not rename
 *     itself). Storing it in the DB would buy nothing and cost a
 *     migration per registry edit.
 *   - Capability flags are read by the UI on every render; doing
 *     this from a TS object is free.
 *   - "absent never broken" — encoding capabilities as TS lets the
 *     compiler enforce that every provider declares every flag.
 *
 * If/when a provider needs PER-ORG configuration (e.g., a custom
 * RingCentral app id), that goes in a NEW table next to
 * `telephony_connections`, not in this registry.
 */

const CATEGORIES: readonly IntegrationCategory[] = [
  {
    id: "phone",
    name: "Phone & SMS",
    iconKey: "phone",
    capabilityDescription:
      "Make calls and send texts from inside the CRM. Some providers also log activity automatically.",
  },
  {
    id: "calendar",
    name: "Calendar",
    iconKey: "calendar",
    capabilityDescription:
      "Sync events between the CRM and your calendar so bookings appear in both places.",
  },
  {
    id: "email",
    name: "Email",
    iconKey: "mail",
    capabilityDescription:
      "Send and receive email through your provider, with replies threading back to the contact.",
  },
  {
    id: "payments",
    name: "Payments",
    iconKey: "credit-card",
    capabilityDescription: "Collect payment on invoices and proposals directly from the CRM.",
  },
] as const

/**
 * Capability honesty matrix — RingCentral is the only one with full
 * coverage in V1.
 *
 *                         calling  sms   autoLog  webhook  dialer
 *   ringcentral             yes     yes   yes      yes      yes
 *   google_voice            no      no    no       no       yes
 *   tel:                    no      no    no       no       yes
 *
 * Cards / wizards must render only the chips a provider supports.
 * That's the "absent never broken" rule — never offer an SMS button
 * for a provider whose SMS flag is false.
 */
const ringcentralCaps: CapabilityFlags = {
  calling: true,
  sms: true,
  autoLogActivity: true,
  webhookInbound: true,
  dialerHandoff: true,
}

const googleVoiceCaps: CapabilityFlags = {
  calling: false,
  sms: false,
  autoLogActivity: false,
  webhookInbound: false,
  dialerHandoff: true,
}

const telCaps: CapabilityFlags = {
  calling: false,
  sms: false,
  autoLogActivity: false,
  webhookInbound: false,
  dialerHandoff: true,
}

const PROVIDERS: readonly IntegrationProvider[] = [
  {
    id: "ringcentral",
    categoryId: "phone",
    name: "RingCentral",
    iconKey: "phone-call",
    description:
      "Make and receive calls + SMS in the CRM. Activity is logged automatically against the matching contact.",
    capabilityFlags: ringcentralCaps,
    connectKind: "oauth",
    connectState: "not_connected",
    howToConnectSteps: [
      "Click Connect — RingCentral opens in a new tab and asks for permission.",
      "Sign in with the studio's shared RingCentral account.",
      "Approve the requested scopes (Calling, SMS, ReadMessages).",
      "You will be returned to the CRM with the connection active.",
    ],
    trustLine:
      "Pathway stores only the access token, encrypted. We never see or store your RingCentral password.",
  },
  {
    id: "google_voice",
    categoryId: "phone",
    name: "Google Voice",
    iconKey: "voicemail",
    description:
      "Set Google Voice as your dialer. Calls open in the Google Voice tab; you log activity manually in the CRM.",
    capabilityFlags: googleVoiceCaps,
    connectKind: "handoff_only",
    connectState: "not_connected",
    howToConnectSteps: [
      "Choose Use as dialer below.",
      "Phone-icon clicks will open the call in your Google Voice tab.",
      "After the call, return to the CRM and use Log call to record the activity.",
    ],
    trustLine:
      "No account access is granted. Pathway never reads your Google Voice messages or call history.",
  },
  {
    id: "tel",
    categoryId: "phone",
    name: "Built-in phone (tel:)",
    iconKey: "phone",
    description:
      "Click-to-call hands off to whatever phone app your device already uses. Always available, no setup.",
    capabilityFlags: telCaps,
    connectKind: "none",
    connectState: "always_available",
    howToConnectSteps: [
      "Nothing to set up — clicking a phone number opens your device's default phone app.",
      "Log calls manually using the Log call button in the contact's More menu.",
    ],
    trustLine:
      "No account or token is involved. Pathway only generates a tel: link for your device to handle.",
  },
] as const

// Public API

export function getAllCategories(): readonly IntegrationCategory[] {
  return CATEGORIES
}

export function getCategoryById(id: string): IntegrationCategory | null {
  return CATEGORIES.find((c) => c.id === id) ?? null
}

export function getAllProviders(): readonly IntegrationProvider[] {
  return PROVIDERS
}

export function getProvidersByCategory(id: CategoryId): readonly IntegrationProvider[] {
  return PROVIDERS.filter((p) => p.categoryId === id)
}

export function getProviderById(id: string): IntegrationProvider | null {
  return PROVIDERS.find((p) => p.id === id) ?? null
}

/**
 * Predictive-filter helper for the Browse view. Splits the query on
 * whitespace and requires EVERY token to appear (case-insensitively)
 * in the haystack composed of the provider's name + description +
 * category name + enabled capability names.
 *
 * Pure function — exported for unit tests.
 */
export function filterProviders(
  query: string,
  providers: readonly IntegrationProvider[] = PROVIDERS,
): readonly IntegrationProvider[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0)
  if (tokens.length === 0) return providers
  return providers.filter((p) => {
    const category = getCategoryById(p.categoryId)
    const enabledCaps = (Object.keys(p.capabilityFlags) as (keyof CapabilityFlags)[]).filter(
      (k) => p.capabilityFlags[k],
    )
    const haystack = [p.name, p.description, category?.name ?? "", ...enabledCaps]
      .join(" ")
      .toLowerCase()
    return tokens.every((t) => haystack.includes(t))
  })
}

/**
 * For the Connected Apps view — STUB this push. Always returns [].
 * The wired version (next push) queries telephony_connections + future
 * provider tables and returns the live set.
 */
export function getConnectedProviders(): readonly IntegrationProvider[] {
  return []
}
