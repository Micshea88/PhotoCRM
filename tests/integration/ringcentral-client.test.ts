/**
 * Tests for RingCentralClient core behavior (Build 1). Runs in the Node
 * (integration) env so it can import the server-only client cleanly; it does
 * NOT touch the database — all deps (token getter, fetch, sleep) are injected.
 *
 * Covers: Bearer auth header, correct URL building for getCall, 429 retry then
 * success, 429 exhaustion → typed RingCentralApiError, non-2xx → typed error.
 */
import { describe, it, expect, vi } from "vitest"
import { RingCentralClient, RingCentralApiError } from "@/lib/ringcentral/client"

const BASE = "https://platform.ringcentral.com"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function makeFetch(responses: Response[]) {
  const calls: { url: string; init?: RequestInit }[] = []
  let i = 0
  const fetchImpl = vi.fn((url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const r = responses[Math.min(i, responses.length - 1)]
    i += 1
    return r ? Promise.resolve(r) : Promise.reject(new Error("no response queued"))
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

function client(fetchImpl: typeof fetch, maxRetries = 2) {
  return new RingCentralClient({
    baseUrl: BASE,
    getAccessToken: () => Promise.resolve("tok-123"),
    fetchImpl,
    sleep: () => Promise.resolve(), // no real backoff in tests
    maxRetries,
  })
}

describe("RingCentralClient", () => {
  it("getCall builds the Detailed call-log URL and sends the Bearer token", async () => {
    const { fetchImpl, calls } = makeFetch([
      jsonResponse({ id: "rc1", startTime: "2026-06-13T00:00:00Z" }),
    ])
    const rec = await client(fetchImpl).getCall("rc1")
    expect(rec.id).toBe("rc1")
    expect(calls[0]?.url).toBe(`${BASE}/restapi/v1.0/account/~/call-log/rc1?view=Detailed`)
    const sentHeaders = new Headers(calls[0]?.init?.headers)
    expect(sentHeaders.get("authorization")).toBe("Bearer tok-123")
  })

  it("retries once on 429 then succeeds", async () => {
    const limited = new Response("", { status: 429, headers: { "Retry-After": "0" } })
    const { fetchImpl, calls } = makeFetch([limited, jsonResponse({ id: "rc1", startTime: "x" })])
    const rec = await client(fetchImpl, 2).getCall("rc1")
    expect(rec.id).toBe("rc1")
    expect(calls.length).toBe(2)
  })

  it("throws a rate-limited RingCentralApiError after exhausting retries", async () => {
    const { fetchImpl, calls } = makeFetch([
      new Response("", { status: 429 }),
      new Response("", { status: 429 }),
    ])
    await expect(client(fetchImpl, 1).getCall("rc1")).rejects.toMatchObject({
      status: 429,
      rateLimited: true,
    })
    expect(calls.length).toBe(2) // initial + 1 retry
  })

  it("throws a typed error on a non-2xx (e.g. 404)", async () => {
    const { fetchImpl } = makeFetch([new Response("not found", { status: 404 })])
    await expect(client(fetchImpl).getCall("missing")).rejects.toBeInstanceOf(RingCentralApiError)
  })
})
