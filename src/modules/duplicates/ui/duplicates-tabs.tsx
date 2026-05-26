import Link from "next/link"
import { cn } from "@/lib/utils"

/**
 * Push 4 (B1) — entity tab strip for /contacts/duplicates and
 * /companies/duplicates. Same shape as the
 * /settings/custom-fields tab strip (Push 4 A2).
 *
 * Tab labels come from the terminology pack (`contact` / `company`
 * plurals). DO NOT hardcode "Contacts" / "Companies" — photographers
 * and other V1 verticals may use different nouns. The route file
 * resolves the labels via getLabel() and passes them in.
 */
export function DuplicatesTabs({
  contactLabel,
  companyLabel,
  active,
}: {
  contactLabel: string
  companyLabel: string
  active: "contact" | "company"
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-[var(--color-border)]">
      <TabLink href="/contacts/duplicates" label={contactLabel} active={active === "contact"} />
      <TabLink href="/companies/duplicates" label={companyLabel} active={active === "company"} />
    </div>
  )
}

function TabLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      role="tab"
      aria-selected={active}
      href={href}
      className={cn(
        "border-b-2 px-4 py-2 text-sm transition-colors",
        active
          ? "border-[var(--color-primary)] font-medium text-[var(--color-foreground)]"
          : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
      )}
    >
      {label}
    </Link>
  )
}
