import { describe, it, expect } from "vitest"
import { parseDisconnectedSessions } from "@/modules/rc-sync/webhook-parse"

describe("parseDisconnectedSessions", () => {
  it("returns the session id for a Disconnected event", () => {
    const payload = {
      uuid: "evt-1",
      event: "/restapi/v1.0/account/~/telephony/sessions",
      body: {
        telephonySessionId: "ts-abc",
        parties: [{ status: { code: "Disconnected" }, direction: "Outbound" }],
      },
    }
    expect(parseDisconnectedSessions(payload)).toEqual(["ts-abc"])
  })

  it("ignores a mid-call event (no party Disconnected)", () => {
    const payload = {
      uuid: "evt-2",
      event: "/restapi/v1.0/account/~/telephony/sessions",
      body: {
        telephonySessionId: "ts-mid",
        parties: [{ status: { code: "Answered" } }],
      },
    }
    expect(parseDisconnectedSessions(payload)).toEqual([])
  })

  it("trusts the subscription filter when parties are omitted", () => {
    const payload = {
      uuid: "evt-3",
      event: "/restapi/v1.0/account/~/telephony/sessions",
      body: { telephonySessionId: "ts-noparties" },
    }
    expect(parseDisconnectedSessions(payload)).toEqual(["ts-noparties"])
  })

  it("falls back to sessionId when telephonySessionId is absent", () => {
    const payload = {
      uuid: "evt-4",
      event: "/restapi/v1.0/account/~/telephony/sessions",
      body: { sessionId: "s-legacy", parties: [{ status: { code: "Disconnected" } }] },
    }
    expect(parseDisconnectedSessions(payload)).toEqual(["s-legacy"])
  })

  it("returns [] for missing body / session id / junk payloads", () => {
    expect(parseDisconnectedSessions(null)).toEqual([])
    expect(parseDisconnectedSessions(undefined)).toEqual([])
    expect(parseDisconnectedSessions({})).toEqual([])
    expect(parseDisconnectedSessions({ body: {} })).toEqual([])
    expect(parseDisconnectedSessions({ body: { parties: [] } })).toEqual([])
    expect(parseDisconnectedSessions("not-an-object")).toEqual([])
  })
})
