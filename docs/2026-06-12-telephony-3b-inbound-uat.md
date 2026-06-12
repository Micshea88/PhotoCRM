# Telephony 3b — Inbound Answer UI: live UAT plan & handoff

**Branch:** `feat/telephony-3b-inbound-answer-ui` (DO NOT MERGE until the live UAT below passes).
**Build:** Claude · **Merge decision:** Mike, after a real inbound call test.

> **Why this gate exists.** Tier-2 (typecheck / lint / unit / integration / build) is green, but tier-2 **cannot** exercise SIP signaling or WebRTC media — no phone, no mic, no RC session. The 3a audio regression and the transfer failure both passed tier-2 clean. **A real inbound call with two-way audio confirmation is mandatory before merge.**

---

## What shipped

When an inbound call reaches Pathway's WebPhone session, the docked dialer shows an **Incoming call** panel with **Answer** (green) / **Decline** (gray), replacing the old "laptop hijack" (SDK auto-replied 180 Ringing forever, no UI).

- **Caller identity:** caller number (`formatPhoneDisplay`) + matched contact name (linked to the contact page — link only, no auto-navigate), resolved async so the ring UI never waits.
- **Answer** → `session.answer()` → normal connected UI (mute / keypad / hangup); audio uses the **same `mediaStreamSet` DSP path** as outbound.
- **Decline** → `session.decline()`.
- **No call-waiting (V1):** an inbound arriving while a call is active is declined immediately.
- **Auto-log:** answered inbound → `call_log`, `direction="incoming"`, disposition via the duration classifier. Genuine caller-abandonment (caller hung up before answer) → `no_answer`, **only when the caller matched a known contact** (Option A; no orphan rows).
- **Activity feed:** "Call (incoming) · M:SS" + existing disposition badge (no loader changes).

### Phone-first correctness (the pre-UAT fix)

Mike's RC rings **all** devices at once (desktop app, mobile app, cell, AND Pathway), and most calls are answered on the cell/mobile app — **not** in Pathway. Two behaviors were locked down before UAT:

- **Answered elsewhere writes NOTHING.** When the call is answered on another device, RC cancels Pathway's leg with `Reason: SIP;cause=200;text="Call completed elsewhere"`. Pathway reads that raw CANCEL header (the SDK's `disposed` event carries no cause — verified in `call-session/index.mjs`) and writes **no row** — it was answered, just not here. Logging `no_answer` would be false data on most calls.
- **Decline writes NOTHING.** Decline only dismisses Pathway's leg; the cell/mobile keep ringing and the call may still be answered there. So a decline records nothing — the upcoming RC call-log sync will capture the true outcome. Only a **witnessed** caller-abandon (CANCEL with no `cause=200`) logs `no_answer`.

### SDK findings (evidence)

- **`decline()` blast radius — SAFE.** `decline()` sends RC's `ClientReject` (cmd 12), not a call-ending SIP response. SDK README: _"decline the inbound call will **not terminate the call session for the caller**… the call will not reach your voicemail."_ For simultaneous-ring, declining one device does **not** stop the others. So Decline in Pathway is non-destructive — Mike's cell keeps ringing. (Confirm in Test 2.)
- **Answered-elsewhere signal.** The cause is only on the raw inbound CANCEL's `Reason` header, read off the `sipClient` "inboundMessage" channel (the SDK's `dispose()` emits with no payload). RC community confirms the `SIP;cause=200;text="Call completed elsewhere"` CANCEL is what fires.

## Files changed

- `src/modules/telephony/ui/use-web-phone.ts` — inbound listener, reducer (`inbound_ringing` + `direction`), answer/decline/setInboundContact, shared `attachMicDsp`, `sipMsgHandler` answered-elsewhere classifier + `failed` safety net. `reducer`/`INITIAL_STATE` exported for tests.
- `src/modules/telephony/inbound-cancel-reason.ts` — pure `isAnsweredElsewhere` classifier.
- `src/modules/telephony/ui/dialer-context.tsx` — lookup wiring, inbound auto-log routing, `answerInbound`/`declineInbound`.
- `src/modules/telephony/ui/docked-dialer.tsx` + `dialer-controls.tsx` — `IncomingCall` panel.
- `src/modules/telephony/actions.ts` + `queries.ts` — `lookupContactByPhone` + `findContactByPhoneImpl`.
- `src/modules/calls/actions.ts` + `types.ts` — `recordInboundCall` + input schema.

## Automated coverage

- `tests/unit/use-web-phone-reducer.test.ts` — inbound transitions, busy guard, dismissal idempotency (answered-elsewhere/double-teardown), failed-after-answer, outbound direction regression.
- `tests/unit/inbound-cancel-reason.test.ts` — `isAnsweredElsewhere` (exact RC header, cause=200, text fallback, case/spacing variance, cause=2000 non-match, missing header).
- `tests/unit/caller-lookup-normalize.test.ts` — caller-ID normalization.
- `tests/integration/inbound-contact-lookup.test.ts` — match by primary/secondary, legacy format, org scope, soft-delete skip.
- `tests/integration/record-inbound-call.test.ts` — incoming row contract + "Call (incoming)" render.

Tier-2 green as of this commit.

---

## LIVE UAT — run on a Preview deployment, NOT production

Promote this branch to a **Vercel Preview**; confirm it routed to Preview (not Production). Sign in as Mike with the live RC connection. Keep the Pathway tab open (screen-pop needs the tab live).

### Test 1 — Answer with two-way audio ✅ the critical one

1. Call Mike's RC number from another phone.
2. **Expect:** the docked dialer pops **Incoming call** with the caller number (+ contact name if saved).
3. Click **Answer**.
4. **Confirm BOTH audio directions:** Mike hears the caller; the caller hears Mike clearly (no choppiness — DSP applies).
5. Hang up. **Expect:** activity feed shows **"Call (incoming) · M:SS"** + green **Connected** badge (if caller matched a contact and call ran ≥20s).

### Test 2 — Decline (non-destructive; writes nothing)

1. Call in. Click **Decline** in Pathway.
2. **Expect:** the Pathway popup dismisses, **Mike's other devices (cell / mobile app) keep ringing**, and Mike can still answer there.
3. **Expect:** **NO `call_log` row is written by Pathway — regardless of whether the caller is a saved contact.** (Decline only drops Pathway's leg; the true outcome is recorded by the future RC call-log sync.)

### Test 3 — Missed (caller abandons before anyone answers)

1. Call in; let it ring on all devices; hang up from the calling phone before answering anywhere.
2. **Expect:** the panel clears on its own.
3. **Expect:** if the caller is a saved contact → an **incoming / No Answer** row appears (a genuine miss Pathway witnessed). If unknown → no row (Option A).

### Test 4 — Caller-ID match accuracy

1. Call from a saved contact's number (try one stored with formatting / a leading 1). **Expect:** name appears and links to the contact.
2. Call from an unknown number → **Expect:** number only, no name, no crash.

### Test 5 — No-call-waiting + outbound regression

1. While on an active call, have someone call in. **Expect:** the inbound is auto-declined; the active call is undisturbed.
2. Place an outbound call with two-way audio; confirm the disposition badge + M:SS duration still log correctly.

### Test 6 — Answered elsewhere (writes nothing) ⭐ the phone-first case

1. Call Mike's RC number. **Expect:** Pathway pops the Incoming panel AND the cell rings.
2. **Answer on the cell / mobile app**, not in Pathway.
3. **Expect:** the Pathway popup clears on its own (RC cancelled its leg).
4. **Expect:** **NO `call_log` row is written by Pathway** — even though Pathway saw the call ring. Verify the contact's activity feed shows no spurious "No Answer" entry. (This is the false-data bug the pre-UAT fix prevents; if a no_answer row appears here, **stop and report**.)

---

## Known limitations (V1 — by design / scope)

- **Tab must be open** (no push); closed tab → call routes per RC's normal rules, no Pathway UI.
- **Browser-tab close mid-answered-call** → that call's auto-log won't fire (same V1 gap as outbound; future RC webhook backfills).
- **No transfer** (cut permanently — see `docs/2026-06-11-revert-handoff.md`).
- **No voicemail transcript/audio, no SMS, no call-waiting** — later slices.
- **Short answered inbound (<3s)** classifies as `cancelled` (tunable `CANCELLED_RING_TIME_MS`).
- **Decline / answered-elsewhere write no row by design** — full inbound history (including calls answered on the cell) arrives with the RC call-log sync, not from the WebPhone.

## If something fails

Capture which test, expected vs actual, and the browser console. Inbound signaling can be instrumented at the `inboundCall` / `answered` / `disposed` events and the `sipMsgHandler` in `use-web-phone.ts`. Do not merge on a partial pass — **Test 1 step 4 (two-way audio) and Test 6 (no false no_answer) are the non-negotiable gates.**

Sources: SDK README (`node_modules/ringcentral-web-phone/README.md`, decline section) · SDK source `call-session/index.mjs` (`dispose()` no-payload), `call-session/inbound.mjs` (`decline()` → `ClientReject`), `index.mjs` (CANCEL/BYE dispatcher) · [RC community — "Call completed elsewhere" on sim-ring](https://community.ringcentral.com/) · [RC web phone SDK](https://www.npmjs.com/package/ringcentral-web-phone).
