# Pathway AI Architecture

Companion to `docs/pathway-build-roadmap.md`. Defines provider strategy,
model tier choices, integration use cases, caching, hybrid intelligence
layers, and cost model for every AI-touched feature in V1 and V2.

**Current state note (Push 4):** the AI integration surface already
exists at `src/lib/ai-model.ts` (single Anthropic SDK importer per the
PIVOTS_LEDGER AI1 rule) and `src/modules/ai-assistant/` (full
conversational module with retrievers, route catalog, write-proposal
lifecycle, rate limits). Push 3 C6 **extends** this surface rather than
rebuilding.

---

## Provider Strategy

- **Anthropic only for V1.**
- Future flexibility via the existing `callAiModel({ systemPrompt,
userPrompt })` interface in `src/lib/ai-model.ts`. The function
  signature is provider-agnostic; the SDK importer is constrained to
  this one file via the ESLint allowlist.
- Multi-provider support is **deferred** — re-evaluate when monthly AI
  spend exceeds **$200** or quality concerns surface that an alternate
  provider would resolve.

---

## Model Tiers

| Tier      | Model id                    | Use cases                                                                             | Volume       |
| --------- | --------------------------- | ------------------------------------------------------------------------------------- | ------------ |
| **Cheap** | `claude-haiku-4-5-20251001` | Lead status classifier, AI summary, simple Layer 3 insights                           | 99% of calls |
| **Mid**   | `claude-sonnet-4-6`         | Complex Layer 3 agentic insights, multi-step reasoning, write proposals via assistant | Rare         |
| **Opus**  | `claude-opus-4-7`           | **NOT USED in V1** (too expensive for current needs)                                  | 0%           |

The `AI_WORKFLOW_BUILDER_MODEL` env var currently defaults to
`claude-sonnet-4-6`. Push 3 C6 introduces a `model` parameter on
`callAiModel` so each task can select its tier.

---

## Shared Integration Use Cases (V1 + V2)

| Push                  | Use case                                                                                                                   | Model                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Push 3 C6**         | Lead status classifier (19-enum)                                                                                           | Haiku                                                         |
| **Push 3 C6**         | AI client summary (paragraph)                                                                                              | Haiku                                                         |
| **Push 3 C6**         | Layer 3 agentic insights (2-3 starter types)                                                                               | Haiku for simple, Sonnet for complex                          |
| **Push 4 (shipped)**  | AI assistant conversational surface (`src/modules/ai-assistant/`)                                                          | Sonnet                                                        |
| **Push 4 (shipped)**  | AI workflow builder (`src/modules/ai-workflow-builder/`)                                                                   | Sonnet                                                        |
| **Push 8**            | AI meeting assistant — Zoom call notes + summary auto-added to client record                                               | Haiku for summary, Sonnet for complex multi-speaker reasoning |
| **Push 12+ AI Suite** | Full agentic insights expansion + AI Help Module (platform-wide navigation, client lookup, "take me to X" / "do Y for me") | Sonnet for tool use, Haiku for simple replies                 |

The `AIProvider` abstraction must support **both** simple text
generation AND tool use (the Help Module's agentic capabilities).
Existing `assistantOutputSchema` in `src/modules/ai-assistant/types.ts`
already models this with a `discriminatedUnion("kind")` of
`reply` / `retrieve` / `navigate` / `refusal` / `write_proposal` — the
contract Push 12+ needs is already established.

---

## Caching Strategy

**New columns on contacts table (Push 3 C6 migration 0034):**

| Column                     | Type                           | Cache TTL                          | Purpose                                                                     |
| -------------------------- | ------------------------------ | ---------------------------------- | --------------------------------------------------------------------------- |
| `ai_lead_status`           | `text` (one of 19 enum values) | **24 hours**                       | Layer 2 classifier output                                                   |
| `ai_lead_status_reasoning` | `text`                         | 24 hours                           | Why the classifier picked this status (for the badge tooltip + audit trail) |
| `ai_summary_text`          | `text`                         | **7 days**                         | Layer 2 client-summary paragraph                                            |
| `ai_insights_json`         | `jsonb`                        | Stale on signal change (see below) | Layer 3 actionable insight cards                                            |
| `ai_generated_at`          | `timestamp with timezone`      | —                                  | Stamps the most recent AI write                                             |
| `ai_generation_model`      | `text`                         | —                                  | Which model generated the cached values (for forensics + cost analysis)     |

**Regenerate on:**

1. Stale cache + contact opened (status > 24h OR summary > 7d).
2. New activity logged for this contact (note / call / meeting / SMS).
3. New event created for this contact.
4. Status change (manual or rule-engine driven).
5. Manual **Refresh** button on the badge / summary.

Implementation: a small policy module `src/lib/ai/cache-policy.ts`
exports `shouldRegenerate(contact, signal)` returning `boolean`. The
detail-page server component calls this before deciding to invoke the
classifier.

---

## Hybrid Intelligence Layers

| Layer                         | Source                                      | AI cost           | Job                                                                                                                                     |
| ----------------------------- | ------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Layer 1: Rules engine**     | DB query against contacts + activity tables | $0                | Computes facts — days since last contact, response cadence, event counts, payment status, referral counts, proposal values              |
| **Layer 2: AI classifier**    | Haiku                                       | ~$0.001/call      | Picks status from the 19-enum, reasons over Layer 1 facts + context (handles nuance like warm-but-quiet, VIP from proposal value, etc.) |
| **Layer 3: Agentic insights** | Haiku for simple, Sonnet for complex        | ~$0.001-0.01/call | Actionable recommendations with one-click action buttons. 2-3 starter types in Push 3 C6, full suite in Push 12+                        |

---

## Layer 2 Concrete Reasoning Examples

### 1. Warm-but-quiet (traveling context)

- **Facts (Layer 1)**: 5 days since last reply.
- **Old rule**: 4-7 days = Cold Lead.
- **AI reasoning**: "For the first month they replied within 12
  minutes consistently. Last message mentioned traveling for an Italy
  consultation. 5 days silence after that context is **not** Cold —
  it's expected."
- **Output status**: Warm Lead with note "traveling, expected back
  ~next week".

### 2. Booked but not yet active

- **Facts**: Contract signed, retainer paid, wedding date 9 months
  away.
- **AI reasoning**: "Production hasn't started — not in culling /
  editing / delivery phase."
- **Output status**: Booked Client (NOT Active Client). Will
  auto-progress when production tasks created or sub-event date
  approaches.

### 3. VIP detection from proposal value

- **Facts**: 1 booking, proposal sent $14,500.
- **AI reasoning**: "Single booking but proposal value $14,500 is in
  top 10% of K&K's historical bookings."
- **Output status**: VIP Client (NOT Booked Client) — flag for
  white-glove handling.

### 4. Volume-based referral source

- **Facts**: 8 referrals in 12 months, 0 booked.
- **AI reasoning**: "8 referrals in 12 months is high volume —
  qualifies as Top Referral Source regardless of conversion."
- **Output status**: Top Referral Source.
- **Layer 3 separate insight**: conversion gap as a SEPARATE
  agentic-insight card: "Sent 8 leads, 0 booked. Consider different
  conversation approach or follow-up cadence. I can draft a
  re-engagement email based on the planner's website if helpful."

---

## Layer 3 Starter Insights (Push 3 C6)

| #   | Insight type                       | Trigger condition                                             | Action button                                                                           |
| --- | ---------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | **Cold lead re-engagement**        | Lead has gone cold (rule + AI confirm)                        | "Draft re-engagement email" — AI drafts tailored to last conversation context           |
| 2   | **VIP detection**                  | Contact's proposal value or booking pattern flags them as VIP | "View white-glove playbook" (actual playbook content TBD by Mike pre-build)             |
| 3   | **Referral source conversion gap** | High-volume referral source with low conversion               | "Draft re-engagement email to next pending referral" or "Schedule coffee with referrer" |

Full agentic suite — more insight types, deeper actions, learning
from user accept/dismiss feedback — ships in **Push 12+ AI Suite**.

---

## Cost Model

- **K&K scale** (500-1500 contacts/year, ~50-150 actively worked at
  any time): **~$5-15/month total.**
- Cache aggressively. Generate only on stale + opened, or data
  change.
- Existing rate limits (per `src/lib/env.ts`):
  - `AI_WORKFLOW_BUILDER_HOURLY_USER` default 100
  - `AI_WORKFLOW_BUILDER_HOURLY_ORG` default 500
  - `AI_WORKFLOW_BUILDER_DAILY_ORG` default 2000
  - `AI_ASSISTANT_HOURLY_USER` default 300
  - `AI_ASSISTANT_HOURLY_ORG` default 1500
  - `AI_ASSISTANT_DAILY_ORG` default 6000
- Push 3 C6 adds rate limits for the new lead-status / summary /
  insights tasks under a similar shape.
- **If cost exceeds $200/month**: revisit model tier choices,
  consider adding a cheaper provider (e.g., OpenAI gpt-4o-mini) for
  Layer 2 fallback. This triggers a flagged decision per the
  AI-provider lock — not a quiet swap.

---

## Fallback Behavior

- **API timeout / error** → show last cached value + "AI temporarily
  unavailable" toast. Don't block the page render.
- **First-time generation while API down** → show "Generating..."
  placeholder, retry on next page load.
- **`ANTHROPIC_API_KEY` not set** → `callAiModel` throws a clear
  "AI Workflow Builder is not configured" error. The build succeeds;
  any UI surface that depends on AI shows a graceful "AI not
  configured" state instead of crashing. This is the locked posture
  per `src/lib/ai-model.ts`.

---

## Cross-references

- `docs/pathway-build-roadmap.md` — push sequence + locked
  architectural decisions
- `docs/push-3-audit.md` — current state of the AI surface at the
  start of Push 3
- `docs/PIVOTS_LEDGER.md` — AI1 rule ("the AI is a tool the human
  drives, never an autonomous actor"); single SDK importer rule
- `src/lib/ai-model.ts` — the one Anthropic SDK importer
- `src/modules/ai-assistant/` — conversational surface, retrievers,
  route catalog, message persistence
- `src/modules/ai-workflow-builder/` — AI-drafted workflows surface
