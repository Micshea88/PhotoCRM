# Planning Decisions — 2026-07-16

Decisions locked in a planning session (2026-07-16). Transcribed from Mike, not re-derived.
Companion to `docs/backend-audit-backlog.md` (the 12 backend policies + ❌ gaps these elaborate),
`docs/decisions-since-may-docs.md` (decision ledger), and `docs/multi-tenant-remediation-plan.md`.
Items marked **OPEN** are recorded as open — not resolved.

---

## A2 / Merge — child-relation survivorship

- **`notifications`: RE-HOME to the winner. Not an exclusion.** All 3 misses (`email_log`, `tasks`,
  `notifications`) are real misses. **Zero intentional exclusions.**
- **Rule (Mike's words):** _"everything in records moves to winning record."_ Every child relation
  follows the winner. Matches industry standard — HubSpot combines all activities from both records
  onto the merged record; Salesforce transfers all related records to the master and deletes the
  losers. There is **no "some things stay behind" tier** in any competitor.
- **If the enumerate-from-FKs sweep pulls in a 14th table not yet seen, STOP and ask before
  excluding it.** "The sweep grabbed something surprising" must never become a silent exclusion.
- **Loser record:** goes to the existing delete bin on the existing **90-day** recoverable window.
  Timeline unchanged.
- **Two user-facing strings, both required:** (1) a **warning before the merge is confirmed**;
  (2) a **notice that even if the losing record is recovered from the bin, its data will NOT be
  repopulated** onto it — because the data moved to the winner. (Salesforce buries this in a support
  doc; we put it in front of the user.)

## Audit log / record history

**Two separate logs** (HubSpot's + Salesforce's split):

- **SYSTEM LOG** — settings, permissions, workflows, users. Small, high-signal, admin-only. Where
  "someone changed something that affects daily business" lives and must not get drowned out.
- **RECORD HISTORY** — field changes on a contact/event. Lives on the record.

**Principle: THE LOG IS COMPLETE. THE NOTIFICATION IS NARROW. THE VIEW IS FILTERED.** Do not solve an
attention problem by discarding data — HubSpot's mistake (their log doesn't record non-user actions
like form submissions, so it goes blind exactly where the product is automated).

- **SOURCE / ACTOR TAGGING:** every write records an actor, which may be a system: named user /
  `Workflow: <name>` / `Import: <filename>` / `Public form: <name>` / Nylas sync / API. (HubSpot tags
  source as Workflow / User Action / Import — the feature that makes their history usable; a field can
  look manually updated when an automation changed it.)
- **ACTOR TYPE IS A FILTER FACET** on the timeline (Humans / Automations / Imports / Public forms /
  Integrations). Users filter system actions vs logged-in-user actions — the split without a third log.
- **Log** contacts created from the website; log record field changes. **Available at ALL subscription
  levels** — not Enterprise-only like HubSpot.
- **BEFORE AND AFTER VALUES** on tracked changes. (Salesforce's Setup Audit Trail doesn't capture
  these; we do.)
- **RETENTION: 90-day rolling window** (HubSpot 30, Salesforce ~180 — we sit in the middle
  deliberately).
- **DAY-91 HANDLING:** notify admins **7 days AND 72 hours** before deletion — "this data will be
  deleted in X days, export to prevent loss" — with an **export option**. That export option is **NOT
  currently on the deleted screen and needs to be.**
- **NOTIFICATIONS ON CHANGES: per-field opt-in, NOT global.** A global "notify on any change" is the
  loudest possible default where workflows change fields all day, and contradicts our quiet-defaults
  notification law. Notifications go to admins via **email AND the notification center**.
- **COMMENTS:** allow commenting on an audit/history entry with **@-mentions and resolvable threads**
  (HubSpot has this). Turns "who did this?" into a conversation in place.
- **HISTORY SURVIVES DELETION:** history stays with the record in the 90-day bin. Restore brings
  history back with the record. A restored record's timeline SHOWS its deletion + restoration as
  events ("deleted by X on <date>, restored by Y on <date>"). A record's history is its history.

## Pagination / filtering

- **NUMBERED PAGES, not infinite scroll.** Research: enterprise apps / bookkeeping / CRMs benefit from
  pagination because users need control; scroll-jacking for continuity degrades usability.
- **PAGE SIZE: user-selectable, four tiers — 50 / 100 / 150 / 250.** (Dynamics ships 25/50/75/100/250,
  min 25 max 250; engineering standard default 25–50, max 100–200. User evidence runs one direction —
  people want MORE per page, mostly for bulk actions. 250 is a deliberate choice at the top of the
  documented range.)
- **SELECT ALL ACROSS PAGES:** when a user selects all on a page, offer "select all N contacts" =
  every record matching the current filter across all pages, not just the visible page. Makes filters
  actionable at scale; exists regardless of page size.
- **MULTI-FILTER:** more than one filter at a time, including date ranges (e.g. all leads AND created
  between June 23 and August 2). **Believed already built — AUDIT AND CONFIRM rather than assume.**
- **DEFAULT LIST STATE:** already built. **Do not rebuild, do not redesign. Report what it currently
  is with file:line** so it's on the record.
- **Competitive context (HoneyBook, from daily use + an industry event; most complainants there were
  Dubsado users) — HoneyBook's real failures:** (1) everyone is a contact, no type → can't filter
  leads/clients/vendors/employees; (2) pipeline is the only lens → a contact with four shoots is four
  cards reassembled by hand, "who booked me more than once" is unanswerable because the filter
  requires a project type; (3) filters are AND-only; (4) five saved views per company, desktop only;
  (5) no status filter — active/completed/archived show together with no sort to put active first;
  (6) free-form tags, inconsistent, a mess within months; (7) contact list carries so little data that
  filtering is limited by what's displayable; their official answer is a quarterly manual cleanup
  meeting. **Our data model already solves (1) and (2)** — contact type is first-class, events are
  separate records with many-to-one to contact. **This is exposure work, not architecture work,** and
  no competitor can copy it without re-founding their data model.

## Free text → governed dropdown ("did you mean")

- **Problem:** can't anticipate every dropdown value a photographer needs, don't want endless options,
  don't want untrackable free text. Industry cleans up afterward — HubSpot won't convert free text to a
  picklist once it has data (must wipe every value first); importing unstandardized data creates a new
  option per misspelling. Salesforce's unrestricted picklist accepts off-list values as free text —
  "the sync succeeds, but data consistency degrades over time" (built the open door, skipped the match
  check). **Our idea IS that missing check.**
- **BEHAVIOR:** on save of a new value, fuzzy-match against existing values and surface "It looks like
  you already have 'Vendor Referral' saved as a lead source — is this the one you want?" User picks the
  existing value or overrides and creates a new one, which becomes a dropdown option.
- **SCOPE:** new values go **ORG-WIDE** — that's the point (trackable data).
- **WHO CAN MINT:** controlled by the admin, as a **per-user permission toggle**.
- **CAUTION MESSAGE:** when an admin toggles "allow user to create values" on, show a caution message
  in the warning/caution color — short, plain language, roughly: _values users save become available
  to the whole organization — grant this carefully to avoid dropdown clutter and messy data._ Shorter
  if possible. **Do NOT use the words "data degradation."**
- **CSV IMPORT PASSES THE SAME MATCH CHECK, on all fields.** Import is the back door — if it can create
  values without the check, the mechanism leaks on day one. The migration importer and this feature are
  the same feature.
- **EXISTING VALUES:** everything currently in dropdowns was entered by Mike → stays as standard
  options. No retro-cleanup needed.

## Passwords / MFA

**Standard — NIST SP 800-63B Rev. 4 (July 2025):** 15 chars min single-factor, 8 min with MFA, allow
≥64, no mandatory complexity, no periodic rotation unless evidence of compromise, no hints/security
questions, breached-credential screening required.

**Our decisions:**

- **Minimum 12 characters — DELIBERATE DEVIATION** from the 15-char single-factor recommendation.
  Reason: 15 is a usability burden and we pair it with conditional MFA.
- Allow **≥64** characters.
- **No periodic rotation** unless evidence of compromise (matches standard).
- **Screen against breached-credential lists (HIBP)** (matches standard).
- **Current state:** password-min **8** in code (`auth.ts:41`) while docs say 12 — neither matches.
  **Fix to 12.**
- **CONDITIONAL MFA** — a code via text or to the email on file is **REQUIRED** when EITHER: the user
  hasn't logged in for **>14 days**, OR is logging in from a **new device**. **Explicitly NOT per-login
  2FA** — same device every day must not be prompted.
- **NIST caveat on SMS (recorded):** SMS codes are permitted but explicitly "restricted"; NIST
  recommends migrating away from SMS for any account containing PII. **We proceed with SMS knowingly.**
  Compliance matters for cyber-insurance and due diligence even without enterprise clientele.

## Branch 2 / Auth resilience — defence hierarchy (CONFIRMED by Mike, supersedes "UNCONFIRMED")

1. **GATE EXEMPTIONS — PRIMARY.** Never get locked out in the first place. A security gate must never
   fail closed with no exemption.
2. **SMS — the everyday alternate.** Two doors minimum; no single vendor is ever the only road in.
3. **RECOVERY CODES — last resort, ideally never fires.** The codes ARE the glass. Mike + Kelly only,
   not clients. Must **PROVE IDENTITY AND CLEAR THE GATE** — a code that authenticates then hits "not
   verified 403" is useless. Hashed at rest, single-use, regenerable, audited.
4. **OUR TEAM (PATHWAY PLATFORM STAFF) — the final net.** When a tenant's self-rescue via emailed/SMS
   code fails, our team can restore access by issuing codes.

**TWO SEPARATE GRANTS, not one** (the narrow-scoping the research demands):

- **RECOVERY GRANT:** reissue codes, clear a gate, verify identity. Gets a locked-out user back in.
  **NO tenant data read.** Default for a lockout call; covers almost every case.
- **SUPPORT GRANT:** read the tenant's data (the impersonation feature). Time-boxed, attributable,
  revocable, visible to the studio.
- Reason: helping someone log back in does not require reading their client list. If merged into one,
  every routine lockout fires the highest-privilege feature. **If Mike wants them merged, he'll say so.**

Both built as a **POLICY plus a GRANT ROW on top of RLS — NEVER BYPASSRLS.** Time-boxed (start/end →
auto-expire, no manual cleanup). Full audit + alerting + visible UI indicator. Indexed policy columns.
**SECURITY DEFINER function inside the policy to avoid the recursion trap.**

Model the actor as **"PATHWAY PLATFORM STAFF" — NOT "K&K team member."** Same humans today, different
tomorrow; wiring to K&K guarantees a rebuild. Cross-tenant, platform→tenant (Stripe/Intercom support
pattern), explicitly NOT a studio's own staff. **Likely needs a platform-level role above all tenants
that does not exist in the schema yet.**

**Limit:** staff assistance requires the STAFF member to be logged in. It rescues tenants; it cannot
rescue Mike at zero access — the recovery codes close that gap. That's why codes sit above staff.

## Outbound rate limiting (policy item 5 — the SAME system as item 3)

**Core problem:** Nylas and Resend rate-limit PATHWAY's account, not each studio. Every tenant shares
one quota. At scale, one studio's bulk import spends everyone's budget and 199 other studios see what
looks like an outage.

- **ONE OUTBOUND GATEWAY, THREE THIN ADAPTERS.** Every call to Nylas/Resend/RingCentral routes through
  one module. Each adapter normalizes that provider's quirks into one shape — no standard for how
  providers communicate rate limits (some `Retry-After`, some custom headers, some 200 OK with the
  error in the body). **Normalize a hidden rate limit into a 429 at the boundary.** Retry logic written
  once.
- **TWO GATES ON EVERY CALL:** the org's bucket and the global bucket. Both must allow. Global = real
  provider ceiling; Org = fairness.
- **FLOOR PLUS SHARED BURST, not equal slices.** Each org gets a small guaranteed floor; everything
  above from a shared pool. Equal slicing at 500 studios gives everyone a useless sliver while most sit
  idle.
- **TWO LANES.** Interactive (proposals, receipts, password resets — a human waiting) and bulk
  (imports, enrichment, syncs, campaigns). Bulk always yields to interactive; bulk draws only from the
  shared pool, never the floor. An import can be slow; a client's contract cannot be late.
- **RETRIES ARE REQUEUES, NOT SLEEPS.** A 429 puts the job back on the queue with a delay. Never sleep
  inside a serverless function — burns paid execution, risks timeout. The task queue controls the rate.
- **BACKOFF:** honor `Retry-After` when present; exponential with jitter starting 1–2s when absent; cap
  3–5 attempts; never drop silently. Use **FULL jitter** (random 0..cap) — AWS documents it as
  measurably better than equal/none.
- **THROTTLE PREEMPTIVELY:** watch `X-RateLimit-Remaining`, slow down before the 429.
- **CIRCUIT BREAKER PER PROVIDER, GLOBAL** — not per tenant. If Resend is down it's down for everyone.
  When open, jobs stay pending + we're alerted rather than grinding 10,000 retries into a wall.
- **EXPLICITLY CHECK `status == 429`.** A 503 is a server error; a 401 is bad credentials — not rate
  limits. Guard against a negative sleep when a reset timestamp is already in the past.
- **SHARED STATE: Upstash Redis** (serverless has no shared memory; buckets need a common counter —
  same dependency as item 10's rate limit).
- **DO NOT REWRITE THE RINGCENTRAL CLIENT** — it already does this correctly. **EXTRACT it into the
  gateway** and make Nylas + Resend adopt it.
- **THROTTLE VISIBILITY: TELL THE STUDIO.** Show it — e.g. "Import throttled, 3,400 of 5,000 sent,
  finishing in ~20 min." Silent failure = frustration. If people know, they have something to complain
  about, and their complaints become our improvement list. **Publish the limits** — a documented limit
  is a feature; an undocumented one is an outage.

## RLS / tenant isolation (item 1) — the documented standard (verbatim)

Records the standard we follow; independently confirms the measurements in
`backend-audit-backlog.md` C1.

- "By default, superusers and the table owner are exempt from RLS. The danger isn't the exemption
  itself, it's that you'll do your testing as one of those roles and conclude that your policies work,
  when in reality they were never being applied."
- "Testing methodology is critical: test as the application role, never as a superuser."
- Force RLS so table owners don't sail past it. Never grant BYPASSRLS to application roles. Test with
  dedicated non-superuser accounts.
- "Silent failures make debugging painful: policies fail closed, without warnings, so a wrong result
  looks like a correct empty one."
- Carry identity in secure session variables, not `current_user`, especially behind a pooler.
- Always index policy columns; composite index when a policy ANDs columns.
- Views bypass RLS unless `security_invoker = true` (Postgres 15+).
- Keep Postgres patched — CVE-2019-10130 leaked RLS-hidden data through planner statistics. Even
  internal machinery can be a side channel.

**This explains the 56 vacuous passes — and it isn't the role, it's the empty table:** "Assert 'the
owner sees their row' against an empty table and it passes while proving nothing." _(Refines
`backend-audit-backlog.md` C1: the 56 pass under bypass because the table is empty, not because the
assertion is inherently weak.)_

**What a real RLS test checks:** from each identity's point of view — owner sees + changes their own
row; other tenant can't see it at all; anon blocked; role-holder gets exactly the access the role
grants — **ALL AGAINST A ROW REALLY OWNED BY THE IDENTITY UNDER TEST.** "Denied" has two flavors a good
test keeps apart: row-level filtering → **zero rows**; missing grant → **permission error**.

**THE CI RULE (verbatim):** "At least one negative test sits in CI so a future migration can't silently
widen access."

**FOUR MECHANISMS, kept separate** (conflating them is how you build a hole):

1. RLS stays tight. No change to the runtime. We already meet the standard.
2. No superuser CONNECTION role except migrations. Already true; keep it.
3. Support/recovery access = a POLICY plus a GRANT ROW, never BYPASSRLS (see Branch 2 two-grant split).
4. Continuous testing via the CI negative test. Human non-superuser spot check too, but the CI test is
   what runs whether or not anyone's paying attention.

**LOCKOUT IS AN AUTH PROBLEM, NOT AN RLS PROBLEM.** The production lockout was a URL issue. A
break-glass mechanism must never bypass RLS — that's how a support tool becomes a breach.

## Permissions / RBAC (item 8)

- **Model:** Tenants → Users (membership scoped to tenant) → Roles (tenant-scoped) → Permissions →
  UserRoles. "You don't just check 'is user an admin?', you check 'is user an admin **in this
  tenant?**'"
- **Failure mode isn't the schema:** "RBAC rarely falls apart because the schema is wrong. It falls
  apart because the rules around the schema were never decided, so people invent them ad-hoc over time."
- **ROLE EXPLOSION guard — ship the cheap fix:** a "compare roles" / permission-diff view in the admin
  UI. "Most tenants never need custom roles." Not anticipated much, but the guard is cheap so we take it.
- **Enforcement is layered** (matches what we have): gateway = authenticated + correct tenant; service
  layer = ownership/status validations; policy/data layer = canonical enforcement + audit logs.
- **Note for later:** JWTs are fast + stateless but hard to revoke; opaque tokens need a lookup but
  support immediate revocation. Relevant to the session-expiry gap.

## API versioning (item 10)

- **BUILD IT NOW.** No users today is not a reason to defer. Build as though the CRM will be populated
  with a lot of users next week.
- **Standard:** URL path versioning (`/api/v1`) is the pragmatic default — simple, visible,
  browser-testable, CDN-friendly, gateways route by prefix. Version at the API level, not per resource.
  Major versions for breaking changes only; minor/patch are additive + safe. Prefer additive over
  breaking: add `full_name`, keep `name`.
- **Forward-compatible from the start:** objects not arrays for response envelopes, consistent field
  names, document the deprecation policy before the first endpoint ships.
- **Deprecation process — four parts:** advance notice, machine-readable signals, migration tooling,
  hard sunset with no exceptions. `Deprecation` + `Sunset` headers (RFC 8594) on every response from a
  deprecated version + a `Link` header to migration docs ("relying on documentation alone reaches
  developers who proactively check the docs and misses everyone else"). Track version usage in logs;
  when v1 traffic <1% for 30 days it's safe to sunset. Notice: 6 months external, 4–6 weeks internal.
- **Trigger for external consumers:** the lead-capture widget embedding on a client's website, and
  studios wiring up webhooks.

## PM frontend performance (item 12)

- **COPY ASANA'S ARCHITECTURE-FIRST DISCIPLINE.** "Asana is the most stable and predictable… handles
  complex task graphs (dependencies, multi-homing, portfolio rollups) without noticeable lag."
- **Counter-example (evidence for LAW 2):** ClickUp, most feature-rich, is the slowest, and couldn't
  fix it even with the 3.0 rewrite — depth added first, performance retrofitted after, never caught up.
- **Monday's warning applies to us specifically:** multi-board→single-dashboard rollups report
  slowdowns; "the visual rendering engine that makes monday.com beautiful also demands more from the
  browser." Our Dashboard is a significant multi-source rollup and our reskin is a visual rendering
  layer. Fewer boards + far less design weight than Monday, but graphs/data display matter for easy
  viewing/comparison. **Speed stays a primary part of the build — solve for both, don't trade.**
- **Asana's top complaint is notification overload.** Our answer is already built: system + other
  notifications toggle on/off so the user decides what they receive.

## OPEN — recorded as open, NOT resolved

1. **The full Branch 2 build spec still needs re-sending** — the original paste truncated at
   "requireEmailVerification currently…". **Do not build B2 until the complete spec arrives.**
2. **Custom domain: still no owner, no date.** Recorded as an **open V1 blocker** — required before any
   studio customer signs up. (See memory `prod-auth-origin-and-custom-domain`.)
