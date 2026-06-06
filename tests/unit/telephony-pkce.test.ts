import { describe, it, expect, vi } from "vitest"
import { createHash } from "node:crypto"

// signState/verifyState read env.BETTER_AUTH_SECRET via @/lib/env.
// t3-env's client guard treats jsdom as the client and refuses
// server-side var access. Mocking env mirrors the precedent in
// tests/unit/ai-model-wrapper.test.ts for SDK-driven unit tests.
vi.mock("@/lib/env", () => ({
  env: { BETTER_AUTH_SECRET: "test-better-auth-secret-32-chars-minimum-for-hmac-key" },
}))

import { generateVerifier, signState, verifierToChallenge, verifyState } from "@/lib/oauth-pkce"

/**
 * PKCE + signed-state proofs (pure helpers; no DB).
 *
 * The state HMAC is keyed off BETTER_AUTH_SECRET via env.ts. The test
 * env provides a real value, so signed states verify positively and
 * tampered ones fail.
 */

function base64urlOk(s: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(s)
}

describe("oauth-pkce — verifier shape", () => {
  it("produces a base64url string (RFC 4648 §5 charset, no padding)", () => {
    const v = generateVerifier()
    expect(typeof v).toBe("string")
    expect(base64urlOk(v)).toBe(true)
  })

  it("encodes ~32 bytes — 42-44 chars (43 for 32 bytes, ±1 for trim)", () => {
    const v = generateVerifier()
    // 32 raw bytes base64-encoded = 44 chars including 1 pad char;
    // base64url strips padding, so 43.
    expect(v.length).toBeGreaterThanOrEqual(42)
    expect(v.length).toBeLessThanOrEqual(44)
  })

  it("returns a different verifier each call (high entropy)", () => {
    const a = generateVerifier()
    const b = generateVerifier()
    expect(a).not.toBe(b)
  })
})

describe("oauth-pkce — challenge = base64url(SHA-256(verifier))", () => {
  it("matches an independently-computed S256 challenge", () => {
    const v = generateVerifier()
    const expected = createHash("sha256")
      .update(v)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
    expect(verifierToChallenge(v)).toBe(expected)
  })

  it("challenge is base64url and ~43 chars (32 bytes of hash)", () => {
    const v = generateVerifier()
    const c = verifierToChallenge(v)
    expect(base64urlOk(c)).toBe(true)
    expect(c.length).toBe(43)
  })

  it("different verifiers produce different challenges", () => {
    const a = verifierToChallenge(generateVerifier())
    const b = verifierToChallenge(generateVerifier())
    expect(a).not.toBe(b)
  })
})

describe("oauth-pkce — signState / verifyState round-trip", () => {
  it("a freshly-signed state verifies for the SAME userId", () => {
    const userId = "user_round_trip_001"
    const state = signState(userId)
    expect(verifyState(state, userId)).toBe(true)
  })

  it("two signState calls produce different states (nonce randomness)", () => {
    const userId = "user_nonce_001"
    const a = signState(userId)
    const b = signState(userId)
    expect(a).not.toBe(b)
    // Both still verify positively.
    expect(verifyState(a, userId)).toBe(true)
    expect(verifyState(b, userId)).toBe(true)
  })

  it("verifyState format is `<nonce>.<mac>` — base64url on both halves", () => {
    const state = signState("user_format_001")
    const dot = state.indexOf(".")
    expect(dot).toBeGreaterThan(0)
    const nonce = state.slice(0, dot)
    const mac = state.slice(dot + 1)
    expect(base64urlOk(nonce)).toBe(true)
    expect(base64urlOk(mac)).toBe(true)
  })
})

describe("oauth-pkce — verifyState rejects", () => {
  it("a state signed for User A does NOT verify for User B", () => {
    const stateA = signState("user_aaa")
    expect(verifyState(stateA, "user_bbb")).toBe(false)
  })

  it("a tampered MAC fails verify (last byte flipped)", () => {
    const state = signState("user_tamper_001")
    const flipped = state.slice(0, -2) + (state.slice(-2, -1) === "A" ? "B" : "A") + state.slice(-1)
    expect(verifyState(flipped, "user_tamper_001")).toBe(false)
  })

  it("malformed input (no dot, empty, non-string) returns false", () => {
    expect(verifyState("no-dot-at-all", "u")).toBe(false)
    expect(verifyState("", "u")).toBe(false)
    expect(verifyState(".", "u")).toBe(false)
    expect(verifyState(".trailing-mac-but-no-nonce", "u")).toBe(false)
    expect(verifyState("nonce-but-no-mac.", "u")).toBe(false)
    // Defensive: non-string typed-cheat input.
    expect(verifyState(null as unknown as string, "u")).toBe(false)
  })

  it("invalid base64 in the mac half returns false (no throw)", () => {
    const state = signState("user_badb64_001")
    const dot = state.indexOf(".")
    const tampered = state.slice(0, dot + 1) + "!!!invalid base64!!!"
    expect(verifyState(tampered, "user_badb64_001")).toBe(false)
  })
})

describe("oauth-pkce — verifyState is constant-time on length mismatch", () => {
  it("a short mac returns false immediately (length pre-check)", () => {
    // Construct a state with a deliberately short mac payload (still
    // valid base64) — verifyState's length pre-check should refuse
    // BEFORE timingSafeEqual is called (timingSafeEqual throws on
    // length mismatch, so a "returns false" result proves the length
    // check fired first rather than letting it throw).
    const userId = "user_const_001"
    const state = signState(userId)
    const dot = state.indexOf(".")
    const tampered = state.slice(0, dot + 1) + "QQ" // base64 for [65]
    expect(verifyState(tampered, userId)).toBe(false)
  })
})
