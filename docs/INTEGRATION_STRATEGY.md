# Integration Strategy — Lightweight V1, Full Later

This file records deliberate phased decisions for three external integrations. The principle: ship and prove the product with the lowest-effort compliant path first; take on heavyweight third-party verification only AFTER the product is built, tested, and proven. These are locked decisions, not suggestions.

## 1. Email

### V1 (prove-it) — Resend, OUTBOUND ONLY

- Outbound email (CRM-sent messages to clients) goes through Resend.
- Sending domain verified via DNS (SPF/DKIM/DMARC). No OAuth, no Google review, no consent screen.
- Mail is sent from the studio's verified domain. reply-to is set so client replies return to the correct human address and land in that person's normal inbox like any other email.
- NO inbound inbox sync in V1. Replies are NOT threaded inside the CRM.

### Why this defers the entire Google queue

Reading a user's Gmail inbox requires Gmail restricted scopes (gmail.readonly / gmail.modify / gmail.send), which trigger Google's app verification regardless of it being the user's own account. By NOT building inbox sync for V1, the Google verification queue is deferred entirely — it is a later feature, not a V1 dependency. Do not start the Google OAuth paperwork as a V1 task.

### LATER (post-proof) — per-user Gmail OAuth + two-way inbox threading

- Each user connects their own Google account; reads their own inbox; sends through their own Gmail; replies thread inside the CRM.
- This is the originally-specced model. It requires Google OAuth consent screen + restricted-scope verification (and a security assessment above Google's user threshold). Begin that queue deliberately when the product is proven and this feature is scheduled — not before.
- Microsoft/IMAP per-user connect is the same phase as Gmail OAuth.

## 2. Instagram / Meta

### V1 (prove-it) — MANUAL lead entry, NO Meta API

- An Instagram DM inquiry becomes a manually-created lead/contact in the CRM (team member creates it, optionally pastes the message text).
- Zero Meta API usage. Zero Meta App Review. The workflow is preserved; only the automation is deferred.

### Hard prohibition

Do NOT integrate Instagram DMs via any unofficial route — scraping, unofficial libraries, or automation that simulates the Instagram app. All of these violate Meta platform terms and risk a ban of the studio's already-verified business Instagram account. There is no safe shortcut around official App Review for programmatic DM access. Manual entry is the only compliant lightweight path.

### LATER (post-proof) — official Instagram Messaging API

- instagram_manage_messages permission via Meta App Review with a working demo. The studio already has an approved/verified business Instagram account, which makes this review materially faster than a cold start — but it still requires a built, demoable integration. Schedule deliberately post-proof.

## 3. Contracts & E-Signature

### V1 (prove-it) — open-source templates + open-source e-sign, NO legal review

- Contract content uses reputable open-source / known-library templates, stored as studio-editable TEMPLATES. The studio (end user) is responsible for its own final contract content — the template model shifts that liability. No lawyer engaged for V1.
- E-signature uses a reputable open-source e-sign library/mechanism, NOT a bespoke crypto build.

### E-sign enforceability — RECORDED BUILD REQUIREMENT (verify, not a lawyer)

The e-sign flow MUST capture all of the following or it is not a defensible electronic signature (US ESIGN/UETA), independent of contract wording:

1. Explicit consent to sign electronically (affirmative "I agree to sign electronically" action, captured — not assumed).
2. Signer identity + timestamp + IP address recorded at signing.
3. Document locked / tamper-evident after signing (post-sign edits detectable or impossible).
4. Immutable retained copy of the exact signed document version + an audit record (who / when / which version).

If the chosen open-source e-sign tool does not provide all four, the gap must be closed in our code before this feature is considered done. This is a build-verification item, not a legal engagement.

### LATER (post-proof) — optional one-time e-sign enforceability review

After the product is proven, an OPTIONAL one-time legal review of the e-sign capture mechanism's enforceability/admissibility may be commissioned. This is narrow (the mechanism, not the template language) and is a risk decision for the owner, not a mandatory launch gate. Contract template content does not require legal review under the template-liability model.
