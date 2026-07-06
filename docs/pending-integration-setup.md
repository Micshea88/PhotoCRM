# Pending Integration Setup — Required Wiring (BUILD-COMPLETION GATE)

> **This is a build-completion gate.** It tracks integrations whose **code is built but which are not yet wired to their live credentials / webhooks**. Review this list before declaring the notification-center build "done." Any item marked **BLOCKS BUILD COMPLETION: yes** must be completed + verified before the build is considered complete. Documentation only — wiring happens with Mike, not by an agent. Companion to `docs/cleanup-and-tech-debt.md`.
>
> Production domain: `https://photo-crm-three.vercel.app`. Env vars are per-environment in Vercel (`vercel env ls`, names only).

---

## 1. Nylas inbound webhook — **BLOCKS BUILD COMPLETION: YES** 🚩

- **What it is:** the connected-mailbox inbound path — Nylas pushes inbound email / replies (and delivery/grant events) to Pathway, which logs them to the matching contact and (once notifications ship) fires reply/bounce/disconnect notifications.
- **Current state:** intentionally **parked / disconnected**. The route (`app/api/webhooks/nylas/inbound/route.ts`) and handlers exist / are being built now (Task 7 adds the delivery + `grant.expired` dispatch). Nothing is connected in the Nylas dashboard; `NYLAS_WEBHOOK_SECRET` is **not set** in Vercel. `verifyNylasSignature` rejects all events while the secret is unset (fail-closed).
- **Setup needed to go live:**
  1. Set **`NYLAS_WEBHOOK_SECRET`** in Vercel (all environments that receive webhooks — match the other `NYLAS_*` scoping).
  2. In the Nylas dashboard, create the webhook subscription pointing at **`https://photo-crm-three.vercel.app/api/webhooks/nylas/inbound`**.
  3. Subscribe to the agreed triggers — **all triggers EXCEPT Folder** (per Mike). This includes at minimum `message.created` (inbound), plus the delivery/relationship triggers the handler dispatches (`message.bounce_detected`, `message.send_failed`, `thread.replied`, `grant.expired`, grant lifecycle).
  4. Complete the GET challenge handshake (the route already echoes the `challenge` param).
  5. **Verify:** send a real inbound email/reply to a connected mailbox and confirm it logs to the matching contact (and, once dispatch is wired, that a reply notification appears).
- **Why it's the gate:** **this build is NOT done until the Nylas inbound webhook is connected and inbound email/reply logging is verified working end-to-end.**

## 2. Resend bounce/delivery webhook — ✅ **COMPLETE** (wiring done 2026-07-06; activates on next production deploy)

- **What it is:** Resend (system/fallback sender) pushes delivery-status events so Pathway records bounces/complaints/deliveries and fires the bounce/send-failure notifications.
- **Current state (2026-07-06):** ✅ **DONE.** Webhook created in the Resend dashboard at `https://photo-crm-three.vercel.app/api/webhooks/resend/inbound`, subscribed to **all 7 events** (`email.received`, `email.sent`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.delivered`, `email.failed`). **`RESEND_WEBHOOK_SECRET` set in all 3 Vercel envs** (Production, Preview, Development — verified via `vercel env ls`). Delivery handler (Task 6: `email.bounced`/`email.complained`/`email.delivered` → `recordDeliveryEvent`) is committed on the feature branch. Inbound (`email.received`) handler is live in prod code.
- **What remains:** only the **next production deploy** — Vercel env vars take effect on deploy, and Task 6's delivery branch ships with the feature branch. Until that deploy, `verifyResendWebhook` still rejects on the current prod build (secret not yet loaded there); after deploy, bounce/complaint/delivered flow and (once notification dispatch lands) fire notifications.
- **Subscription-vs-handler gaps (subscribed but no-op until built — expected, not errors):**
  - `email.failed` — subscribed, but **no handler branch yet** → no-ops. Tracked as `cleanup-and-tech-debt.md` **A.14** (add `email.failed → recordDeliveryEvent({type:"failed"})`).
  - `email.sent`, `email.delivery_delayed` — subscribed, no handler → no-op (harmless; future-proofing).
- **Verify (post-deploy):** trigger a bounce (send to an invalid address) → confirm `email_log.delivery_status` flips to `bounced` and (once dispatch is wired) a bounce notification fires.

## 3. Twilio SMS — **BLOCKS BUILD COMPLETION: NO** (deferred by Mike)

- **What it is:** SMS send/receive. Intended as a provider-agnostic capability; the "Text received" notification type is pre-wired in the design but has nothing to feed it.
- **Current state:** **NOT built, and never wired.** Confirmed by the 2026-07-05 audit:
  - **No Twilio code** — `twilio` appears only in _schema comments_ as a future example (`sms-messages/schema.ts:46` "Twilio SID…"; `telephony/schema.ts:59` "future twilio/vonage"). The wired telephony provider is **RingCentral**, not Twilio.
  - **No Twilio credentials / env vars** — no `TWILIO_*` variables are declared in `src/lib/env.ts` or set in Vercel. Mike confirms Twilio was never set up.
  - **No SMS send path and no inbound SMS webhook** exist on any provider (see `cleanup-and-tech-debt.md` §B.7 / polish-backlog #18 — outbound SMS + inbound ingest is deferred to Telephony 3b / Push 5+).
- **Setup needed to go live (from-scratch — flag: this is NOT a quick toggle):**
  1. **Create a Twilio account**, provision an **SMS-capable phone number** (or Messaging Service), and obtain credentials.
  2. **Define + set env vars** (none exist today — they must be added to `src/lib/env.ts` first): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (and optionally `TWILIO_MESSAGING_SERVICE_SID`).
  3. **Build the code** (does not exist yet): an outbound `sendOutboundSms` action, an **inbound webhook route** (e.g. `app/api/webhooks/twilio/sms` — to be created), and **X-Twilio-Signature** request validation on that route.
  4. Configure the Twilio number's inbound-message webhook to point at that new route URL.
  5. `sms_messages` schema migration for `source`/`external_id`/dedup index (mirrors `call_log`).
  6. **Verify:** send + receive a real text logs to a contact.
- **Explicit flag:** this is a **real from-scratch account + number + credentials + webhook + CODE build**, not a credential toggle. Deferred by Mike to a dedicated setup session. Until then, the "Text received" notification type stays **pre-wired / non-firing**. (Note: polish-backlog #18 recommends **RC SMS REST** as the lower-friction alternative since the RingCentral `SMS` scope is already granted — provider choice is Mike's at build time.)

---

## Build-completion gate — checklist

Before declaring the notification-center build DONE, confirm:

- [ ] **#1 Nylas inbound webhook** connected (secret set + subscription created + triggers subscribed) AND a real inbound email/reply verified logging to a contact. **(HARD GATE)**
- [x] **#2 Resend bounce webhook** — ✅ endpoint created + 7 events subscribed + `RESEND_WEBHOOK_SECRET` set in all 3 envs (2026-07-06). Remaining: next production deploy to activate, then verify a real bounce flips `delivery_status` + fires a notification. **(HARD GATE — wiring done; deploy-activate + verify pending)**
- [ ] **#3 Twilio SMS** — explicitly acknowledged as **deferred, NOT built** (does not block; "Text received" stays non-firing).

_Update this file as each item is wired + verified (add date + who verified). Do not declare the build complete with an unchecked HARD GATE._
