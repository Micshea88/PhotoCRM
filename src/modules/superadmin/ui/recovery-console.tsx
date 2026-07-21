"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ConfirmModal } from "@/components/ui/confirm-modal"
import {
  superadminSendPasswordReset,
  superadminRevokeSessions,
  superadminResendVerification,
} from "@/modules/superadmin/actions"

type Action = "reset" | "revoke" | "verify"

const CONFIG: Record<
  Action,
  {
    label: string
    title: string
    confirmLabel: string
    destructive: boolean
    body: (email: string) => string
    ok: (email: string) => string
    run: (email: string) => Promise<{ serverError?: string } | undefined>
  }
> = {
  reset: {
    label: "Send password reset",
    title: "Send a password reset?",
    confirmLabel: "Send reset email",
    destructive: false,
    body: (e) => `Email a fresh password-reset link to ${e}.`,
    ok: (e) => `Password-reset email sent to ${e}.`,
    run: (email) => superadminSendPasswordReset({ email }),
  },
  revoke: {
    label: "Revoke all sessions",
    title: "Sign this account out everywhere?",
    confirmLabel: "Revoke sessions",
    destructive: true,
    body: (e) => `${e} will be signed out on every device and must sign in again.`,
    ok: (e) => `All sessions for ${e} were revoked.`,
    run: (email) => superadminRevokeSessions({ email }),
  },
  verify: {
    label: "Resend verification",
    title: "Resend the verification email?",
    confirmLabel: "Resend email",
    destructive: false,
    body: (e) => `Send a new email-verification link to ${e}.`,
    ok: (e) => `Verification email sent to ${e}.`,
    run: (email) => superadminResendVerification({ email }),
  },
}

export function RecoveryConsole() {
  const [email, setEmail] = useState("")
  const [pending, setPending] = useState<Action | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  const trimmed = email.trim()
  const cfg = pending ? CONFIG[pending] : null

  async function confirm() {
    if (!pending) return
    setSubmitting(true)
    setResult(null)
    const action = CONFIG[pending]
    const res = await action.run(trimmed)
    setSubmitting(false)
    setPending(null)
    if (res?.serverError) {
      setResult({ kind: "error", text: res.serverError })
      return
    }
    setResult({ kind: "ok", text: action.ok(trimmed) })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="recovery-email">Account email</Label>
        <Input
          id="recovery-email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
          }}
          placeholder="owner@studio.com"
        />
      </div>

      <div className="flex flex-col gap-2">
        {(Object.keys(CONFIG) as Action[]).map((a) => (
          <Button
            key={a}
            type="button"
            variant={CONFIG[a].destructive ? "destructive" : "outline"}
            disabled={!trimmed}
            onClick={() => {
              setResult(null)
              setPending(a)
            }}
          >
            {CONFIG[a].label}
          </Button>
        ))}
      </div>

      {result && (
        <Alert variant={result.kind === "error" ? "destructive" : "default"}>
          <AlertDescription>{result.text}</AlertDescription>
        </Alert>
      )}

      {cfg && (
        <ConfirmModal
          open
          onClose={() => {
            setPending(null)
          }}
          onConfirm={() => void confirm()}
          title={cfg.title}
          body={cfg.body(trimmed)}
          confirmLabel={cfg.confirmLabel}
          destructive={cfg.destructive}
          submitting={submitting}
        />
      )}
    </div>
  )
}
