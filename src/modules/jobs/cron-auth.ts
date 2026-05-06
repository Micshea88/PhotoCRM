import "server-only"
import { env } from "@/lib/env"

/**
 * Vercel Cron sets `Authorization: Bearer ${CRON_SECRET}` on the request when
 * CRON_SECRET is set as an env var on the Vercel project. This helper verifies
 * the header and is the only auth on cron routes.
 */
export function verifyCronAuth(request: Request): boolean {
  const auth = request.headers.get("authorization")
  return auth === `Bearer ${env.CRON_SECRET}`
}
