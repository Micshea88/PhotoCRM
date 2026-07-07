# Pending Integration Setup — Required Wiring (BUILD-COMPLETION GATE)

> **This is a build-completion gate.** It tracks integrations whose **code is built but which are not yet wired to their live credentials / webhooks**. Review this list before declaring the notification-center build "done." Any item marked **BLOCKS BUILD COMPLETION: yes** must be completed + verified before the build is considered complete. Documentation only — wiring happens with Mike, not by an agent. Companion to `docs/cleanup-and-tech-debt.md`.
>
> Production domain: `https://photo-crm-three.vercel.app`. Env vars are per-environment in Vercel (`vercel env ls`, names only).

---

## 1. Nylas inbound webhook — **BLOCKS BUILD COMPLETION: YES** 🚩

- **What it is:** the connected-mailbox inbound path — Nylas pushes inbound email / replies (and delivery/grant events) to Pathway, which logs them to the matching contact and fires reply/bounce/disconnect notifications.
- **Current state:** intentionally **parked / disconnected**. The route (`app/api/webhooks/nylas/inbound/route.ts`) and handlers (`ingestNylasWebhook`, `handleGrantExpired`, `handleNylasDeliveryEvent`) are built and committed on the feature branch. Nothing is connected in the Nylas dashboard; `NYLAS_WEBHOOK_SECRET` is **not set** in Vercel. `verifyNylasSignature` rejects all events while the secret is unset (fail-closed).
- **Why it's the gate:** **this build is NOT done until the Nylas inbound webhook is connected and the hard-gate tests below pass.**

---

### Connect + Verify Runbook (Nylas inbound — HARD GATE)

Follow these steps in order with Mike in the terminal. Do NOT paste secrets into chat.

#### Step 1 — Set the secret

In **Mike's own terminal**, run:

```bash
vercel env add NYLAS_WEBHOOK_SECRET
```

Select all environments that receive webhooks (Production at minimum; match the scoping of the other `NYLAS_*` vars). When prompted for the value, paste the **Nylas webhook signing secret** from the Nylas dashboard for this application. Verify it was set:

```bash
vercel env ls | grep NYLAS_WEBHOOK_SECRET
```

#### Step 2 — Deploy

Push the feature branch and trigger a Vercel production deployment, or promote the preview deployment to production. This deploy activates:

- `NYLAS_WEBHOOK_SECRET` in the runtime env (Vercel env vars take effect on deploy)
- The Task 7 Nylas delivery dispatch + Task 8 `grant.expired` handler
- The Task 11 bounce/failure notification emit

This is the same deploy that also activates the Resend delivery lane (§2 — `RESEND_WEBHOOK_SECRET` was pre-set 2026-07-06; this deploy is all that's left for §2).

#### Step 3 — Create the Nylas subscription

In the **Nylas dashboard** → Webhooks → Create subscription:

- **URL:** `https://photo-crm-three.vercel.app/api/webhooks/nylas/inbound`
- **Triggers — subscribe to ALL EXCEPT Folder.** The handler dispatches:
  - `message.created` — inbound message from a connected mailbox
  - `message.bounce_detected` — outbound bounce via Nylas
  - `message.send_failed` — outbound send failure via Nylas
  - `thread.replied` — subscribed but intentionally a **no-op** in the handler (reply notification fires via `message.created`; wiring `thread.replied` would double-notify)
  - `grant.expired` — grant revocation; marks connection expired + fires disconnect notification
  - Grant lifecycle events (connect, revoke) — subscribe for completeness

The route already handles the GET challenge handshake automatically (`challenge` param is echoed back in the response).

#### Step 4 — HARD-GATE TEST A: inbound reply

**Goal:** confirm the full inbound reply path works end-to-end.

1. Find a contact in Pathway whose email address you control.
2. Send an email FROM a connected photographer mailbox TO that contact email.
3. Wait for the email to arrive, then **reply** to it from the contact's email address.
4. Check that the reply appears on the contact's activity feed as an **inbound** email row.
5. Check that an **`email.reply_received` notification** appears in Pathway's bell and was also emailed to the photographer (mailbox owner).

**This is the gate.** Both (a) the activity-feed log AND (b) the notification must work.

#### Step 5 — HARD-GATE TEST B: bounce (Resend lane — §2)

**Goal:** confirm the Resend bounce path works now that the feature branch is deployed.

1. Send a contact email to an address you know will bounce (e.g. `bounce-test@invalid-domain-that-does-not-exist.example`).
2. Wait ~1–2 minutes for the Resend webhook to fire.
3. Check `email_log.delivery_status` for that email log row flips to `"bounced"`.
4. Check that a **bounce notification** (`email.bounced`) appears in Pathway's bell and was emailed to the sender.

This test also validates that the Resend webhook wiring (pre-wired 2026-07-06) is fully active post-deploy.

#### Step 6 — Field-name verification checklist

The Nylas inbound handler was written defensively because payload shapes could not be verified offline. When the first real event arrives (Steps 4 or 5 above), check the raw webhook payload against these fields and adjust the handler (`src/modules/email-connections/nylas-inbound.ts`) if any differ:

| Field                         | Assumed shape                                                             | Verify                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Top-level event ID            | `event.id`                                                                | Used as dedup key in `providerEventId`. Confirm the field name is `id` (not `eventId`, `event_id`, etc.) |
| Message ID on delivery events | `data.object.message_id` with fallback to `data.object.id`                | Confirm which field Nylas actually sends for `message.bounce_detected` / `message.send_failed`           |
| Bounce type                   | `data.object.bounce_type` or `data.object.type` (or nested `detail.type`) | `classifyBounceClass` handles all three shapes — confirm at least one is present                         |
| Event timestamp               | `data.object.date` (Unix seconds)                                         | Confirm field name; `extractOccurredAt` falls back to `new Date()` if absent                             |
| Grant ID on `grant.expired`   | `data.object.grant_id`                                                    | Confirm this is how Nylas sends the expired grant                                                        |

If any field differs from the assumption, make the targeted handler fix, redeploy, and re-run the affected gate test.

#### Step 7 — Check the gate boxes

Once both hard-gate tests pass, update the checklist at the bottom of this file:

```markdown
- [x] **#1 Nylas inbound webhook** — (date) + (who verified)
```

Also update the §1 "Current state" note above to reflect the live status.

---

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
