/**
 * Outbound gateway — step 5, Upstash store. We can't run real Lua here, so we
 * assert the OBSERVABLE contract at the REST boundary: it issues an EVAL with the
 * namespaced key + bucket args, parses Upstash's {result:[ok,retryAfterMs]}, and
 * FAILS OPEN (admits) on any Redis error rather than blocking sends.
 */
import { describe, it, expect, vi } from "vitest"
import { UpstashStore } from "@/lib/outbound/upstash-store"

vi.mock("@/lib/log", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

function fetchReturning(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(() =>
    Promise.resolve({ ok, status, json: () => Promise.resolve(body) }),
  ) as unknown as typeof fetch
}

const cfg = (fetchImpl: typeof fetch) => ({
  url: "https://example.upstash.io",
  token: "tok",
  fetchImpl,
})

describe("UpstashStore", () => {
  it("issues an EVAL with the namespaced key and bucket args", async () => {
    const fetchImpl = fetchReturning({ result: [1, 0] })
    const store = new UpstashStore(cfg(fetchImpl))
    await store.take("resend:orgA", 1, 10, 2, 1_000_000)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    if (!call) throw new Error("fetch was not called")
    const [url, init] = call as [string, RequestInit]
    expect(url).toBe("https://example.upstash.io")
    const body = JSON.parse(init.body as string) as string[]
    expect(body[0]).toBe("EVAL")
    expect(body[2]).toBe("1") // one KEY
    expect(body[3]).toBe("ob:resend:orgA") // namespaced key
    expect(body.slice(4)).toEqual(["1", "10", "2", "1000000"]) // cost, cap, refill, now
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok" })
  })

  it("parses an admit result", async () => {
    const store = new UpstashStore(cfg(fetchReturning({ result: [1, 0] })))
    expect(await store.take("k", 1, 10, 2, 1)).toEqual({ ok: true, retryAfterMs: 0 })
  })

  it("parses a refusal result with retryAfterMs", async () => {
    const store = new UpstashStore(cfg(fetchReturning({ result: [0, 500] })))
    expect(await store.take("k", 1, 10, 2, 1)).toEqual({ ok: false, retryAfterMs: 500 })
  })

  it("fails OPEN on a non-2xx response", async () => {
    const store = new UpstashStore(cfg(fetchReturning({}, false, 500)))
    expect(await store.take("k", 1, 10, 2, 1)).toEqual({ ok: true, retryAfterMs: 0 })
  })

  it("fails OPEN when Redis is unreachable", async () => {
    const throwing = vi.fn(() =>
      Promise.reject(new Error("ECONNREFUSED")),
    ) as unknown as typeof fetch
    const store = new UpstashStore(cfg(throwing))
    expect(await store.take("k", 1, 10, 2, 1)).toEqual({ ok: true, retryAfterMs: 0 })
  })

  it("fails OPEN on a malformed result", async () => {
    const store = new UpstashStore(cfg(fetchReturning({ result: [1] })))
    expect(await store.take("k", 1, 10, 2, 1)).toEqual({ ok: true, retryAfterMs: 0 })
  })
})
