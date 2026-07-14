import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Badge — THE canonical pill (design-system standard → Shared primitives).
 *
 * ONE padding, ONE font (micro / `text-2xs`), ~3px soft-rectangle corner
 * (`--radius-pill`). The single source that retires the pill drift. Variants:
 *   - `category` — MUTED-TINT: a pale wash of the category hue as the background +
 *     the full-strength hue as the TEXT (the editorial pill family: Client=green,
 *     Vendor=terracotta, Lead=slate, VIP=wine, Past=graphite). Quiet tinted pills —
 *     the saturated color lives on the name avatar, not the pill.
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

// STATIC literal var() maps (NOT `var(--color-cat-${category})`) so Tailwind v4's
// source scanner sees every token literally and emits it — a dynamically-built name
// gets tree-shaken (that's how cat-vip went missing/invisible). Two maps: the pale
// TINT for the pill background, the full hue for the TEXT.
const CATEGORY_TINT: Record<BadgeCategory, string> = {
  client: "var(--color-cat-client-tint)",
  lead: "var(--color-cat-lead-tint)",
  vendor: "var(--color-cat-vendor-tint)",
  vip: "var(--color-cat-vip-tint)",
  past: "var(--color-cat-past-tint)",
}
const CATEGORY_FG: Record<BadgeCategory, string> = {
  client: "var(--color-cat-client)",
  lead: "var(--color-cat-lead)",
  vendor: "var(--color-cat-vendor)",
  vip: "var(--color-cat-vip)",
  past: "var(--color-cat-past)",
}

function badgeStyle(props: BadgeProps): CSSProperties | undefined {
  if (props.variant === "category") {
    // MUTED-TINT: pale hue wash bg + full hue text (the decided pill treatment).
    return {
      backgroundColor: CATEGORY_TINT[props.category],
      color: CATEGORY_FG[props.category],
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
