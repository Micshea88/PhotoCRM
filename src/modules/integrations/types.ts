/**
 * In-code registry types for the Integrations Hub.
 *
 * NO database backing. This module is the chassis — the actual
 * connect/disconnect flow ships in later pushes that talk to
 * `telephony_connections` (and the other future provider tables).
 *
 * The shape is deliberately ONE flat record per category and per
 * provider so adding a new provider is a single registry edit, never
 * a schema change.
 */

export type CategoryId = "phone" | "calendar" | "email" | "payments"

/**
 * Honest capability flags. The UI reads these to decide which
 * affordances to render — providers NEVER show chips for capabilities
 * they don't actually support.
 *
 *   - `calling`           — in-app outbound calling (VoIP).
 *   - `sms`               — send/receive SMS through the provider.
 *   - `autoLogActivity`   — provider pushes call/SMS events to us via
 *                           webhook, so we can auto-create activity rows.
 *   - `webhookInbound`    — provider supports inbound webhook subscriptions
 *                           at all (prerequisite for autoLogActivity).
 *   - `dialerHandoff`     — provider can be invoked via OS / browser
 *                           handoff (tel: link, deep link). Almost every
 *                           phone provider can do this.
 */
export interface CapabilityFlags {
  calling: boolean
  sms: boolean
  autoLogActivity: boolean
  webhookInbound: boolean
  dialerHandoff: boolean
}

/**
 * How the user connects this provider.
 *
 *   - `oauth`         — full OAuth grant (e.g. RingCentral). Connect
 *                       button triggers an OAuth handshake.
 *   - `handoff_only`  — no account binding; user enables it as the OS
 *                       dialer. No tokens, no webhooks. Wording is
 *                       "Use as dialer," not "Connect."
 *   - `none`          — always available, no setup (tel: link). Wording
 *                       is "Always available."
 */
export type ConnectKind = "oauth" | "handoff_only" | "none"

/**
 * Org-level connection state for this provider. STUB this push —
 * real state lives in `telephony_connections` (and future provider
 * tables) and will be read at render time in a later push.
 *
 *   - `not_connected`     — owner/admin can connect.
 *   - `connected`         — at least one live row.
 *   - `always_available`  — the `tel:` pseudo-provider, never needs setup.
 */
export type ConnectState = "not_connected" | "connected" | "always_available"

export interface IntegrationCategory {
  id: CategoryId
  name: string
  /** Lucide icon key — string for server→client boundary safety. */
  iconKey: string
  /** Short marketing line on the category page. */
  capabilityDescription: string
}

export interface IntegrationProvider {
  id: string
  categoryId: CategoryId
  name: string
  iconKey: string
  /** One-sentence description shown on the provider card. */
  description: string
  capabilityFlags: CapabilityFlags
  connectKind: ConnectKind
  /** Stub this push; replaced by a live read in a later push. */
  connectState: ConnectState
  /**
   * Concise "how to connect" bullet steps shown on the provider
   * wizard page. Each provider authors its own; HONEST about what
   * each step actually does.
   */
  howToConnectSteps: readonly string[]
  /**
   * Trust-line shown next to the Connect button. Used to say what
   * we will and will not do with the granted access. Drawn from
   * the approved mockup language.
   */
  trustLine: string
}
