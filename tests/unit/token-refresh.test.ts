/**
 * Unit coverage for the token-refresh helper
 * (src/modules/telephony/token-refresh.ts).
 *
 * Pure-logic cases; real Postgres is NOT involved. The SELECT FOR
 * UPDATE concurrency proof lives in the matching integration test.
 *
 * Boundaries mocked:
 *   - @/lib/env             — RC credentials.
 *   - @/lib/crypto          — decrypt returns input as-is so the
 *                             test can assert "returns decrypted
 *                             access token" with literal strings.
 *   - @/modules/telephony/upsert — `upsertRingCentralConnection` is
 *                             a vi.fn(); the test only verifies it's
 *                             called (or NOT called) with the right
 *                             args. No real DB.
 *   - @/lib/log             — suppressed; pino is noisy in test
 *                             output and we already cover the
 *                             "logged via warn" contract via grep
 *                             in the source file's self-check.
 *   - global.fetch          — vi.fn() per test, returns synthetic
 *                             Response objects.
 *
 * The Drizzle `tx.select(...).from().where().limit().for("update")`
 * chain is faked via `makeMockTx(rows)` below — each step returns
 * the chain, the terminal `for()` returns `Promise<rows>`. That
 * lets us pass empty / single-row / different-expiry rows to drive
 * each branch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/env", () => ({
  env: {
    RINGCENTRAL_CLIENT_ID: "test-client-id",
    RINGCENTRAL_CLIENT_SECRET: "test-client-secret",
    RINGCENTRAL_SERVER_URL: "https://platform.devtest.ringcentral.com",
  },
}))

vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn((ciphertext: string) => ciphertext),
}))

const upsertMock = vi.hoisted(() =>
  vi.fn((_tx: unknown, _args: { organizationId: string; userId: string; tokens: unknown }) =>
    Promise.resolve({ id: "stub", reactivated: false }),
  ),
)
vi.mock("@/modules/telephony/upsert", () => ({
  upsertRingCentralConnection: upsertMock,
}))

vi.mock("@/lib/log", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import {
  getValidAccessToken,
  RingCentralAuthError,
  RingCentralTransientError,
} from "@/modules/telephony/token-refresh"

// ─── Mock tx + fetch helpers ───────────────────────────────────────

/**
 * Fake the fluent Drizzle SELECT chain that token-refresh.ts uses:
 *   tx.select({...}).from(t).where(...).limit(1).for("update")
 * Each method returns the chain itself except the terminal `for()`
 * which resolves to the passed-in rows array.
 */
function makeMockTx(rows: unknown[]): {
  tx: unknown
  spies: Record<string, ReturnType<typeof vi.fn>>
} {
  const chain: Record<string, unknown> = {}
  const select = vi.fn(() => chain)
  const from = vi.fn(() => chain)
  const where = vi.fn(() => chain)
  const limit = vi.fn(() => chain)
  const forFn = vi.fn(() => Promise.resolve(rows))
  chain.select = select
  chain.from = from
  chain.where = where
  chain.limit = limit
  chain.for = forFn
  return { tx: chain, spies: { select, from, where, limit, for: forFn } }
}

/** Construct a synthetic Response that mimics the RC token endpoint. */
function rcResponse(args: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(args.body), {
    status: args.status,
    headers: { "content-type": "application/json" },
  })
}

const ARGS = { organizationId: "org_test", userId: "user_test" }
const NOW = Date.now()

beforeEach(() => {
  upsertMock.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── (a) No active connection row ──────────────────────────────────

describe("token-refresh — no active connection", () => {
  it("throws RingCentralAuthError('no_active_connection')", async () => {
    const { tx } = makeMockTx([])
    global.fetch = vi.fn()

    try {
      await getValidAccessToken(ARGS, tx as never)
      throw new Error("expected throw")
    } catch (e) {
      expect(e).toBeInstanceOf(RingCentralAuthError)
      expect((e as RingCentralAuthError).code).toBe("no_active_connection")
    }
    expect(upsertMock).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

// ─── (b) RC 400 invalid_grant ──────────────────────────────────────

describe("token-refresh — RC returns 400 invalid_grant", () => {
  it("throws RingCentralAuthError('invalid_grant'), upsert NOT called", async () => {
    const { tx } = makeMockTx([
      {
        accessToken: "enc-access-A",
        refreshToken: "enc-refresh-A",
        accessTokenExpiresAt: new Date(NOW + 60_000), // 1 min — within 10-min buffer
      },
    ])
    global.fetch = vi.fn().mockResolvedValue(
      rcResponse({
        status: 400,
        body: { error: "invalid_grant", error_description: "expired refresh token" },
      }),
    )

    try {
      await getValidAccessToken(ARGS, tx as never)
      throw new Error("expected throw")
    } catch (e) {
      expect(e).toBeInstanceOf(RingCentralAuthError)
      expect((e as RingCentralAuthError).code).toBe("invalid_grant")
    }
    expect(upsertMock).not.toHaveBeenCalled()
  })
})

// ─── (c) RC 503 transient error ────────────────────────────────────

describe("token-refresh — RC returns 503", () => {
  it("throws RingCentralTransientError with provider code from body", async () => {
    const { tx } = makeMockTx([
      {
        accessToken: "enc-access-B",
        refreshToken: "enc-refresh-B",
        accessTokenExpiresAt: new Date(NOW + 60_000),
      },
    ])
    global.fetch = vi
      .fn()
      .mockResolvedValue(rcResponse({ status: 503, body: { error: "server_unavailable" } }))

    try {
      await getValidAccessToken(ARGS, tx as never)
      throw new Error("expected throw")
    } catch (e) {
      expect(e).toBeInstanceOf(RingCentralTransientError)
      expect((e as RingCentralTransientError).code).toBe("server_unavailable")
    }
    expect(upsertMock).not.toHaveBeenCalled()
  })
})

// ─── (d) fetch throws — network error ──────────────────────────────

describe("token-refresh — fetch throws (network error)", () => {
  it("throws RingCentralTransientError('network_error') with detail", async () => {
    const { tx } = makeMockTx([
      {
        accessToken: "enc-access-C",
        refreshToken: "enc-refresh-C",
        accessTokenExpiresAt: new Date(NOW + 60_000),
      },
    ])
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))

    try {
      await getValidAccessToken(ARGS, tx as never)
      throw new Error("expected throw")
    } catch (e) {
      expect(e).toBeInstanceOf(RingCentralTransientError)
      expect((e as RingCentralTransientError).code).toBe("network_error")
      expect((e as RingCentralTransientError).detail).toContain("ECONNREFUSED")
    }
    expect(upsertMock).not.toHaveBeenCalled()
  })
})

// ─── (e) Successful refresh ────────────────────────────────────────

describe("token-refresh — RC ok response", () => {
  it("returns new access_token plaintext; upsert called exactly once with new tokens", async () => {
    const { tx } = makeMockTx([
      {
        accessToken: "enc-access-D",
        refreshToken: "enc-refresh-D",
        accessTokenExpiresAt: new Date(NOW + 60_000), // within buffer
      },
    ])
    const newTokenBody = {
      access_token: "FRESH_ACCESS_TOKEN_xyz",
      refresh_token: "FRESH_REFRESH_TOKEN_abc",
      expires_in: 3600,
      refresh_token_expires_in: 604800,
      scope: "ReadCallLog ReadMessages SMS VoipCalling",
      owner_id: "rc_ext_555",
    }
    global.fetch = vi.fn().mockResolvedValue(rcResponse({ status: 200, body: newTokenBody }))

    const result = await getValidAccessToken(ARGS, tx as never)
    expect(result.token).toBe("FRESH_ACCESS_TOKEN_xyz")
    expect(result.rotated).toBe(true)
    expect(upsertMock).toHaveBeenCalledTimes(1)
    const upsertCall = upsertMock.mock.calls[0]
    // upsertRingCentralConnection(tx, { organizationId, userId, tokens })
    expect(upsertCall?.[1]).toMatchObject({
      organizationId: ARGS.organizationId,
      userId: ARGS.userId,
      tokens: {
        access_token: "FRESH_ACCESS_TOKEN_xyz",
        refresh_token: "FRESH_REFRESH_TOKEN_abc",
      },
    })
  })
})

// ─── (f) Token NOT near expiry — no refresh ────────────────────────

describe("token-refresh — token not near expiry", () => {
  it("returns decrypted existing access_token; fetch NOT called; upsert NOT called", async () => {
    const { tx } = makeMockTx([
      {
        accessToken: "enc-existing-access",
        refreshToken: "enc-existing-refresh",
        // 20 minutes from now — outside the 10-min buffer
        accessTokenExpiresAt: new Date(NOW + 20 * 60 * 1000),
      },
    ])
    global.fetch = vi.fn()

    const result = await getValidAccessToken(ARGS, tx as never)
    // decrypt mock returns input as-is.
    expect(result.token).toBe("enc-existing-access")
    expect(result.rotated).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(upsertMock).not.toHaveBeenCalled()
  })
})

// ─── (g) Token within buffer — refresh triggered ───────────────────

describe("token-refresh — token within 10-min buffer", () => {
  it("fetch IS called when access_token expires within 10 minutes", async () => {
    const { tx } = makeMockTx([
      {
        accessToken: "enc-stale-access",
        refreshToken: "enc-stale-refresh",
        // 5 minutes from now — INSIDE the 10-min buffer
        accessTokenExpiresAt: new Date(NOW + 5 * 60 * 1000),
      },
    ])
    const newTokenBody = {
      access_token: "REFRESHED_xyz",
      refresh_token: "REFRESHED_abc",
      expires_in: 3600,
      refresh_token_expires_in: 604800,
      scope: "ReadCallLog ReadMessages SMS VoipCalling",
      owner_id: "rc_ext_999",
    }
    global.fetch = vi.fn().mockResolvedValue(rcResponse({ status: 200, body: newTokenBody }))

    const result = await getValidAccessToken(ARGS, tx as never)
    expect(result.rotated).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(upsertMock).toHaveBeenCalledTimes(1)
  })
})
