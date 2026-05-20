/**
 * Plain-language rendering for the assistant transcript. The
 * conversation persists `tool_result` rows with a SUMMARY rather than
 * raw row data — re-fetch via the retriever if the user wants to drill
 * into a row.
 *
 * The summary intentionally redacts sensitive-looking fields (no
 * primary_phone / primary_email beyond first character + domain in
 * the summary text). The full row is returned to the caller of
 * `assistantTurn`; only the persisted SUMMARY is what shows in the
 * transcript log.
 */

export function renderRetrieverSummary(name: string, result: unknown): string {
  if (Array.isArray(result)) {
    return `${name} returned ${String(result.length)} result(s).`
  }
  if (result === null || result === undefined) {
    return `${name} returned no result.`
  }
  if (typeof result === "object") {
    const r = result as Record<string, unknown>
    const id = typeof r.id === "string" ? r.id : null
    const name2 = typeof r.name === "string" ? r.name : null
    const firstName = typeof r.firstName === "string" ? r.firstName : null
    const lastName = typeof r.lastName === "string" ? r.lastName : null
    if (id && (name2 ?? firstName ?? lastName)) {
      const label = name2 ?? `${firstName ?? ""} ${lastName ?? ""}`.trim()
      return `${name} returned: ${label} (id: ${id})`
    }
    if (id) return `${name} returned id ${id}.`
  }
  return `${name} returned 1 result.`
}

export function renderNavigation(routeTitle: string, message: string | null): string {
  if (message) return `${message} → ${routeTitle}`
  return `Here's where you can do that: ${routeTitle}`
}
