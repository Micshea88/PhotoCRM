-- Push 3 (C6a) — AI cache columns on contacts.
--
-- Per docs/pathway-ai-architecture.md, the Layer 2 classifier (Haiku)
-- + summary generator (Haiku) + Layer 3 insights (Sonnet) cache their
-- output on the contact row so the detail page can render instantly
-- on page-view (no AI roundtrip per render). Stale checks happen at
-- read time; regen happens on signal (manual refresh, > 24h since
-- ai_generated_at for classifier, > 7d for summary, etc).
--
-- All columns nullable; the AI module owns writes.

ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "ai_lead_status" text;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "ai_lead_status_reasoning" text;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "ai_summary_text" text;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "ai_insights_json" jsonb;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "ai_generated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "ai_generation_model" text;
