"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { Alert, AlertDescription } from "@/components/ui/alert"

export function VerifyEmailRunner() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get("token")
  const ran = useRef(false)
  const [state, setState] = useState<"idle" | "ok" | "error">("idle")
  const [message, setMessage] = useState<string>("")

  useEffect(() => {
    if (ran.current || !token) return
    ran.current = true
    void (async () => {
      const result = await authClient.verifyEmail({ query: { token } })
      if (result.error) {
        setState("error")
        setMessage(result.error.message ?? "Verification failed")
        return
      }
      setState("ok")
      setTimeout(() => {
        router.push("/dashboard")
        router.refresh()
      }, 800)
    })()
  }, [token, router])

  if (!token) {
    return (
      <Alert variant="destructive">
        <AlertDescription>This verification link is invalid.</AlertDescription>
      </Alert>
    )
  }
  if (state === "error") {
    return (
      <Alert variant="destructive">
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    )
  }
  if (state === "ok") {
    return (
      <Alert>
        <AlertDescription>Email verified. Redirecting…</AlertDescription>
      </Alert>
    )
  }
  return <p className="text-sm text-[var(--color-muted-foreground)]">Verifying your email…</p>
}
