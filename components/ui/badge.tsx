import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Badge — THE canonical pill (design-system standard → Shared primitives).
 *
 * ONE padding, ONE font (micro / `text-2xs`), `rounded-full`. This is the single
 * source that retires the pill drift (padding px-1.5/2/3/4, font 2xs/xs/sm, fill
 * muted/secondary/cat-tint/bordered). Three variants:
 *   - `category` — pale category `-tint` bg + SATURATED category fg (taxonomy: type,
 *     status, tags). The restraint is in the tint bg, NOT a dimmed fg.
 *   - `state`    — state token @15% bg + SATURATED state fg (destructive/warning/
 *     success/info).
 *   - `neutral`  — muted bg + muted-foreground fg (the default).
 *
 * Colors come from `@theme` tokens via inline `style` because the token name is
 * dynamic (can't be a static Tailwind class); the structure is a static class so
 * the JIT scans it. `interactive` adds the canonical hover/focus for clickable
 * chips (filter/sort) — pair it with an `onClick` via `asButton`.
 */

const BADGE_BASE = "inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium"

export type BadgeCategory =
  | "lead"
  | "client"
  | "referral"
  | "vendor"
  | "payment"
  | "scheduling"
  | "blush"

export type BadgeState = "destructive" | "warning" | "success" | "info"

type BadgeProps = {
  className?: string
  children: ReactNode
} & (
  | { variant: "category"; category: BadgeCategory }
  | { variant: "state"; state: BadgeState }
  | { variant?: "neutral" }
)

function badgeStyle(props: BadgeProps): CSSProperties | undefined {
  if (props.variant === "category") {
    return {
      backgroundColor: `var(--color-cat-${props.category}-tint)`,
      color: `var(--color-cat-${props.category})`,
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
    >
      {props.children}
    </span>
  )
}
