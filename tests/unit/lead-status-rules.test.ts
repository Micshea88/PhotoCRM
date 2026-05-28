/**
 * Push 3 (C6b CORRECTED) — unit tests for the facts engine + the
 * fallback classifier. The renamed `fallbackClassifyFromRules`
 * function carries the same coverage as the original `classifyByRules`
 * (kept intact per spec point 2). Tests against `computeContactFacts`
 * live in the integration suite (it queries the DB).
 */
import { describe, it, expect } from "vitest"
import { LEAD_STATUSES, leadStatusCategory } from "@/modules/contacts/ai/lead-status-enum"
import {
  fallbackClassifyFromRules,
  isEmptyContact,
  type ContactFacts,
} from "@/modules/contacts/ai/lead-status-rules"
import { detectInsights, type InsightFacts } from "@/modules/contacts/ai/insights-detector"

function baseFacts(): ContactFacts {
  return {
    contactType: null,
    lifecycleStatus: null,
    tags: [],
    activityCount: 0,
    notesCount: 0,
    callsCount: 0,
    meetingsCount: 0,
    smsCount: 0,
    daysSinceCreated: 1,
    daysSinceLastActivity: null,
    daysSinceLastInbound: null,
    hasUpcomingMeeting: false,
    referralsMade: 0,
    bookingCount: 0,
    highestProposalValue: 0,
  }
}

describe("LEAD_STATUSES — 19 fallback values", () => {
  it("contains exactly 19 statuses ending with Uncategorized", () => {
    expect(LEAD_STATUSES.length).toBe(19)
    expect(LEAD_STATUSES[LEAD_STATUSES.length - 1]).toBe("Uncategorized")
  })

  it("category map sums to 6/6/4/2/1 = 19", () => {
    const counts = { client: 0, lead: 0, referral_partner: 0, vendor: 0, other: 0 }
    for (const s of LEAD_STATUSES) counts[leadStatusCategory(s)]++
    expect(counts).toEqual({ client: 6, lead: 6, referral_partner: 4, vendor: 2, other: 1 })
  })
})

describe("isEmptyContact — empty-floor short-circuit", () => {
  it("returns true when no activity AND no bookings", () => {
    expect(isEmptyContact(baseFacts())).toBe(true)
  })

  it("returns false once ANY activity is logged", () => {
    expect(isEmptyContact({ ...baseFacts(), activityCount: 1, notesCount: 1 })).toBe(false)
  })

  it("returns false once a booking exists (even with zero activity rows)", () => {
    expect(isEmptyContact({ ...baseFacts(), bookingCount: 1 })).toBe(false)
  })
})

describe("fallbackClassifyFromRules — client path", () => {
  it("VIP-tagged with bookings → VIP Client", () => {
    const r = fallbackClassifyFromRules({ ...baseFacts(), bookingCount: 1, tags: ["vip"] })
    expect(r.status).toBe("VIP Client")
  })

  it("bookingCount >= 3 → VIP Client", () => {
    expect(fallbackClassifyFromRules({ ...baseFacts(), bookingCount: 3 }).status).toBe("VIP Client")
  })

  it("2 bookings → Repeat Client", () => {
    expect(fallbackClassifyFromRules({ ...baseFacts(), bookingCount: 2 }).status).toBe(
      "Repeat Client",
    )
  })

  it("1 booking + upcoming meeting → Active Client", () => {
    const r = fallbackClassifyFromRules({
      ...baseFacts(),
      bookingCount: 1,
      hasUpcomingMeeting: true,
      daysSinceLastActivity: 5,
    })
    expect(r.status).toBe("Active Client")
  })

  it("1 booking + recent activity, no upcoming → Booked Client", () => {
    const r = fallbackClassifyFromRules({
      ...baseFacts(),
      bookingCount: 1,
      daysSinceLastActivity: 5,
    })
    expect(r.status).toBe("Booked Client")
  })

  it("1 booking + no activity >90d → At-Risk Client", () => {
    expect(
      fallbackClassifyFromRules({ ...baseFacts(), bookingCount: 1, daysSinceLastActivity: 120 })
        .status,
    ).toBe("At-Risk Client")
  })

  it("1 booking + Inactive lifecycle → Past Client", () => {
    expect(
      fallbackClassifyFromRules({
        ...baseFacts(),
        bookingCount: 1,
        lifecycleStatus: "Inactive",
      }).status,
    ).toBe("Past Client")
  })
})

describe("fallbackClassifyFromRules — lead path", () => {
  it("Lead + inbound within 7d → Hot Lead", () => {
    expect(
      fallbackClassifyFromRules({
        ...baseFacts(),
        contactType: "Lead",
        daysSinceLastInbound: 2,
      }).status,
    ).toBe("Hot Lead")
  })

  it("Lead + upcoming meeting → Lead in Progress", () => {
    expect(
      fallbackClassifyFromRules({
        ...baseFacts(),
        contactType: "Lead",
        hasUpcomingMeeting: true,
      }).status,
    ).toBe("Lead in Progress")
  })

  it("Lead + 30–90d since activity → Cold Lead", () => {
    expect(
      fallbackClassifyFromRules({
        ...baseFacts(),
        contactType: "Lead",
        daysSinceLastActivity: 60,
      }).status,
    ).toBe("Cold Lead")
  })

  it("Lead + 91+ days inactive → Unresponsive Lead", () => {
    expect(
      fallbackClassifyFromRules({
        ...baseFacts(),
        contactType: "Lead",
        daysSinceLastActivity: 120,
      }).status,
    ).toBe("Unresponsive Lead")
  })

  it("Lead + Do Not Contact → Dead Lead", () => {
    expect(
      fallbackClassifyFromRules({
        ...baseFacts(),
        contactType: "Lead",
        lifecycleStatus: "Do Not Contact",
      }).status,
    ).toBe("Dead Lead")
  })
})

describe("fallbackClassifyFromRules — referral + vendor + uncategorized", () => {
  it("Referral Partner + 5+ referrals → Top Referral Source", () => {
    expect(
      fallbackClassifyFromRules({
        ...baseFacts(),
        contactType: "Referral Partner",
        referralsMade: 6,
      }).status,
    ).toBe("Top Referral Source")
  })

  it("Vendor + no activity >90d → Past Vendor", () => {
    expect(
      fallbackClassifyFromRules({
        ...baseFacts(),
        contactType: "Vendor",
        daysSinceLastActivity: 120,
      }).status,
    ).toBe("Past Vendor")
  })

  it("Empty facts → Uncategorized", () => {
    expect(fallbackClassifyFromRules(baseFacts()).status).toBe("Uncategorized")
  })
})

describe("detectInsights — 3 deterministic rules", () => {
  function baseInsightFacts(): InsightFacts {
    return {
      contactId: "c-1",
      aiLeadStatus: null,
      tags: [],
      bookingCount: 0,
      highestProposalValue: 0,
      orgAvgProposalValue: 0,
      daysSinceLastContact: null,
      referralsMade: 0,
      referralsWhoBooked: 0,
    }
  }

  it("cold_reengage fires for Cold Lead + >30d", () => {
    const out = detectInsights({
      ...baseInsightFacts(),
      aiLeadStatus: "Cold Lead",
      daysSinceLastContact: 45,
    })
    expect(out.some((i) => i.kind === "cold_reengage")).toBe(true)
  })

  it("vip_detect fires for bookingCount >= 3 + not tagged", () => {
    expect(
      detectInsights({ ...baseInsightFacts(), bookingCount: 4 }).some(
        (i) => i.kind === "vip_detect",
      ),
    ).toBe(true)
  })

  it("vip_detect does not fire when already tagged VIP", () => {
    expect(
      detectInsights({ ...baseInsightFacts(), bookingCount: 4, tags: ["VIP"] }).some(
        (i) => i.kind === "vip_detect",
      ),
    ).toBe(false)
  })

  it("referrer_gap fires when >=5 referrals + 0 booked", () => {
    expect(
      detectInsights({
        ...baseInsightFacts(),
        referralsMade: 6,
        referralsWhoBooked: 0,
      }).some((i) => i.kind === "referrer_gap"),
    ).toBe(true)
  })

  it("empty input returns []", () => {
    expect(detectInsights(baseInsightFacts())).toEqual([])
  })
})
