import { cn } from "@/lib/utils"

/**
 * 26px category-colored avatar for a contact row (reskin Phase 4d). The
 * background is the contactType's CATEGORY-tier token (the design's "quiet
 * functional tier" — category colors appear on dots/badges/26px avatars ONLY,
 * never on chrome). Presentation-only, computed client-side from data already
 * on the row — no data/column change.
 */

// contactType (CONTACT_TYPES) → category token. Client types share the client
// token; contractor maps to the payment token (paid worker); unknown/null →
// neutral taupe so it still looks intentional.
const TYPE_COLOR: Record<string, string> = {
  Lead: "var(--color-cat-lead)",
  "Active Client": "var(--color-cat-client)",
  "Past Client": "var(--color-cat-past)",
  Vendor: "var(--color-cat-vendor)",
  Contractor: "var(--color-cat-vendor)",
  "Referral Partner": "var(--color-cat-lead)",
}

function initials(firstName: string, lastName: string): string {
  const f = firstName.trim()[0] ?? ""
  const l = lastName.trim()[0] ?? ""
  return (f + l).toUpperCase() || "?"
}

export function ContactTypeAvatar({
  type,
  firstName,
  lastName,
  className,
}: {
  type: string | null
  firstName: string
  lastName: string
  className?: string
}) {
  const bg = (type ? TYPE_COLOR[type] : undefined) ?? "var(--color-muted-foreground)"
  return (
    <span
      className={cn(
        "text-3xs flex size-[26px] shrink-0 items-center justify-center rounded-full font-medium text-[var(--color-primary-foreground)]",
        className,
      )}
      style={{ backgroundColor: bg }}
      aria-hidden="true"
    >
      {initials(firstName, lastName)}
    </span>
  )
}
