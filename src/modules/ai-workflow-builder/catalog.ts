import {
  TRIGGER_TYPES,
  NATIVE_ACTION_TYPES,
  STUB_ACTION_TYPES,
  type TriggerType,
  type ActionType,
} from "@/modules/workflows/types"

/**
 * THE CATALOG — derived from `src/modules/workflows/types.ts` at module
 * load. Single source of truth for "what's offered to the model."
 *
 * Adding a trigger or action to Module 15 automatically widens what the
 * AI can emit; removing one automatically narrows it. No separate
 * maintenance. This derivation is the proof that the AI can never
 * emit an action the live engine doesn't support.
 *
 * Per the AI layer guiding principle ("it is a tool, not the leader"),
 * the catalog is the bounded universe the human's request can produce.
 * The model is told: "Emit ONLY from these ids."
 */

export interface CatalogTrigger {
  id: TriggerType
  description: string
}

export interface CatalogNativeAction {
  id: ActionType
  description: string
}

export interface CatalogDeferredAction {
  id: ActionType
  description: string
  deferredReason: string
}

export interface PromptCatalog {
  triggers: CatalogTrigger[]
  nativeActions: CatalogNativeAction[]
  deferredActions: CatalogDeferredAction[]
}

const TRIGGER_DESCRIPTIONS: Record<TriggerType, string> = {
  "opportunity.stage_changed":
    "Fires when an opportunity moves to a specific pipeline stage. triggerConfig.stage_id required.",
  "opportunity.won": "Fires when an opportunity is marked won.",
  "opportunity.lost": "Fires when an opportunity is marked lost.",
  "task.completed": "Fires when a task is marked done.",
  "task.due_soon":
    "Fires daily for tasks whose due_date is N days away. triggerConfig.days_before required.",
  "project.created": "Fires when a new project (event) is created.",
  "contact.created": "Fires when a new contact is created.",
  "payment_installment.overdue":
    "Fires daily for payment installments past their due_date and still scheduled.",
  date_relative:
    "Fires daily for records matching a configured field+offset. triggerConfig.field and triggerConfig.offset_days required.",
}

const NATIVE_ACTION_DESCRIPTIONS: Partial<Record<ActionType, string>> = {
  send_email:
    "Send an outbound email via the studio's verified domain. config: { to, subject, body }.",
  create_task: "Create a task on a project. config: { title, projectId, ... }.",
  update_field:
    "Update one or more fields on a contact/project/opportunity/task. config: { resourceType, resourceId, fields }.",
  change_pipeline_stage:
    "Move an opportunity to a different pipeline stage. config: { opportunityId, targetStageId }.",
  add_tag: "Add a tag to a contact. config: { contactId, tag }.",
  remove_tag: "Remove a tag from a contact. config: { contactId, tag }.",
  assign_owner:
    "Assign an owner (user) to a contact or opportunity. config: { resourceType, resourceId, ownerUserId }.",
  mark_won: "Mark an opportunity won. config: { opportunityId }.",
  mark_lost: "Mark an opportunity lost. config: { opportunityId, lostReason }.",
  create_note:
    "Append a note to a contact or project's notes column. config: { resourceType, resourceId, note }.",
  wait: "Pause the workflow for N days. config: { delayDays }.",
  if_else: "Branch based on a condition. Use the step's branchCondition field.",
  end_workflow: "Terminate the workflow cleanly.",
}

const DEFERRED_REASONS: Record<(typeof STUB_ACTION_TYPES)[number], string> = {
  send_invoice:
    "send_invoice is deferred until Stripe Connect is unlocked. Configure this step or remove it to run the workflow.",
  take_payment:
    "take_payment is deferred until Stripe Connect is unlocked. Configure this step or remove it to run the workflow.",
  send_sms: "send_sms is deferred until the SMS provider is configured.",
  send_smart_document: "send_smart_document is deferred until the Smart Documents module ships.",
  send_smart_doc_for_signature:
    "send_smart_doc_for_signature is deferred until the Smart Documents module ships.",
  send_questionnaire: "send_questionnaire is deferred until the questionnaires module ships.",
  send_webhook: "send_webhook is deferred until the outbound-webhook infrastructure ships.",
  create_calendar_event:
    "create_calendar_event is deferred until a calendar provider is configured.",
}

/**
 * Build the catalog presented to the model. Pure function; the result
 * is stable across all calls within a process lifetime.
 */
export function buildCatalogForPrompt(): PromptCatalog {
  return {
    triggers: TRIGGER_TYPES.map((id) => ({
      id,
      description: TRIGGER_DESCRIPTIONS[id],
    })),
    nativeActions: NATIVE_ACTION_TYPES.map((id) => ({
      id,
      description: NATIVE_ACTION_DESCRIPTIONS[id] ?? id,
    })),
    deferredActions: STUB_ACTION_TYPES.map((id) => ({
      id,
      description: NATIVE_ACTION_DESCRIPTIONS[id] ?? id,
      deferredReason: DEFERRED_REASONS[id],
    })),
  }
}

/** Set used by the validation gate's native-only assertion. */
export const NATIVE_ACTION_SET: ReadonlySet<string> = new Set<string>(NATIVE_ACTION_TYPES)

/** Set used to detect when a stub action sneaks in as a step. */
export const STUB_ACTION_SET: ReadonlySet<string> = new Set<string>(STUB_ACTION_TYPES)
