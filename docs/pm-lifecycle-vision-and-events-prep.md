# Pathway — PM / Client-Lifecycle Vision & Events (P6) Prep

**Status:** Holding document. Captures strategy, decisions, competitive research, and architectural vision from the PM planning session so nothing is lost before Events (P6) scoping.

**IMPORTANT — how to use this doc:** Forward-looking vision + research, NOT new locked decisions that override existing ones. Before P6 planning this MUST be reconciled against the already-locked Events/Pipeline/lifecycle decisions in docs/decisions-since-may-docs.md (and related). Where this vision conflicts with a locked decision, surface it and decide consciously — do NOT let new excitement silently overwrite a good locked call. Reconciliation section at the bottom.

## 0. One-line thesis

Pathway is the only tool that runs the full client lifecycle AND the actual post-contract project work in one system — setup speed of HoneyBook, PM depth of Asana, no Franken-stack. The client lifecycle IS the backbone of the PM system, not bolted next to it: the lifecycle stage drives what work should be happening, what got missed, and what's next. Anti-Franken-system.

## 1. The strategic gap (research-backed)

- CRMs (HoneyBook/Dubsado/17hats): great at intake, terrible at PM; stop at signed contract. HoneyBook PM = flat checklist, no visual views, no central cross-client dashboard. Dubsado slightly better (task lists/due dates/templates) but no visual PM, needs a separate tool.
- PM tools (Asana/ClickUp/Monday/Notion/Linear): great at PM, no client-lifecycle concept.
- Creatives run a 4-tool Franken-stack (~$60–100/mo + 2–3 hrs/wk copying data). Pathway's wedge: do intake AND the work.

## 2. Session decisions (reflect-back confirmed)

VIEWS: Board, List, Timeline, Table (~4 core, NOT 15). Calendar is its OWN thing (upcoming tasks + who's assigned), not a 5th project view. Not kanban-only, not thirty.
SOFT GATES: configurable — sensible SUGGESTED gates out of the box (zero setup), customizable per company WITHOUT a developer (plain UI), ALWAYS soft (manual override always allowed). Override is documented: prompts for a reason (checkbox → free-text "where/how", e.g. "payment received — check mailed"). Stages can't advance prematurely but are never hard-blocked.
DEPENDENCIES: Asana-style task/subtask dependencies FEED the soft gates — bigger teams ensure employees complete steps before a client advances. Bar: dependencies + timelines easy to follow without complex setup.
WORK AFTER CONTRACT: tasks, sub-events, deliverables, progress ACROSS clients (the central dashboard HoneyBook lacks). The whole opening.
PHASE-COMPLETION METER ("Mac storage bar"): visual % complete split by phase, click a segment to drill into done/not-done/not-started. Concept is CORE/vertical-agnostic; phase labels (pre-production/production/post-production) are the photography PACK. Every business: get leads in → close → deliver → follow-on (even if follow-on is just Google-review requests, job review, add to mailing list). Other verticals drop in their own phase labels. Also seeds the future client-facing "you are here" view.
ONBOARDING WIZARD (first-class): 15–20 min guided setup teaching where, what, and WHY (the "why" is what everyone skips → abandonment). Simplicity IS the feature (fewer config decisions = faster adoption).
OPINIONATED DEFAULTS + SIMPLE CUSTOMIZATION: HoneyBook's baked-in lifecycle out of the box + Dubsado's flexibility, WITHOUT the setup tax. The needle: customizable enough to be useful per-vertical, not so configurable it's ClickUp-setup-hell, not so generic the verbiage is useless. Built for photographers first, but for anyone in events — customization is largely relabeling since the underbelly is agnostic to top-layer verbiage.

## 3. End-to-end lifecycle example (Vinoy wedding) — a branching dependency tree scaffolded from intake, NOT a linear stage bar

1. Intake scaffolds the shell — lead form (June 20 2027, Vinoy, 100 guests, wedding) auto-creates the Event with date/venue/type + expected lifecycle pre-populated.
2. Booking (automatable) — auto emails/texts → schedule call (client self-books via link OR manual Zoom) → send smart-doc proposal.
3. Proposal/contract defines the work — hours, deliverables, # photographers, add-ons. Signing populates project requirements + timeline measured FROM the signing date. Automation can spell out production tasks; signed proposal fills specifics.
4. Dependency tree — assign/find 2nd photographer; send pre-wedding questionnaires; flag engagement/bridal/rehearsal shoots → each spawns its own sub-tree (date, photographer, own culling/editing/delivery chain).
5. Production dependencies — files received from photographer → cards backed up → culled → edited → photographer paid. Each gates the next.
6. Follow-on tree (order is USER-customizable, this is one example not canonical) — album ordered? → album-creation deps → album payment (if separate) → review request → send to publishers → share gallery (client + vendors) → post social → tag vendors.
7. AI upsell — at each stage, if the client didn't opt into something, surface the upsell.

## 4. Three architectural insights (heart of the marriage)

A. TASKS SPAWN TASKS — recursive, not a flat checklist. "Booked an engagement session" creates a whole sub-project (date, photographer, own culling/editing/delivery chain). Dependency system must support tasks/sub-events GENERATING dependent tasks/sub-events. No creative CRM does this. Task/dependency names/labels must be user-editable (wedding planner relabels a photographer's engine). Underbelly stays verbiage-agnostic.
B. SMART-DOC IS A PROJECT-SCAFFOLDING INPUT, not just a file. What's signed defines what work exists: proposal line items → project requirements → task tree, timeline anchored to signing date. Must be customizable per user, but NOT so overwhelming no one finishes setup, and NOT so generic it's useless.
C. AI UPSELL LAYER = revenue engine (TOP PRIORITY). Watches the lifecycle for gaps that are money left on the table (no album, no engagement session, gallery not sent to publishers) and surfaces TIMED upsells. Uses CROSS-CLIENT system data — "clients with similar events booked X at this stage" — to suggest what/when/at what stage, UNLESS the client explicitly declined that service (respect declines). Flips value prop from "helps you do your job" to "helps you make more per client." Ties to locked Proposal feature + HoneyBook-replacement thesis.

## 5. Client-facing views — V2/V3 (mapped, not now)

Deferred to V2/V3 but mapped so the data model doesn't preclude them. When built: first-class/branded, not a guest badge on internal UI. Simple "you are here" progress beats a Gantt for non-PM clients — the client-facing face of the phase-completion meter. CROSS-CLIENT DATA ISOLATION is a hard security requirement from day one: Client A never sees Client B's projects/files/messages; internal notes/estimates private by default; sharing to a client is an explicit action. Echoes the HoneyBook bug where collaborators can change YOUR project status — Pathway RBAC + gating must prevent this (status changes respect roles).

## 6. Competitive research

STEAL: HoneyBook's opinionated flow (inquiry→proposal→contract→payment→project→offboarding, operational ~24hrs, hard to break). Dubsado's customizable statuses + "Change Project Status" automation action + task templates. PM tools' multiple views (capped at ~4). Asana/Linear opinionated simplicity ("good habits without config overhead"). Intake auto-creates project/tasks/timeline (Noloco).
AVOID (cited bloat): ClickUp — 2–4 wk onboarding, 5–10 hrs config, decision fatigue, does anything but few things well, needs implementation partner; #1 reason teams leave is the learning curve. Notion — flexibility without structure = no real PM. Lesson: fewer config decisions = faster adoption; simplicity IS the feature. HoneyBook's messy projects screen — pipeline stages as PM buckets that can't be filtered/sorted; tag sprawl (any user creates company-wide tags → chaos). Pathway: keep pipeline_status a clean status dimension; every list genuinely filterable + sortable (stacking filters); govern tags (managed sets, rename/merge/dedupe, restrict who creates company-wide tags).
HONEYBOOK AUTOMATION CEILING (observed): Automations 2.0 does trigger→wait→send→create-task with some conditional branches, but it's a flat linear script — no real dependency tree, no task-spawns-task, no completion state feeding gates, no AI watching for gaps. That's the ceiling Pathway beats.

## 7. CRITICAL MANDATE for P6

This is NOT "the Events module" — it is the architectural spine of the entire remaining build (P5–P12+). The vision touches nearly every future module: Lead Capture, Smart Docs/Proposals, Automations, Events, Tasks/dependencies, Finance/Payments, Scheduling, AI upsell. We are NOT building all of it in P6. We ARE requiring P6 be built to be COMPATIBLE with all of it — data model, entity relationships, extension points must anticipate the recursive task/sub-event tree, smart-doc→project scaffolding, lifecycle-stage→expected-work mapping, configurable soft gates + dependencies, and the AI upsell layer — so future modules bolt on across ~9–11 builds WITHOUT breakage or rework. Must be addressed explicitly with CC BEFORE P6 via a dedicated forward-compatibility brief derived from the reconciled vision + locked decisions.

## 8. Sequencing (finalize in roadmap, against locked order P4→P3→P5→P6→…→P11→P12+)

P5 (Pipeline UI): clean status dimension, filterable/sortable, not a junk-drawer bucket strip.
P6 (Events core): minimum lifecycle→work spine — Events with pipeline_status, sub-events, recursive task/dependency data model FOUNDATIONS, phase-completion meter concept, soft-gate framework foundations. Built forward-compatible per §7.
Later: smart-doc→scaffold when Proposals/Smart Docs ship (P12+); AI upsell when enough modules+data exist; automations spelling out production tasks; Finance for payment-gated dependencies; client-facing views V2/V3. Onboarding wizard + configurable-gates UI sequenced so "simplicity" is real at each stage.

## 9. RECONCILIATION vs locked repo decisions (TO COMPLETE before P6)

Extract locked Events/Pipeline/lifecycle architecture verbatim from docs/decisions-since-may-docs.md, then:

- [ ] List each locked Events/Pipeline decision verbatim.
- [ ] Map each item here to: CONSISTENT / EXTENDS / CONFLICTS with a locked decision.
- [ ] For any CONFLICT: surface explicitly and decide consciously — do NOT overwrite a good locked call.
- [ ] Confirm the lifecycle→work architecture already exists for the photography vertical — reference what's there, fill gaps only.
      (Locked-decision extract goes here once pulled.)
