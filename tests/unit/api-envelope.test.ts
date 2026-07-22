/**
 * The versioned-API primitives (policy #10). Asserts the OBSERVABLE contract
 * consumers depend on: the `{ data, error, meta }` envelope shape on success AND
 * error, and the RFC 8594 sunset/deprecation headers.
 */
import { describe, it, expect } from "vitest"
import { apiOk, apiError } from "@/lib/api/envelope"
import { deprecationHeaders } from "@/lib/api/deprecation"

describe("api envelope", () => {
  it("apiOk wraps the payload with null error + open meta, status 200 default", async () => {
    const res = apiOk({ status: "ok" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { status: "ok" }, error: null, meta: {} })
  })

  it("apiOk honors a custom status + meta", async () => {
    const res = apiOk({ id: "1" }, { status: 201, meta: { requestId: "r1" } })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ data: { id: "1" }, error: null, meta: { requestId: "r1" } })
  })

  it("apiError wraps { code, message } with null data at the given status", async () => {
    const res = apiError(404, "not_found", "No such record")
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      data: null,
      error: { code: "not_found", message: "No such record" },
      meta: {},
    })
  })
})

describe("deprecationHeaders (RFC 8594)", () => {
  it("emits Sunset, Deprecation, and a rel=sunset Link", () => {
    const sunset = new Date("2027-01-01T00:00:00Z")
    const h = deprecationHeaders({
      deprecatedAt: true,
      sunsetAt: sunset,
      infoUrl: "https://docs.example.com/v1-sunset",
    })
    expect(h.Deprecation).toBe("true")
    expect(h.Sunset).toBe(sunset.toUTCString())
    expect(h.Link).toBe('<https://docs.example.com/v1-sunset>; rel="sunset"')
  })

  it("omits headers that weren't provided", () => {
    expect(deprecationHeaders({})).toEqual({})
  })
})
