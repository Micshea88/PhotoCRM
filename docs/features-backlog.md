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

_Roadmap only — not scheduled. When one is picked up, run it through the standing research → synthesize → complaint-scope → options → approval path before building._
