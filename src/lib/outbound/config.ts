import "server-only"
import { env } from "@/lib/env"
import { OutboundGateway, type ProviderConfig } from "@/lib/outbound/gateway"
import { InMemoryStore, type RateLimitStore } from "@/lib/outbound/store"
import { UpstashStore } from "@/lib/outbound/upstash-store"

/**
 * Per-provider budgets + breaker config — the SINGLE source of truth for the
 * outbound gateway's limits. These are starting points derived from each
 * provider's published limits and are intentionally CONSERVATIVE: they only bite
 * on a true burst (a workflow firing hundreds of sends at once, a bulk import) —
 * ordinary sends pass straight through untouched. Tune the numbers here.
 *
 * Token-bucket meaning:
 *   - capacity  = the largest instantaneous burst allowed (bucket size)
 *   - perSec    = the sustained rate the bucket refills at
 *   - floor*    = each org's GUARANTEED slice (interactive lane reserves it)
 *   - burst*    = the SHARED pool above the floor (bulk uses only this)
 */
export const OUTBOUND_PROVIDERS: Record<string, ProviderConfig> = {
  // Resend's default API limit is ~2 requests/sec (raisable on request). Keep the
  // sustained burst at 2/sec with a little headroom for a human clicking Send.
  resend: {
    budget: { floorCapacity: 3, floorPerSec: 1, burstCapacity: 10, burstPerSec: 2 },
    breaker: { failureThreshold: 5, cooldownMs: 30_000 },
  },
  // Nylas v3 sending is ultimately governed by the connected mailbox (Gmail/MS),
  // which allow a few per second with generous daily quotas. Slightly higher burst.
  nylas: {
    budget: { floorCapacity: 3, floorPerSec: 1, burstCapacity: 10, burstPerSec: 3 },
    breaker: { failureThreshold: 5, cooldownMs: 30_000 },
  },
  // RingCentral: 40 "Medium" requests/extension/min (~0.66/sec); a send is Medium,
  // and a 429 carries a 60s penalty — so the breaker cooldown matches that penalty.
  ringcentral: {
    budget: { floorCapacity: 5, floorPerSec: 0.5, burstCapacity: 10, burstPerSec: 0.5 },
    breaker: { failureThreshold: 5, cooldownMs: 60_000 },
  },
}

/**
 * Pick the token-bucket store: Upstash Redis when BOTH env vars are set (limits
 * hold across regions/instances — TODO H9), otherwise the in-process map (correct
 * for a single Vercel region). Swapping regions is a config change, not a code one.
 */
function selectStore(): RateLimitStore {
  const url = env.UPSTASH_REDIS_REST_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN
  if (url && token) return new UpstashStore({ url, token })
  return new InMemoryStore()
}

let singleton: OutboundGateway | null = null

/**
 * Process-wide gateway singleton. Breaker + token-bucket state must be SHARED
 * across every send in a region, so this is a module-level singleton (not a
 * per-call instance). The store is auto-selected (Upstash when configured, else
 * in-memory) so multi-region is an env change, not a code change.
 */
export function getOutboundGateway(): OutboundGateway {
  singleton ??= new OutboundGateway({
    store: selectStore(),
    providers: OUTBOUND_PROVIDERS,
  })
  return singleton
}
