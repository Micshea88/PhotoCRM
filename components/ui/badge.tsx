import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Badge — THE canonical pill (design-system standard → Shared primitives).
 *
 * ONE padding, ONE font (micro / `text-2xs`), ~3px soft-rectangle corner
 * (`--radius-pill`). The single source that retires the pill drift. Variants:
 *   - `category` — SOLID derived-jewel fill + WHITE text (the editorial pill family:
 *     Client=green, Vendor=terracotta, Lead=slate, VIP=wine, Past=graphite).
 *   - `state`    — state token @15% bg + saturated state fg (destructive/warning/
 *     success/info) — delivery/disposition states, not lifecycle taxonomy.
 *   - `neutral`  — muted bg + muted-foreground fg (the default; tags, counts).
 *
 * Category colors come from `@theme` tokens via inline `style` (dynamic token name
 * can't be a static Tailwind class); the structure is a static class so the JIT
 * scans it.
 */

const BADGE_BASE =
  "inline-flex items-center rounded-[var(--radius-pill)] px-2 py-0.5 text-2xs font-medium"

export type BadgeCategory = "client" | "lead" | "vendor" | "vip" | "past"

export type BadgeState = "destructive" | "warning" | "success" | "info"

type BadgeProps = {
  className?: string
  children: ReactNode
  /** Optional native tooltip (e.g. the AI reasoning behind a classification). */
  title?: string
} & (
  | { variant: "category"; category: BadgeCategory }
  | { variant: "state"; state: BadgeState }
  | { variant?: "neutral" }
)

// STATIC literal var() map (NOT `var(--color-cat-${category})`) so Tailwind v4's
// source scanner sees every token literally and emits it — a dynamically-built name
// gets tree-shaken (that's how cat-vip went missing/invisible).
const CATEGORY_BG: Record<BadgeCategory, string> = {
  client: "var(--color-cat-client)",
  lead: "var(--color-cat-lead)",
  vendor: "var(--color-cat-vendor)",
  vip: "var(--color-cat-vip)",
  past: "var(--color-cat-past)",
}

function badgeStyle(props: BadgeProps): CSSProperties | undefined {
  if (props.variant === "category") {
    // SOLID fill + white text — strongest scan (the mockup's pale tints were the
    // light-tint version; the decision is solid).
    return {
      backgroundColor: CATEGORY_BG[props.category],
      color: "var(--color-primary-foreground)",
    }
  }
  if (props.variant === "state") {
    return {
      backgroundColor: `color-mix(in srgb, var(--color-${props.state}) 15%, transparent)`,
      color: `var(--color-${props.state})`,
    }
  }
  return undefined
}

export function Badge(props: BadgeProps) {
  const neutral = props.variant === undefined || props.variant === "neutral"
  return (
    <span
      className={cn(
        BADGE_BASE,
        neutral && "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
        props.className,
      )}
      style={badgeStyle(props)}
      title={props.title}
    >
      {props.children}
    </span>
  )
}
