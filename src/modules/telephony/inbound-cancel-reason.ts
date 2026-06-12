/**
 * Classifier for why an inbound call leg was torn down before answer.
 *
 * RingCentral rings ALL of a user's devices simultaneously (desktop
 * app, mobile app, cell, AND Pathway's WebPhone). For a phone-first
 * user, MOST calls are answered on another device, not in Pathway.
 * When that happens, RC cancels Pathway's still-ringing leg with an
 * RFC 3326 Reason header:
 *
 *   Reason: SIP;cause=200;text="Call completed elsewhere"
 *
 * That is NOT a missed or declined call — it was answered, just not
 * here. Logging a `no_answer` row for it would be false data on every
 * such call. A genuine caller-abandonment CANCEL (or a BYE) carries no
 * `cause=200` reason.
 *
 * Why a header parser instead of an SDK event: the SDK's `dispose()`
 * emits `disposed` with NO payload (verified against
 * ringcentral-web-phone@2.4.4 `call-session/index.mjs` — `dispose()`
 * calls `this.emit("disposed")` with no args), and the dispatcher in
 * `index.mjs` calls `dispose()` without forwarding the raw CANCEL. The
 * only place the cancel cause is visible is the raw inbound CANCEL/BYE
 * message on the `sipClient` "inboundMessage" channel, whose `Reason`
 * header we pass here.
 *
 * Pure + dependency-free so it unit-tests without importing the SDK.
 */
export function isAnsweredElsewhere(reasonHeader: string | undefined | null): boolean {
  if (!reasonHeader) return false
  const r = reasonHeader.toLowerCase()
  // `cause=200` is the SIP success code RC uses for "answered/completed
  // elsewhere"; the text match is a resilience fallback against
  // formatting variance (spacing, quoting).
  return /cause\s*=\s*200\b/.test(r) || r.includes("completed elsewhere")
}
