/**
 * Unit tests for `classifyOpen`, `ipInCidr`, and `isAppleMppIp`
 * (Task 13 — open-tracking classifier).
 *
 * All tests are PURE — no DB, no network, no Date.now() calls.
 * msSinceSend is passed in directly so timing assertions are deterministic.
 */
import { describe, it, expect } from "vitest"
import {
  classifyOpen,
  ipInCidr,
  isAppleMppIp,
  BOT_UA_PATTERNS,
  OPEN_BOT_TIMING_MS,
  type ClassifyOpenInput,
} from "@/modules/email-delivery/classify-open"

// ─── helper ───────────────────────────────────────────────────────────────

/** Build a ClassifyOpenInput with sensible defaults overridable per-test. */
function input(overrides: Partial<ClassifyOpenInput> = {}): ClassifyOpenInput {
  return {
    ip: "203.0.113.1", // TEST-NET-3, RFC 5737 — clearly not Apple
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    msSinceSend: 120_000, // 2 minutes — well past any bot threshold
    ...overrides,
  }
}

// ─── classifyOpen ─────────────────────────────────────────────────────────

describe("classifyOpen", () => {
  describe("Rule 1 — empty / null UA → bot", () => {
    it("null userAgent → bot", () => {
      expect(classifyOpen(input({ userAgent: null }))).toBe("bot")
    })

    it("empty string userAgent → bot", () => {
      expect(classifyOpen(input({ userAgent: "" }))).toBe("bot")
    })

    it("whitespace-only userAgent → bot", () => {
      expect(classifyOpen(input({ userAgent: "   " }))).toBe("bot")
    })
  })

  describe("Rule 2 — known bot/proxy/scanner UA → bot", () => {
    it("GoogleImageProxy UA → bot", () => {
      expect(
        classifyOpen(input({ userAgent: "Mozilla/5.0 (compatible) GoogleImageProxy/1.0" })),
      ).toBe("bot")
    })

    it("Googlebot UA → bot (contains 'bot')", () => {
      expect(classifyOpen(input({ userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)" }))).toBe(
        "bot",
      )
    })

    it("Proofpoint TAP pre-fetch UA → bot", () => {
      expect(classifyOpen(input({ userAgent: "proofpoint/1.0 URL-Defense-Scanner" }))).toBe("bot")
    })

    it("Mimecast URL defense → bot", () => {
      expect(classifyOpen(input({ userAgent: "Mimecast URL Protect" }))).toBe("bot")
    })

    it("Barracuda scanner → bot", () => {
      expect(classifyOpen(input({ userAgent: "BarracudaEmailSecurityGateway/1.0" }))).toBe("bot")
    })

    it("Microsoft-Outlook Safe Links → bot", () => {
      expect(classifyOpen(input({ userAgent: "Microsoft-Outlook/16.0 SafeLinks Prefetch" }))).toBe(
        "bot",
      )
    })

    it("ClaudeBot → bot", () => {
      expect(classifyOpen(input({ userAgent: "ClaudeBot/1.0" }))).toBe("bot")
    })

    it("GPTBot → bot", () => {
      expect(classifyOpen(input({ userAgent: "GPTBot/1.0" }))).toBe("bot")
    })

    it("BingPreview → bot", () => {
      expect(classifyOpen(input({ userAgent: "BingPreview/1.0b" }))).toBe("bot")
    })

    it("FeedFetcher → bot", () => {
      expect(
        classifyOpen(
          input({ userAgent: "FeedFetcher-Google; +http://google.com/feedfetcher.html" }),
        ),
      ).toBe("bot")
    })

    it("generic spider UA → bot", () => {
      expect(classifyOpen(input({ userAgent: "My-Spider/1.0" }))).toBe("bot")
    })

    it("generic crawler UA → bot", () => {
      expect(classifyOpen(input({ userAgent: "SomeCrawler/2.0" }))).toBe("bot")
    })

    it("ggpht UA → bot", () => {
      expect(classifyOpen(input({ userAgent: "Mozilla/5.0 (Windows; GgpHt-proxy)" }))).toBe("bot")
    })

    it("matching is case-insensitive", () => {
      expect(classifyOpen(input({ userAgent: "GOOGLEIMAGEPROXY" }))).toBe("bot")
    })

    it("BOT_UA_PATTERNS has the expected number of entries and is an array", () => {
      expect(Array.isArray(BOT_UA_PATTERNS)).toBe(true)
      expect(BOT_UA_PATTERNS.length).toBeGreaterThan(0)
    })
  })

  describe("Rule 3 — Apple MPP IP → unknown", () => {
    it("IP in Apple 17.x.x.x range + normal Mozilla UA → unknown", () => {
      expect(
        classifyOpen(
          input({
            ip: "17.58.100.1",
            userAgent:
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko)",
          }),
        ),
      ).toBe("unknown")
    })

    it("Apple IP + non-bot UA wins over timing (rule 3 before rule 4)", () => {
      // Fast open (500ms) but Apple IP — rule 3 fires first → unknown
      expect(
        classifyOpen(
          input({
            ip: "17.100.0.1",
            userAgent: "Mozilla/5.0 AppleWebKit/605.1.15",
            msSinceSend: 500,
          }),
        ),
      ).toBe("unknown")
    })

    it("null IP skips the Apple rule", () => {
      // Null IP + slow open + normal UA → human (rule 3 skipped, rule 4 skipped)
      expect(classifyOpen(input({ ip: null, msSinceSend: 120_000 }))).toBe("human")
    })
  })

  describe("Rule 4 — timing heuristic → bot", () => {
    it("500ms open (< 3000ms) with normal browser UA and non-Apple IP → bot", () => {
      expect(
        classifyOpen(
          input({
            ip: "203.0.113.1",
            msSinceSend: 500,
          }),
        ),
      ).toBe("bot")
    })

    it("msSinceSend exactly at OPEN_BOT_TIMING_MS boundary → human (not strictly <)", () => {
      expect(classifyOpen(input({ msSinceSend: OPEN_BOT_TIMING_MS }))).toBe("human")
    })

    it("msSinceSend = 1ms below boundary → bot", () => {
      expect(classifyOpen(input({ msSinceSend: OPEN_BOT_TIMING_MS - 1 }))).toBe("bot")
    })

    it("msSinceSend = null skips the timing rule → human", () => {
      expect(classifyOpen(input({ msSinceSend: null }))).toBe("human")
    })
  })

  describe("Rule 5 — human", () => {
    it("normal browser UA + residential-looking IP + slow open → human", () => {
      expect(
        classifyOpen(
          input({
            ip: "98.154.32.10",
            userAgent:
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
            msSinceSend: 120_000,
          }),
        ),
      ).toBe("human")
    })

    it("desktop Chrome UA + non-Apple IP + 2min delay → human", () => {
      expect(
        classifyOpen(
          input({
            ip: "66.249.64.1",
            userAgent:
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            msSinceSend: 120_000,
          }),
        ),
      ).toBe("human")
    })
  })
})

// ─── ipInCidr ─────────────────────────────────────────────────────────────

describe("ipInCidr", () => {
  it("IP exactly at the network address → true", () => {
    expect(ipInCidr("192.168.1.0", "192.168.1.0/24")).toBe(true)
  })

  it("IP inside the subnet → true", () => {
    expect(ipInCidr("192.168.1.100", "192.168.1.0/24")).toBe(true)
  })

  it("IP at the broadcast address → true", () => {
    expect(ipInCidr("192.168.1.255", "192.168.1.0/24")).toBe(true)
  })

  it("IP outside the subnet → false", () => {
    expect(ipInCidr("192.168.2.1", "192.168.1.0/24")).toBe(false)
  })

  it("Apple 17.0.0.0/8 — 17.58.100.1 inside → true", () => {
    expect(ipInCidr("17.58.100.1", "17.0.0.0/8")).toBe(true)
  })

  it("Apple 17.0.0.0/8 — 18.0.0.1 outside → false", () => {
    expect(ipInCidr("18.0.0.1", "17.0.0.0/8")).toBe(false)
  })

  it("/32 host route — exact match → true", () => {
    expect(ipInCidr("10.0.0.1", "10.0.0.1/32")).toBe(true)
  })

  it("/32 host route — different address → false", () => {
    expect(ipInCidr("10.0.0.2", "10.0.0.1/32")).toBe(false)
  })

  it("/0 matches everything → true", () => {
    expect(ipInCidr("1.2.3.4", "0.0.0.0/0")).toBe(true)
  })

  it("IPv6 address → false (not throwing)", () => {
    expect(ipInCidr("2001:db8::1", "17.0.0.0/8")).toBe(false)
  })

  it("garbage IP string → false (not throwing)", () => {
    expect(ipInCidr("not-an-ip", "192.168.0.0/24")).toBe(false)
  })

  it("empty string IP → false (not throwing)", () => {
    expect(ipInCidr("", "192.168.0.0/24")).toBe(false)
  })

  it("CIDR without slash → false (not throwing)", () => {
    expect(ipInCidr("192.168.0.1", "192.168.0.0")).toBe(false)
  })

  it("CIDR with invalid prefix → false (not throwing)", () => {
    expect(ipInCidr("192.168.0.1", "192.168.0.0/33")).toBe(false)
  })

  it("CIDR with non-numeric prefix → false (not throwing)", () => {
    expect(ipInCidr("192.168.0.1", "192.168.0.0/foo")).toBe(false)
  })
})

// ─── isAppleMppIp ─────────────────────────────────────────────────────────

describe("isAppleMppIp", () => {
  it("null ip → false", () => {
    expect(isAppleMppIp(null)).toBe(false)
  })

  it("17.58.100.1 (in 17.0.0.0/8) → true", () => {
    expect(isAppleMppIp("17.58.100.1")).toBe(true)
  })

  it("17.169.5.200 (in 17.0.0.0/8) → true", () => {
    expect(isAppleMppIp("17.169.5.200")).toBe(true)
  })

  it("18.0.0.1 (outside Apple ranges) → false", () => {
    expect(isAppleMppIp("18.0.0.1")).toBe(false)
  })

  it("203.0.113.1 (TEST-NET — not Apple) → false", () => {
    expect(isAppleMppIp("203.0.113.1")).toBe(false)
  })

  it("garbage string → false", () => {
    expect(isAppleMppIp("not-an-ip")).toBe(false)
  })

  it("IPv6 string → false", () => {
    expect(isAppleMppIp("2001:db8::1")).toBe(false)
  })
})
