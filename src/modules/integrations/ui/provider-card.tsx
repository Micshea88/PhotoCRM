import Link from "next/link"
import {
  Calendar,
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
import type { CapabilityFlags, IntegrationProvider } from "@/modules/integrations/types"

/**
 * Provider card — server component, wraps the shared Card primitive
 * without changing its behavior. Renders capability chips ONLY for
 * flags the provider declares as true (the "absent never broken"
 * rule). The whole card is a Link to the provider's wizard.
 *
 * No client interactivity here — the card is link + content.
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

const CONNECT_STATE_LABELS = {
  not_connected: "Not connected",
  connected: "Connected",
  always_available: "Always available",
} as const

function ProviderIcon({ iconKey }: { iconKey: string }) {
  const Icon = ICONS[iconKey] ?? Plug
  return (
    <span
      className="flex size-10 items-center justify-center rounded-md bg-[var(--color-muted)] text-[var(--color-foreground)]"
      aria-hidden="true"
    >
      <Icon className="size-5" />
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

function ConnectStateBadge({ state }: { state: IntegrationProvider["connectState"] }) {
  const label = CONNECT_STATE_LABELS[state]
  const classes = cn(
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs",
    state === "connected" && "bg-emerald-100 text-emerald-800",
    state === "always_available" && "bg-sky-100 text-sky-800",
    state === "not_connected" && "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
  )
  return <span className={classes}>{label}</span>
}

export function ProviderCard({ provider }: { provider: IntegrationProvider }) {
  // Render chips ONLY for capabilities the provider actually supports.
  // "absent never broken" — never show a capability the provider can't
  // deliver.
  const enabledCapabilities = (Object.keys(provider.capabilityFlags) as (keyof CapabilityFlags)[])
    .filter((k) => provider.capabilityFlags[k])
    .map((k) => CAPABILITY_LABELS[k])

  return (
    <Link
      href={`/settings/integrations/${provider.categoryId}/${provider.id}`}
      data-testid={`integration-provider-card-${provider.id}`}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
    >
      <Card className="h-full p-4 transition-colors hover:bg-[var(--color-accent)]/30">
        <div className="flex items-start gap-3">
          <ProviderIcon iconKey={provider.iconKey} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="truncate text-sm font-semibold">{provider.name}</h3>
              <ConnectStateBadge state={provider.connectState} />
            </div>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              {provider.description}
            </p>
            {enabledCapabilities.length > 0 ? (
              <div
                className="mt-2 flex flex-wrap gap-1"
                data-testid={`integration-provider-capabilities-${provider.id}`}
              >
                {enabledCapabilities.map((label) => (
                  <CapabilityChip key={label} label={label} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </Link>
  )
}
