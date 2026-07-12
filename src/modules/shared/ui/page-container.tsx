import { type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Page layout primitives — the SINGLE source of horizontal gutters + max width
 * (LAW 6). Every page composes `PageContainer`; no page hand-rolls its own
 * width/padding. `main` (client-layout-shell) owns vertical rhythm only, so
 * there is exactly one owner per axis (no doubled gutters).
 *
 * Every variant is FLUID and reflows — none is a pinned/centered island:
 *   - `full`    — no max width (contact-card model; the default posture).
 *   - `default` — fluid up to a generous readable ceiling, centered only past it.
 *   - `narrow`  — fluid up to a tight ~66ch ceiling for single-column forms/text.
 */

// Readable ceilings — one-line adjustable. `full` has no ceiling.
export const PAGE_MAX_DEFAULT = "max-w-[1100px]"
export const PAGE_MAX_NARROW = "max-w-[720px]"

export type PageVariant = "full" | "default" | "narrow"

const VARIANT_CLASS: Record<PageVariant, string> = {
  full: "w-full px-6",
  default: cn("mx-auto w-full px-6", PAGE_MAX_DEFAULT),
  narrow: cn("mx-auto w-full px-6", PAGE_MAX_NARROW),
}

export function PageContainer({
  variant = "full",
  className,
  children,
}: {
  variant?: PageVariant
  className?: string
  children: ReactNode
}) {
  return <div className={cn(VARIANT_CLASS[variant], className)}>{children}</div>
}

/**
 * PageHeader — title (font-serif; put an `<em>` around a word for the wireframe
 * italic-emphasis treatment) with an optional description + actions slot. The
 * description and actions use font-sans.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="font-serif text-2xl leading-tight text-[var(--color-foreground)]">
          {title}
        </h1>
        {description && (
          <p className="font-sans text-sm text-[var(--color-muted-foreground)]">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 font-sans">{actions}</div>
      )}
    </div>
  )
}

/**
 * PageSection — a grouped block with consistent vertical spacing and an optional
 * font-serif section title.
 */
export function PageSection({
  title,
  children,
  className,
}: {
  title?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("space-y-4", className)}>
      {title && <h2 className="font-serif text-lg text-[var(--color-foreground)]">{title}</h2>}
      {children}
    </section>
  )
}
