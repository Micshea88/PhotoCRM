"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { ConfirmModal } from "@/components/ui/confirm-modal"
import { Button } from "@/components/ui/button"
import {
  sendMemberPasswordReset,
  revokeMemberSessions,
  resendMemberVerification,
} from "@/modules/org/actions"

/**
 * Owner/admin recovery menu for a locked-out team member (Piece B). The server
 * actions enforce the real gate (admin role + in-org membership + audit); this
 * is the surface. Rendered only for other members (never the current user, since
 * revoke refuses self anyway).
 */
type Action = "reset" | "revoke" | "verify"

const CONFIG: Record<
  Action,
  {
    label: string
    title: string
    confirmLabel: string
    destructive: boolean
    body: (name: string) => string
    run: (memberId: string) => Promise<{ serverError?: string } | undefined>
  }
> = {
  reset: {
    label: "Send password reset",
    title: "Send a password reset?",
    confirmLabel: "Send reset email",
    destructive: false,
    body: (name) => `We'll email a fresh password-reset link to ${name}.`,
    run: (memberId) => sendMemberPasswordReset({ memberId }),
  },
  revoke: {
    label: "Revoke sessions",
    title: "Sign this member out everywhere?",
    confirmLabel: "Revoke sessions",
    destructive: true,
    body: (name) => `${name} will be signed out on every device and must sign in again.`,
    run: (memberId) => revokeMemberSessions({ memberId }),
  },
  verify: {
    label: "Resend verification",
    title: "Resend the verification email?",
    confirmLabel: "Resend email",
    destructive: false,
    body: (name) => `We'll send ${name} a new email-verification link.`,
    run: (memberId) => resendMemberVerification({ memberId }),
  },
}

export function MemberRecoveryMenu({
  memberId,
  memberName,
}: {
  memberId: string
  memberName: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState<Action | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function confirm() {
    if (!pending) return
    setSubmitting(true)
    const result = await CONFIG[pending].run(memberId)
    setSubmitting(false)
    setPending(null)
    if (result?.serverError) {
      alert(result.serverError)
      return
    }
    router.refresh()
  }

  const cfg = pending ? CONFIG[pending] : null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" aria-label={`Recovery options for ${memberName}`}>
            ⋯
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setPending("reset")
            }}
          >
            {CONFIG.reset.label}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setPending("revoke")
            }}
          >
            {CONFIG.revoke.label}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setPending("verify")
            }}
          >
            {CONFIG.verify.label}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {cfg && (
        <ConfirmModal
          open
          onClose={() => {
            setPending(null)
          }}
          onConfirm={() => void confirm()}
          title={cfg.title}
          body={cfg.body(memberName)}
          confirmLabel={cfg.confirmLabel}
          destructive={cfg.destructive}
          submitting={submitting}
        />
      )}
    </>
  )
}
