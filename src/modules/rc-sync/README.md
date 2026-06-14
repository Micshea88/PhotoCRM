# rc-sync

RingCentral call-log sync: makes RC the **authoritative** source for call
disposition, and (later) pulls recordings → transcripts → AI notes, so calls
answered anywhere (cell, Kelly, desk app) land in Pathway automatically.

## Status: Build 1 of 5 — foundation only

What exists now:

- **`schema.ts`** — `rc_sync_jobs`, the durable retry/audit job queue. Org-RLS
  isolated. Machine-written (no user session) via the `set_config(
'app.current_org', …)` + `set_config('app.current_role','admin')` pattern
  (same as `workflow-execute`), NOT `orgAction`.
- New `call_log` columns (`rc_call_id`, `rc_last_modified_time`,
  `disposition_source`, `rc_result`, `rc_recording_url`, `rc_recording_id`,
  `transcript`, `transcript_status`, `ai_notes`, `ai_notes_original`,
  `ai_notes_status`) + the partial-unique `(org_id, rc_call_id)` dedup key.
- **`src/lib/ringcentral/`** — `RingCentralClient` (wraps the existing
  `getValidAccessToken`; rate-limit-aware), `verification-token` (per-event
  webhook auth + validation handshake), `types`.

Wired but **not used yet** — no webhook route, no reconciliation, no transcript
or AI-notes pipeline. Those are Builds 2–5.

## Source taxonomy (on `call_log.source`)

- `manual` — Log Call form.
- `ringcentral` — Pathway-witnessed dialer call (heuristic disposition).
- `rc_sync` — created by this module from RC's authoritative call log
  (`disposition_source = "rc_authoritative"`).

## Reuse (do not duplicate)

`getValidAccessToken` (token-refresh), `findContactByPhoneImpl`
(telephony/queries), `withOrgContext` + the `set_config` system-write pattern,
`verifyCronAuth`, `telephony_connections.webhook_subscription_id` /
`validation_token` (existing columns).

## Build order

1. **(this)** migration + client + verification + scopes.
2. reconciliation engine + Layer 2 (targeted post-hangup pull), feature-flagged.
3. Layer 1 webhook + Layer 3 cron sweep.
4. transcript pipeline (RC Audio AI speech-to-text — Path 2; needs the `ai`
   beta scope granted by RC developer request).
5. AI notes (Haiku) + display. Requires the scoped machine-AI pivot
   (`ai-model.ts` allowlist) — locked by Mike, recorded at Build 5.
