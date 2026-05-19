import type { ValidatedDraft } from "./validate"

/**
 * Render a validated draft as plain-language prose for the human-review
 * step. Pure function. Per the AI layer guiding principle ("it is a tool,
 * not the leader"), the human MUST be able to see what the AI proposed
 * in clear language before confirming.
 *
 * The user UI displays both this rendering AND the raw structured draft
 * alongside the "this will be saved DISABLED" notice. The "Confirm" button
 * is the only mutation path.
 */
export function renderDraftAsProse(draft: ValidatedDraft): string {
  const lines: string[] = []
  lines.push(`Workflow: ${draft.name}`)
  if (draft.description) lines.push(`Description: ${draft.description}`)
  lines.push("")
  lines.push(`When: ${renderTrigger(draft.triggerType, draft.triggerConfig)}`)
  lines.push("Then:")
  for (const [idx, step] of draft.steps.entries()) {
    const seq = `${String(idx + 1)}.`
    lines.push(`  ${seq} ${renderStep(step.actionType, step.actionConfig, step.branchCondition)}`)
  }
  lines.push("")
  lines.push(
    "This workflow will be saved DISABLED. You must enable it manually before it can fire.",
  )
  return lines.join("\n")
}

function renderTrigger(triggerType: string, triggerConfig: Record<string, unknown> | null): string {
  switch (triggerType) {
    case "opportunity.stage_changed": {
      const stageId =
        typeof triggerConfig?.stage_id === "string" ? triggerConfig.stage_id : "(unspecified stage)"
      return `An opportunity moves to stage ${stageId}.`
    }
    case "opportunity.won":
      return "An opportunity is marked won."
    case "opportunity.lost":
      return "An opportunity is marked lost."
    case "task.completed":
      return "A task is marked done."
    case "task.due_soon": {
      const days =
        typeof triggerConfig?.days_before === "number" ? triggerConfig.days_before : "(unspecified)"
      return `A task is ${String(days)} days from its due date.`
    }
    case "project.created":
      return "A new project (event) is created."
    case "contact.created":
      return "A new contact is created."
    case "payment_installment.overdue":
      return "A payment installment is past its due date."
    case "date_relative":
      return "A configured date+offset rule matches."
    default:
      return triggerType
  }
}

function renderStep(
  actionType: string,
  config: Record<string, unknown> | null,
  branchCondition: Record<string, unknown> | null,
): string {
  let line = renderStepBody(actionType, config)
  if (branchCondition) {
    const field = typeof branchCondition.field === "string" ? branchCondition.field : "(unknown)"
    const op = typeof branchCondition.op === "string" ? branchCondition.op : "(unknown)"
    line = `(only if ${field} ${op} …) ${line}`
  }
  return line
}

function renderStepBody(actionType: string, config: Record<string, unknown> | null): string {
  switch (actionType) {
    case "send_email": {
      const to = typeof config?.to === "string" ? config.to : "(no recipient)"
      const subject = typeof config?.subject === "string" ? config.subject : "(no subject)"
      return `Send an email to ${to} with subject "${subject}".`
    }
    case "create_task": {
      const title = typeof config?.title === "string" ? config.title : "(no title)"
      return `Create a task: "${title}".`
    }
    case "update_field": {
      const rt = typeof config?.resourceType === "string" ? config.resourceType : "(resource)"
      return `Update fields on a ${rt}.`
    }
    case "change_pipeline_stage":
      return "Move an opportunity to a different pipeline stage."
    case "add_tag": {
      const tag = typeof config?.tag === "string" ? config.tag : "(tag)"
      return `Add the tag "${tag}" to a contact.`
    }
    case "remove_tag": {
      const tag = typeof config?.tag === "string" ? config.tag : "(tag)"
      return `Remove the tag "${tag}" from a contact.`
    }
    case "assign_owner":
      return "Assign an owner to the record."
    case "mark_won":
      return "Mark the opportunity won."
    case "mark_lost":
      return "Mark the opportunity lost."
    case "create_note":
      return "Append a note to the record."
    case "wait": {
      const days = typeof config?.delayDays === "number" ? config.delayDays : "(unspecified)"
      return `Wait ${String(days)} days.`
    }
    case "if_else":
      return "Branch based on the condition above."
    case "end_workflow":
      return "End the workflow."
    default:
      return actionType
  }
}
