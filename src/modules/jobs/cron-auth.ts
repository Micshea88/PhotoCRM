import "server-only"
import { timingSafeEqual } from "node:crypto"
import { env } from "@/lib/env"

/**
 * Verifies a shared-secret request header in constant time. Use for cron
 * (`Authorization: Bearer <CRON_SECRET>`) and queue (`x-queue-secret`) routes.
 *
 * Constant-time comparison prevents secret-recovery via timing oracle: a `===`
 * compare returns earlier on a wrong byte than a right byte, leaking the secret
 * one byte at a time over enough requests.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8")
  const bBuf = Buffer.from(b, "utf8")
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

/**
 * Vercel Cron sets `Authorization: Bearer ${CRON_SECRET}` and a
 * `User-Agent: vercel-cron/1.0` header on requests when CRON_SECRET is set as
 * an env var on the Vercel project. We require BOTH to defend against a
 * leaked secret being replayed from a non-Vercel client.
 */
export function verifyCronAuth(request: Request): boolean {
  const auth = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${env.CRON_SECRET}`
  if (!constantTimeEqual(auth, expected)) return false

  // Outside production we don't enforce the UA check (local curl tests, CI).
  if (env.NODE_ENV !== "production") return true
  const ua = request.headers.get("user-agent") ?? ""
  return ua.startsWith("vercel-cron/")
}

/**
 * Verifies the shared-secret header on internal queue routes (producer → consumer).
 */
export function verifyQueueAuth(request: Request): boolean {
  const provided = request.headers.get("x-queue-secret") ?? ""
  return constantTimeEqual(provided, env.QUEUE_SECRET)
}
