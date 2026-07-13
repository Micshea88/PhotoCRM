import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * CommitBar — the one bottom-commit container (design-system standard → Shared
 * primitives). Owns the commit-spacing tokens so the gap from the last content
 * block to the commit buttons, and from the buttons to the page bottom, is the
 * SAME everywhere: `--space-commit-gap` above, `--space-commit-bottom` below.
 *
 * Reused by the merge screen and the (pending) sticky save bar. Actions align
 * right by default; pass `justify-*` via `className` to override. The token
 * margins are inline `style` (token-driven, so the future arbitrary-spacing
 * guard doesn't flag them as off-scale literals).
 */
export function CommitBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("flex items-center justify-end gap-3", className)}
      style={{
        marginTop: "var(--space-commit-gap)",
        marginBottom: "var(--space-commit-bottom)",
      }}
    >
      {children}
    </div>
  )
}
