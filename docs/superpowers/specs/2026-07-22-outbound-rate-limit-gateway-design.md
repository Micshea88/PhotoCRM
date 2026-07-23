# Outbound rate-limit gateway — design

**Date:** 2026-07-22
**Status:** IMPLEMENTED (2026-07-22) — all 6 steps merged (PRs #10–#17). All three
providers (Resend, Nylas, RingCentral) route live through the gateway; Upstash is
env-gated + dormant until provisioned; the throttle signal is emitted + recorded
(UI surface intentionally deferred to the notifications module).
**Policy:** #5 (every outbound provider call goes through a rate-limited, 429-aware, retrying client) + TODO H9 (multi-region rate-limit storage). Locked hardening decision transcribed in `docs/pre-events-punchlist.md` §3.

## Why

Today outbound provider calls are inconsistent: **RingCentral** has a proper
429/`Retry-After`-aware retry client (`src/lib/ringcentral/client.ts` — the
template), but **Resend** (`src/lib/email.ts` → `resend().emails.send`) and
**Nylas** (`src/lib/email/nylas.ts` → raw `fetch`) have **no** rate-limiting,
retry, or backoff. A burst (a workflow sending 200 emails; an import) can trip a
provider's limit and drop client-facing sends. One gateway makes every outbound
call rate-limited, fair across studios, and crash-safe.

## Non-goals

- Not a general HTTP client. Only the three providers behind it: Nylas, Resend,
  RingCentral.
- Not building the public-API inbound rate limit (that's the `/api/v1` API-key
  layer, separate).

## Architecture

One **gateway** with thin per-provider **adapters**, a pluggable **store**, and a
**two-lane scheduler** that leans on the existing A3 durable queue for bulk work.

### 1. Store abstraction (in-memory now, Upstash later)

`RateLimitStore` — the only thing that changes between single-region and
multi-region:

```
interface RateLimitStore {
  take(key, cost, capacity, refillPerSec): Promise<{ ok: boolean; retryAfterMs: number }>
  // circuit-breaker state
  getBreaker(provider): Promise<BreakerState>
  setBreaker(provider, state): Promise<void>
}
```

- **`InMemoryStore`** (default) — a token bucket in process memory. Correct for a
  **single Vercel region** (where we are today).
- **`UpstashStore`** (when `UPSTASH_REDIS_REST_URL`/`_TOKEN` are set) — the same
  bucket in Redis via atomic Lua, so limits hold **across regions/instances**
  (TODO H9). Owner sets up Upstash + env vars later; the gateway auto-selects it.

### 2. Per-org fairness — floor + shared burst (NOT equal slices)

Each provider has a total budget (e.g. Resend N/sec). Split:

- **Guaranteed floor:** every org with traffic always gets `floor` tokens/sec —
  one noisy studio can't starve another.
- **Shared burst:** the remaining capacity is a common pool, first-come. A studio
  bursting past its floor draws from the shared pool if it's free.

Keyed `provider:org` for the floor bucket + `provider:_burst` shared.

### 3. Two lanes — interactive beats bulk

- **Interactive** (a human is waiting — e.g. "Send" clicked in the composer): may
  take from the floor immediately and, if throttled, do a **short bounded wait**
  (the person is right there).
- **Bulk** (a workflow batch, an import): only draws **leftover** capacity after
  interactive, and never sleep-blocks (below).

Interactive always preempts: bulk is only admitted when the interactive lane has
headroom.

### 4. Retries are REQUEUES, not sleeps

- **Interactive**, throttled: bounded short retry with **full jitter** backoff
  (`random(0, base·2^attempt)`), a couple of attempts, then surface an error.
- **Bulk**, throttled: **do not sleep a serverless function.** Enqueue a
  `background_jobs` job (the A3 durable queue) with `scheduledFor = now + backoff`
  so the send is retried on the next drain. Crash-safe + idempotency-keyed
  (providers already dedup on our keys) — reuses the whole A3 machine.

### 5. Circuit breaker per provider

Per provider: after `N` consecutive failures the breaker **opens** (fail fast for
a cooldown); a single **half-open** probe tests recovery; success **closes** it.
Stops hammering a down provider and cascading timeouts. State in the store (shared
in multi-region).

### 6. Adapters — extract RingCentral as the template

The RC client already does 429/`Retry-After` + backoff + jitter with injectable
deps. **Generalize that retry loop into the gateway**, and reduce each adapter to:
build the request, send it, and classify the response (ok / rate-limited +
`Retry-After` / transient / permanent). Adapters:

- `resendAdapter` — wraps `resend().emails.send`.
- `nylasAdapter` — wraps the Nylas `fetch` sends.
- `ringcentralAdapter` — the existing client, refactored to hand its
  429-classification to the gateway (don't rewrite it — extract).

### 7. Throttle visibility — tell the studio

When an org's sends are being queued/delayed by throttling, surface it (a
structured signal → a notification / a small "sends are catching up" indicator),
so a studio isn't left wondering why an email is slow. Exact surface TBD with the
notifications module; the gateway emits the signal.

## Build plan (incremental — each its own PR, behind `verify --tier=2`)

1. ✅ **Core engine** — `RateLimitStore` + `InMemoryStore` + floor/burst token
   bucket + full-jitter backoff. (PR #10)
2. ✅ **Circuit breaker** — per-provider breaker (`circuit-breaker.ts`). (PR #11)
3. ✅ **Two-lane scheduler + requeue-not-sleep** — `OutboundGateway.execute`;
   interactive reserves the org floor + bounded retry, bulk is burst-only and
   throws on throttle so the enclosing durable job reschedules (requeue-not-sleep
   reuses A3 — no new job type). (PR #12)
4. ✅ **Adapters (LIVE)** — 4a: assembled singleton + owner-confirmed budgets
   (PR #13). 4b: Resend/`sendEmail` routed through the gateway, workflow send on
   the bulk lane (PR #14). 4c: Nylas (`nylasSendMessageRaw` extracted) + RC
   (`request` wraps the existing 429 retry `requestRaw` once — extract, not
   rewrite), org threaded through both (PR #15).
5. ✅ **Upstash store** — env-gated `UpstashStore` (atomic Lua, fail-open),
   auto-selected by `getOutboundGateway()`. Dormant until owner provisions
   Upstash. (PR #16)
6. ✅ **Throttle visibility** — gateway emits `onThrottle`; config logs a stable
   `outbound.throttled` event + records to `ThrottleLog` (`isCatchingUp(orgId)`).
   The UI surface (indicator / notification) is deferred to the notifications
   module — the gateway just emits. (PR #17)

## Owner decisions to confirm

- **OK to build the engine (step 1) now** with in-memory store, Upstash slotted in
  at step 5 (so we're not blocked on your Upstash setup)?
- **Requeue-not-sleep for bulk via the A3 queue** — confirm that integration (it
  means a throttled bulk send becomes a queued job, not an inline wait).
- **Concrete per-provider budgets** (Resend/Nylas/RC per-sec limits + floor) — I'll
  propose sane defaults from each provider's published limits; you confirm at the
  adapter step.
