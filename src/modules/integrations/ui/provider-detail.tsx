import Link from "next/link"
import {
  Calendar,
  ChevronLeft,
  CheckCircle2,
  CreditCard,
  Mail,
  Phone,
  PhoneCall,
  Plug,
  Voicemail,
  type LucideIcon,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type {
  CapabilityFlags,
  ConnectKind,
  IntegrationCategory,
  IntegrationProvider,
} from "@/modules/integrations/types"
import { ProviderConnectButton } from "./provider-connect-button"
import { ProviderDisconnectButton } from "./provider-disconnect-button"
import { ProviderCallSyncButton } from "./provider-call-sync-button"

/**
 * Provider wizard shell — server component. Renders the provider
 * header, the "how to connect" steps, and the connect / disconnect
 * affordance.
 *
 * The provider's `connectState` here is driven by LIVE data passed
 * down from the page (which queries the user's
 * telephony_connections row). The static registry value is
 * always overridden before render — it's only the default for
 * provider types we don't store at all (tel: which stays
 * "always_available").
 *
 * Branches:
 *   - "connected"          → Connected badge + Disconnect (canManage)
 *                            OR Connected badge alone (no canManage).
 *   - "not_connected"      → ProviderConnectButton (Connect / Use as
 *                            dialer, gated on canManage).
 *   - "always_available"   → "Always available" notice + disabled
 *                            CTA (tel: pseudo-provider).
 *
 * Capability chips render ONLY for flags the provider declares as
 * true — "absent never broken."
 */

const ICONS: Record<string, LucideIcon> = {
  phone: Phone,
  "phone-call": PhoneCall,
  voicemail: Voicemail,
  calendar: Calendar,
  mail: Mail,
  "credit-card": CreditCard,
  plug: Plug,
}

const CAPABILITY_LABELS: Record<keyof CapabilityFlags, string> = {
  calling: "Calls",
  sms: "SMS",
  autoLogActivity: "Auto-log activity",
  webhookInbound: "Inbound webhooks",
  dialerHandoff: "Dialer hand-off",
}

const CONNECT_KIND_COPY: Record<ConnectKind, { ctaLabel: string; ctaHint: string }> = {
  oauth: {
    ctaLabel: "Connect",
    ctaHint: "Opens the provider's authorization screen in a new tab.",
  },
  handoff_only: {
    ctaLabel: "Use as dialer",
    ctaHint: "No account is connected — clicks hand off to the provider's web app.",
  },
  none: {
    ctaLabel: "Always available",
    ctaHint: "Nothing to set up — your device's default phone app handles the call.",
  },
}

function ProviderIcon({ iconKey }: { iconKey: string }) {
  const Icon = ICONS[iconKey] ?? Plug
  return (
    <span
      className="flex size-12 items-center justify-center rounded-md bg-[var(--color-muted)] text-[var(--color-foreground)]"
      aria-hidden="true"
    >
      <Icon className="size-6" />
    </span>
  )
}

function CapabilityChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-foreground)]">
      {label}
    </span>
  )
}

function ConnectedBadge({ providerId }: { providerId: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-[var(--color-success)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-success)]"
      data-testid={`integrations-provider-${providerId}-connected-badge`}
    >
      <CheckCircle2 className="size-3.5" aria-hidden="true" />
      Connected
    </span>
  )
}

export function ProviderDetail({
  category,
  provider,
  canManage,
  callSyncEnabled = false,
}: {
  category: IntegrationCategory
  provider: IntegrationProvider
  canManage: boolean
  /** RingCentral only — whether the account telephony webhook is bootstrapped.
   *  Drives the "Enable call sync" button state. */
  callSyncEnabled?: boolean
}) {
  const enabledCapabilities = (Object.keys(provider.capabilityFlags) as (keyof CapabilityFlags)[])
    .filter((k) => provider.capabilityFlags[k])
    .map((k) => CAPABILITY_LABELS[k])

  const { ctaLabel, ctaHint } = CONNECT_KIND_COPY[provider.connectKind]
  const ctaDisabled = provider.connectKind === "none"
  const isConnected = provider.connectState === "connected"

  return (
    <div className="space-y-6" data-testid={`integrations-provider-${provider.id}`}>
      <div>
        <Link
          href={`/settings/integrations/${category.id}`}
          className="inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {category.name}
        </Link>
      </div>

      <header className="flex items-start gap-4">
        <ProviderIcon iconKey={provider.iconKey} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-serif text-xl font-semibold">{provider.name}</h1>
            {isConnected ? <ConnectedBadge providerId={provider.id} /> : null}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
            {provider.description}
          </p>
          {enabledCapabilities.length > 0 ? (
            <div
              className="mt-3 flex flex-wrap gap-1"
              data-testid={`integrations-provider-${provider.id}-capabilities`}
            >
              {enabledCapabilities.map((label) => (
                <CapabilityChip key={label} label={label} />
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {!isConnected ? (
        <Card className="p-6">
          <h2 className="text-sm font-semibold">How to connect</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
            {provider.howToConnectSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Card>
      ) : null}

      <Card className={cn("p-6", canManage ? null : "bg-[var(--color-muted)]/40")}>
        {canManage ? (
          isConnected ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <ProviderDisconnectButton
                  providerId={provider.id}
                  providerName={provider.name}
                  categoryId={category.id}
                />
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {category.id === "email"
                    ? `Disconnecting stops ${provider.name} from sending your client email and logging replies.`
                    : `Disconnecting stops ${provider.name} from being available for calls and SMS.`}
                </span>
              </div>
              {provider.id === "ringcentral" ? (
                <div className="border-t border-[var(--color-border)] pt-4">
                  <ProviderCallSyncButton
                    providerId={provider.id}
                    initialEnabled={callSyncEnabled}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <ProviderConnectButton
                  providerId={provider.id}
                  providerName={provider.name}
                  categoryId={category.id}
                  connectKind={provider.connectKind}
                  ctaLabel={ctaLabel}
                  disabled={ctaDisabled}
                />
                <span className="text-xs text-[var(--color-muted-foreground)]">{ctaHint}</span>
              </div>
              <p className="text-xs text-[var(--color-muted-foreground)]">{provider.trustLine}</p>
            </div>
          )
        ) : (
          <p
            className="text-sm text-[var(--color-muted-foreground)]"
            data-testid={`integrations-provider-${provider.id}-gated`}
          >
            Only owners and admins can connect integrations for this workspace.
          </p>
        )}
      </Card>
    </div>
  )
}
