import { Badge, type BadgeCategory, type BadgeState } from "@/components/ui/badge"

/**
 * Contact Type / lifecycle Status pills — thin mappers onto the shared <Badge>
 * primitive (one padding, one font, tint bg + SATURATED fg per the category tier).
 * The taxonomy→token mapping lives here; all pill styling lives in <Badge>.
 */

type BadgeSpec =
  | { variant: "category"; category: BadgeCategory }
  | { variant: "state"; state: BadgeState }
  | { variant: "neutral" }

const NEUTRAL: BadgeSpec = { variant: "neutral" }

const TYPE_MAP: Record<string, BadgeSpec> = {
  Lead: { variant: "category", category: "lead" },
  "Active Client": { variant: "category", category: "client" },
  "Past Client": { variant: "category", category: "past" },
  Vendor: { variant: "category", category: "vendor" },
  Contractor: { variant: "category", category: "vendor" },
  "Referral Partner": { variant: "category", category: "lead" },
}

const STATUS_MAP: Record<string, BadgeSpec> = {
  Active: { variant: "category", category: "client" },
  VIP: { variant: "category", category: "vip" },
  Inactive: { variant: "category", category: "past" },
  // NOTE: Do Not Contact → graphite (retired) per the 5-jewel family. It was
  // previously the destructive/rust alert; flagged for review.
  "Do Not Contact": { variant: "category", category: "past" },
}

function renderBadge(spec: BadgeSpec, label: string) {
  if (spec.variant === "category") {
    return (
      <Badge variant="category" category={spec.category}>
        {label}
      </Badge>
    )
  }
  if (spec.variant === "state") {
    return (
      <Badge variant="state" state={spec.state}>
        {label}
      </Badge>
    )
  }
  return <Badge>{label}</Badge>
}

/** Quiet category pill for the contact Type column. Null/empty → nothing. */
export function ContactTypeBadge({ type }: { type: string | null }) {
  if (!type) return null
  return renderBadge(TYPE_MAP[type] ?? NEUTRAL, type)
}

/** Quiet category pill for the lifecycle Status column. Null/empty → nothing. */
export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  return renderBadge(STATUS_MAP[status] ?? NEUTRAL, status)
}
