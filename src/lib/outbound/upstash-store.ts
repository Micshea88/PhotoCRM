import "server-only"
import { log } from "@/lib/log"
import type { RateLimitStore, TakeResult } from "@/lib/outbound/store"

/**
 * Upstash Redis (REST) implementation of the token-bucket store — the multi-region
 * swap for `InMemoryStore` (TODO H9). Same interface; the ONLY thing that changes
 * between single-region and multi-region. Selected by `getOutboundGateway()` when
 * `UPSTASH_REDIS_REST_URL`/`_TOKEN` are set.
 *
 * The refill-and-spend is ONE atomic Lua script (`EVAL`), so concurrent instances
 * across regions can't race the same bucket — the whole point of moving off the
 * in-process map. `now` is passed in as a script arg (not read from Redis) so the
 * bucket math matches `InMemoryStore` exactly and stays unit-testable.
 *
 * Fail-OPEN: if Redis is unreachable we ADMIT the send (and warn) rather than
 * block it. A brief loss of rate-limiting is far less bad than blocking every
 * client email during a Redis blip — and the circuit breaker still catches a
 * genuinely failing provider.
 */

// Refill the bucket by elapsed time, then try to spend `cost`. Returns
// {ok(0|1), retryAfterMs}. Mirrors InMemoryStore.take exactly.
const TAKE_LUA = `
local key = KEYS[1]
local cost = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refillPerSec = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local data = redis.call('HMGET', key, 'tokens', 'last')
local tokens = tonumber(data[1])
local last = tonumber(data[2])
if tokens == nil then tokens = capacity; last = now end
local refilled = math.min(capacity, tokens + ((now - last) / 1000) * refillPerSec)
-- TTL long enough to fully refill twice, so an in-progress bucket is never
-- evicted mid-window; idle buckets still expire and self-clean.
local ttl = math.max(60000, math.ceil(capacity / refillPerSec * 2) * 1000)
if refilled >= cost then
  redis.call('HMSET', key, 'tokens', refilled - cost, 'last', now)
  redis.call('PEXPIRE', key, ttl)
  return {1, 0}
else
  redis.call('HMSET', key, 'tokens', refilled, 'last', now)
  redis.call('PEXPIRE', key, ttl)
  local deficit = cost - refilled
  return {0, math.ceil((deficit / refillPerSec) * 1000)}
end
`.trim()

export interface UpstashStoreConfig {
  url: string
  token: string
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch
}

export class UpstashStore implements RateLimitStore {
  private readonly fetchImpl: typeof fetch

  constructor(private readonly cfg: UpstashStoreConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch
  }

  async take(
    key: string,
    cost: number,
    capacity: number,
    refillPerSec: number,
    now: number = Date.now(),
  ): Promise<TakeResult> {
    // Namespace the key so it never collides with other Upstash usage.
    const redisKey = `ob:${key}`
    const command = [
      "EVAL",
      TAKE_LUA,
      "1",
      redisKey,
      String(cost),
      String(capacity),
      String(refillPerSec),
      String(now),
    ]
    try {
      const res = await this.fetchImpl(this.cfg.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.cfg.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
        cache: "no-store",
      })
      if (!res.ok) {
        log.warn(
          { status: res.status, key },
          "[outbound] Upstash take failed — admitting (fail-open)",
        )
        return { ok: true, retryAfterMs: 0 }
      }
      const json = (await res.json()) as { result?: number[] }
      const result = json.result
      if (!result || result.length < 2) {
        log.warn({ key }, "[outbound] Upstash returned no result — admitting (fail-open)")
        return { ok: true, retryAfterMs: 0 }
      }
      return { ok: result[0] === 1, retryAfterMs: result[1] ?? 0 }
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), key },
        "[outbound] Upstash unreachable — admitting (fail-open)",
      )
      return { ok: true, retryAfterMs: 0 }
    }
  }
}
