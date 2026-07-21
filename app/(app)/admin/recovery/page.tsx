import { notFound } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import { isPathwaySuperadmin } from "@/modules/superadmin/access"
import { RecoveryConsole } from "@/modules/superadmin/ui/recovery-console"

/**
 * Pathway-staff cross-tenant account-recovery console (Piece C). Server-guarded:
 * anyone not on the `PATHWAY_SUPERADMIN_EMAILS` allowlist gets a 404 — the page
 * doesn't reveal it exists. The recovery actions re-check the allowlist too
 * (defense-in-depth).
 */
export default async function SuperadminRecoveryPage() {
  const session = await getSession()
  if (!session?.user || !isPathwaySuperadmin(session.user.email)) {
    notFound()
  }
  return (
    <div className="mx-auto max-w-xl space-y-6 py-8">
      <div className="space-y-1">
        <h1 className="font-serif text-2xl font-semibold">Account recovery</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Pathway-staff tool for a locked-out account. Credential recovery only — this never reads a
          studio&apos;s data.
        </p>
      </div>
      <RecoveryConsole />
    </div>
  )
}
