# Product Features Backlog

> Forward-looking **product roadmap features** (net-new capabilities), tracked so they aren't lost. This is distinct from `docs/cleanup-and-tech-debt.md` (bugs / tech-debt / deferred scope of current work) and `docs/pending-integration-setup.md` (wiring gates). Nothing here is built — each entry captures the intent, the competitive rationale, module ties, and dependencies for a future build. Update as items are scheduled/built.

---

## F1 — Template gallery usage indicators (Templates module, P12+)

**What:** each template in the gallery surfaces three usage signals:

- **(a) In-use vs unused** — whether the template is currently applied to any automation.
- **(b) Date created.**
- **(c) Last-used date** — the last time it was actually **emailed to anyone** (not just edited).

**Purpose:** let users **safely delete unused templates** — know what's actually in use before removing anything.

**Pain point solved (cited):** HoneyBook gives **no usage indicator**, so there's no safe way to tell what's in use before deleting.

**Module:** Templates (P12+).
**Dependencies:** "in-use" reads the automations/workflow wiring (which templates are referenced by a step); "last-used" reads the email send history (the last outbound `email_log` send that referenced the template). Both feed off systems that must expose a template reference.

---

## F2 — Import UX + durable batches + bulk actions on selections

Research-backed (HubSpot model). Four connected pieces. The **bulk-actions system (2C) is FOUNDATIONAL** — the others build on it.

### 2A — Import clarity

- The import flow lets the user **explicitly CHOOSE where records land** (contacts vs pipeline/events) — **not** dependent on which tab they started the import from.
- After import, **clearly show WHERE records went** + a link to view them.
- Support a **"tag" column** in the field mapping so spreadsheet tags **actually apply**. (Pain point: HoneyBook silently ignored a tag column.)

### 2B — Imports become durable, browsable batches

- Every import is **saved as a named batch**.
- Provide a way to **SEE ALL IMPORTED LISTS** — a dropdown / list view showing each import's **NAME** and **IMPORT DATE** (and ideally **record count**), so users can tell similarly-named or forgotten imports apart.
- Each batch stays a **selectable / filterable group anytime** — not just right after import. Example label: _"Oxford Exchange showcase leads — imported Jul 5, 42 records."_

### 2C — Bulk actions on any selection (general system, NOT import-only)

From **any list/selection** — including an imported batch — act on the whole group at once:

- Bulk **EMAIL** (e.g. showcase follow-up, vendor mix-and-mingle outreach).
- Bulk **CREATE TASK/REMINDER** with an optional **delay** (e.g. "follow up in 3 days").
- Bulk **SCHEDULE** appointments.
- Bulk **TAG**.
- Bulk **ASSIGN** owner.
- Bulk **ADD-TO-PIPELINE / set status**.

### 2D — Post-import prompt

- The import ends with a **"what would you like to do with these?"** step that launches the **same 2C bulk actions** on the fresh batch — so acting on a whole imported list immediately **reuses the general bulk-action system**, rather than being a one-off screen.

### Competitive edges to design in

- **NO artificial per-page cap.** HubSpot caps bulk actions at **100/page** — cited as friction. Act on the whole selection.
- **Do NOT paywall** basic bulk email / bulk task behind higher tiers. (HubSpot gates much of this to Pro/Enterprise.)

### Module ties

- **Bulk-actions system = FOUNDATIONAL** — used by the Contacts and Events lists + Automations.
- **Import clarity (2A)** = Import UX.
- **Durable batches (2B)** = Contacts/Events + tagging; the **"see all imports" browser** lives in the import/data area.
- **Post-import prompt (2D)** = Import UX calling into the bulk-actions system.

### Dependencies (build order signals)

- **Bulk EMAIL** depends on the **email send system** (being built now — the email round / notification build).
- **Bulk TASK/REMINDER** depends on the **Tasks module**.
- **Bulk SCHEDULE** depends on the **Scheduling** module.
- (Bulk tag/assign/add-to-pipeline depend on Contacts/Events + pipeline being in place.)

---

## F3 — At-a-glance engagement on list views (Contacts + Events/Projects lists)

**What:** surface **per-record engagement indicators** on list views as optional **COLUMNS** (or a compact status cell), so a user can scan a whole list/batch and instantly see, per contact:

- **Last email opened** — Y/N + when.
- **Link clicked** — Y/N.
- **Replied** — Y/N.
- **Last SMS / activity.**

**Purpose:** see engagement **across a list** without clicking into every record. Especially valuable **right after a bulk send** (e.g. the Oxford Exchange showcase batch) to spot who's engaging.

**Pain point solved (research-backed, HoneyBook):** HoneyBook **hides** email opens/clicks/reply/SMS status **inside each contact** — you can't see engagement across a list without opening every record one by one.

**Design:**

- Reuse the tracking data already captured by the email/notification build: **opens** (via the pixel, with the **Automated-Open / Human / Unknown** honesty model), **clicks**, **replies**, and the **delivery-event model**.
- Columns are **toggleable/addable** like other list columns, and **sortable/filterable** — e.g. _"show me everyone who opened but didn't reply."_
- **Respect the opens-are-directional honesty framing** — a list-level open indicator carries the same **"estimate"** caveat (opens are inflated by privacy proxies; lean on clicks/replies). Don't present a list-level open flag as hard truth.

**Ties:** depends on the **email tracking + delivery-event data** (building now) and the **list / saved-views + bulk-actions** system. Pairs naturally with **post-import bulk actions** (see F2) — scan engagement, then bulk-follow-up the non-openers.

**Module:** Contacts / Events list views + the list-column system.

---

## F4 — Smart file / document creation with clean naming (Smart Documents / Proposals, P12+)

Research-backed (HoneyBook pain point).

**Capability:** when creating a client-facing file (Proposal / Contract / Invoice / Questionnaire / Guide / etc.) on a project, offer **three starting points** (HoneyBook model):

- **(a) Use a template.**
- **(b) Start from a recent file** — clone a recently-sent file as a starting point.
- **(c) Start from blank.**

**CRITICAL BUG TO AVOID (HoneyBook does this wrong):** when cloning from a recent/previous file, the new file's name must use **ONLY the CURRENT project's name + the file type** — it must **NOT** retain the ORIGINAL file's project name. HoneyBook concatenates them, so cloning _"Allison Fluker and Jacob's wedding Guest List Guide"_ into Annika's project produces _"Annika Uhren's Project Allison Fluker and Jacob's wedding Guest List Guide"_ — **leaking a DIFFERENT client's names into this client's file** (a naming bug AND a privacy/professionalism leak the client sees).

**Correct behavior:** cloning a recent file must **strip the source project's name/identifiers and re-derive the name from the CURRENT project only** — e.g. _"Annika Uhren's Project — Guest List Guide."_ Applies to the **file name AND any auto-populated title/header fields**. Also **scrub any other source-client data** that shouldn't carry over (source project references, prior recipient names) — only the reusable **content/layout** clones, never the previous client's **identity**.

**Design note (system-wide rule):** this reinforces the **naming-hygiene rule for the whole clone/duplicate system** — cloning copies **structure/content, never the prior record's identity fields**. Applies to ANY clone-from-existing across the app.

**Module:** Smart Documents / Proposals (P12+); the clean-clone pattern applies to any clone-from-existing app-wide.

---

## F5 — AI feature build requirements (LOCKED — bake in from the start)

From the adversarial architecture review. These are **not optional polish** — they are required properties of ANY AI feature (AI-imported workflows, workflow drafts, upsell, summaries). Governed by the LOCKED laws in `AGENTS.md` → Standing design laws (esp. LAW 3 AI-is-a-tool, LAW 4 no-cross-tenant, LAW 5 plain-English). Ties to the AI stack vision in `docs/pm-lifecycle-vision-and-events-prep.md` §10.

1. **Plain-language, verifiable reconstruction.** AI-imported workflows present their reconstruction in plain English the user verifies — e.g. _"When a client does NOT fill the form in 7 days → send reminder. Is that right?"_ — and **EXPLICITLY flag negative/inverted conditionals** ("does NOT", "unless", "except") for user confirmation before saving. (LAW 5.)
2. **Test / dry-run before live.** ALL workflows (AI-imported OR hand-built) support a **test/dry-run on fake data** before deploying to the live environment. **Mandatory** for AI-imported workflows. (Companion to the seed-then-validate discipline of LAW 2.)
3. **Validation layer (never trust AI output into the DB).** AI-generated config is **validated against the real schema** (valid user*ids, foreign keys, entity references) BEFORE it is saved or rendered. Unresolved entities (e.g. an assignee name that isn't yet a team member) are **surfaced for the user to map** — *"We found 'John' — which team member is this, or create them?"\_ — never written as a raw string that can crash the UI.
4. **AI-output normalization (harden the model boundary).** The provider-agnostic AI layer **normalizes/sanitizes every model response** — strip markdown fences, coerce key casing to schema, validate against schema, repair-retry loop — and uses **structured-output / JSON mode** where supported, so swapping models never breaks parsing. (Ties to the provider-agnostic, task-typed-routing AI stack, §10.3.)
5. **AI cost control by ATTEMPTS, not saved count.** Meter AI by **generation attempts / compute**, not final saved-workflow count (count-based limits are gameable via delete-and-retry). Rate-limit generation attempts, **cache/reuse parses of identical uploads**, cap retries. Fold into the pre-launch AI cost model (§10.4).
6. **USER CONTROL OVER AI — two levels (the user owns how much AI runs their business).** Reinforces LAW 3 (AI surfaces; the human decides): the human also decides how much AI is even _active_.
   - **GLOBAL AI settings.** A settings area where the user toggles what AI is allowed to do **system-wide** — upsell/opportunity suggestions on/off, AI workflow building on/off, AI summaries on/off, etc. The user owns exactly how much AI is active in their business (default posture chosen at build time; all individually switchable).
   - **PER-PROJECT AI PAUSE.** A kill-switch to **pause/disable AI suggestions on a specific project**, independent of the global settings — so when something is "off" with one client (a difficult situation, a loss, a dispute) the human can silence AI for that client entirely without turning it off everywhere.

**Cross-tenant safeguard (LAW 4, restated for AI):** none of the above may read, embed, cache, or condition on another tenant's data. Validation is against the CURRENT tenant's schema/entities only. **No aggregate/cross-tenant "market insight" feature (LOCKED — see AGENTS.md LAW 4);** AI draws only from the current tenant's own data.

**Design note — no AI sentiment-suppression rule (deliberate).** We do NOT build logic where the AI decides _on its own_ when to stay silent in a sensitive situation. Human approval per LAW 3 is the north star: the AI may surface a suggestion; the human, who knows the real context, always decides whether to act. Combined with the per-project AI pause (above), that fully covers sensitive situations **without the AI making its own judgment** about when to speak.

## F6 — Dedicated client-presentation view (persona-law companion)

**What:** a **dedicated client-facing view** (first use case: the **day-of timeline** for live consultations) that **by design contains only client-safe data** — nothing internal is wired into it, so nothing internal can leak. Within the view, the user **opts fields IN via toggles** (show price, show 2nd shooter, show event details, …).

**Why this shape (not a toggle on an internal screen):** satisfies **LAW 1 persona separation** (no internal screen is ever exposed to a client) AND the live-consultation use case. **Opt-in, not opt-out** — so unintended internal data can _never_ be shown (the failure mode of an opt-out toggle is one missed switch = a leak).

**Ties:** persona-separation law (`AGENTS.md`); pairs with the client-facing lifecycle views mapped in `docs/pm-lifecycle-vision-and-events-prep.md` §5 (which also require cross-client data isolation from day one). **Module:** Events / Scheduling + a client-view layer.

---

## F7 — User-created sub-project type templates (self-serve workflow building)

Extends the shipped sub-project templates: users build and save their OWN reusable sub-project types — **no developer needed** (per the opinionated-defaults + simple-customization law, `docs/pm-lifecycle-vision-and-events-prep.md` §2).

**Flow:**

- User creates a sub-project, defines its typical **tasks + dependencies**, and **SAVES it as a reusable project-type template.**
- When starting/adding to a project, the user picks a sub-project type from a **templated menu** → it drops in showing the **sub-project name with its standard tasks listed underneath.**
- **Per-instance editing (does NOT alter the saved template):** a **(−)** control next to each task removes it for THIS instance; a **(+)** at the bottom adds a one-off task for this instance.
- **Dependency wiring in plain language, as they build:** when adding a task, prompt inline — _"Does this task have dependencies, or is it the end of the chain for this sub-project?"_ (LAW 5 plain-English).

**Architecture tie:** generates into the **SAME task-tree / workflow schema** as the shipped templates AND the AI-import feature — the shared generation target (`docs/pm-lifecycle-vision-and-events-prep.md` §10.3; the schema Events/P6 must build to). **Relabelable per vertical** (verbiage-agnostic underbelly). **Module:** Events / PM + the task-tree/template system.

## F8 — Soft-gate override confirmation (replaces the mandatory note)

When a user overrides a soft-gate / marks a blocked task done early, do NOT force a required note (too much friction — softens the §2 soft-gate rule that currently prompts for a reason). Instead:

- Show **"Was this task completed?"** with **Yes / No.**
- **Yes** → mark done, no further input.
- **No** → a free-text reasoning box **OPENS but is OPTIONAL** — the user can save "No" with no reasoning.
- **ADMIN / ORG SETTING:** whether reasoning is **REQUIRED on a "No"** is controlled at the admin level **per org**, so each studio sets its own data-capture rules (some want an audit trail, some want speed).
- **Scope note:** acceptable to ship the required-reasoning admin toggle as a **later add-on** if it's scope creep in v1 — but the **Yes/No + optional-free-text behavior is the baseline** (must be in the first version).

**Module:** Events / PM soft-gate + override framework (`docs/pm-lifecycle-vision-and-events-prep.md` §2); admin toggle → org settings.

---

_Roadmap only — not scheduled. When one is picked up, run it through the standing research → synthesize → complaint-scope → options → approval path before building._
