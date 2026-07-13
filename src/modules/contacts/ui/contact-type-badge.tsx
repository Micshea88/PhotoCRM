import type { CSSProperties } from "react"

// Shared pill base classes — structure only, no color.
// Static string so Tailwind JIT can scan it.
const BADGE_BASE =
  "inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium"

// Neutral variant — muted bg + muted fg via token Tailwind classes.
// Also static so the scanner picks up bg-[var(…)] and text-[var(…)].
const NEUTRAL_CLASS =
  "inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"

interface BadgeConfig {
  className: string
  style?: CSSProperties
}

/** Build a category badge config using tint bg + saturated fg from tokens. */
function catBadge(token: string): BadgeConfig {
  return {
    className: BADGE_BASE,
    style: {
      backgroundColor: `var(--color-cat-${token}-tint)`,
      color: `var(--color-cat-${token})`,
    },
  }
}

const NEUTRAL: BadgeConfig = { className: NEUTRAL_CLASS }

const TYPE_MAP: Record<string, BadgeConfig> = {
  Lead: catBadge("lead"),
  "Active Client": catBadge("referral"),
  "Past Client": catBadge("payment"),
  Vendor: NEUTRAL,
  Contractor: NEUTRAL,
  "Referral Partner": catBadge("blush"),
}

const STATUS_MAP: Record<string, BadgeConfig> = {
  Active: catBadge("referral"),
  VIP: catBadge("payment"),
  Inactive: NEUTRAL,
  "Do Not Contact": {
    className: BADGE_BASE,
    style: {
      backgroundColor: "color-mix(in srgb, var(--color-destructive) 15%, transparent)",
      color: "var(--color-destructive)",
    },
  },
}

/**
 * Quiet category pill for the contact Type column.
 * Null / empty → renders nothing (blank cell).
 */
export function ContactTypeBadge({ type }: { type: string | null }) {
  if (!type) return null
  const badge = TYPE_MAP[type] ?? NEUTRAL
  return (
    <span className={badge.className} style={badge.style}>
      {type}
    </span>
  )
}

/**
 * Quiet category pill for the lifecycle Status column.
 * Null / empty → renders nothing (blank cell).
 */
export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  const badge = STATUS_MAP[status] ?? NEUTRAL
  return (
    <span className={badge.className} style={badge.style}>
      {status}
    </span>
  )
}
