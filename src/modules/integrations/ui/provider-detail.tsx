import Link from "next/link"
import {
  Calendar,
  ChevronLeft,
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

/**
 * Provider wizard shell — server component. Renders the provider
 * header, the "how to connect" steps, the trust line, and the
 * Connect / Use-as-dialer / Always-available affordance.
 *
 * The Connect button itself is a CLIENT subcomponent
 * (`ProviderConnectButton`) so it can render a clearly-stubbed
 * inline message on click. The actual OAuth handoff lands in the
 * next push.
 *
 * Gating:
 *   - The whole route is owner/admin-only (the page guard redirects
 *     other roles to /dashboard).
 *   - `canManage` is passed in by the route as belt-and-suspenders;
 *     when false (a future loosening of the route gate could allow
 *     other roles to *view* this page), we render an explainer
 *     block instead of the affordance.
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

export function ProviderDetail({
  category,
  provider,
  canManage,
}: {
  category: IntegrationCategory
  provider: IntegrationProvider
  canManage: boolean
}) {
  const enabledCapabilities = (Object.keys(provider.capabilityFlags) as (keyof CapabilityFlags)[])
    .filter((k) => provider.capabilityFlags[k])
    .map((k) => CAPABILITY_LABELS[k])

  const { ctaLabel, ctaHint } = CONNECT_KIND_COPY[provider.connectKind]
  const ctaDisabled = provider.connectKind === "none"

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
          <h1 className="text-xl font-semibold">{provider.name}</h1>
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

      <Card className="p-6">
        <h2 className="text-sm font-semibold">How to connect</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          {provider.howToConnectSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Card>

      <Card className={cn("p-6", canManage ? null : "bg-[var(--color-muted)]/40")}>
        {canManage ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <ProviderConnectButton
                providerId={provider.id}
                providerName={provider.name}
                connectKind={provider.connectKind}
                ctaLabel={ctaLabel}
                disabled={ctaDisabled}
              />
              <span className="text-xs text-[var(--color-muted-foreground)]">{ctaHint}</span>
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)]">{provider.trustLine}</p>
          </div>
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
