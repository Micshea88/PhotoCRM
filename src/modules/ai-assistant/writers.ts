import "server-only"
import type { z } from "zod"
import {
  archiveContact,
  createContact,
  unarchiveContact,
  updateContact,
} from "@/modules/contacts/actions"
import {
  archiveContactInput,
  createContactInput,
  unarchiveContactInput,
  updateContactInput,
} from "@/modules/contacts/types"
import { updateProject } from "@/modules/projects/actions"
import { updateProjectInput } from "@/modules/projects/types"
import { createTask, updateTask, markTaskDone } from "@/modules/tasks/actions"
import { createTaskInput, updateTaskInput, markTaskDoneInput } from "@/modules/tasks/types"
import {
  updateOpportunity,
  markOpportunityWon,
  markOpportunityLost,
} from "@/modules/opportunities/actions"
import {
  updateOpportunityInput,
  markOpportunityWonInput,
  markOpportunityLostInput,
} from "@/modules/opportunities/types"

/**
 * THE WRITER ALLOWLIST — Module 17b.
 *
 * AI LAYER PRINCIPLE (AI1, docs/PIVOTS_LEDGER.md Section 1): every AI
 * write routes through the IDENTICAL human orgAction path. There is
 * NO AI-specific write back-channel. The user types a request → the
 * model proposes → the human explicitly confirms → confirmWriteProposal
 * invokes the EXACT orgAction the manual UI uses.
 *
 * V1 ALLOWLIST (final, per the user's decision):
 *
 *   updateContact, createContact
 *   updateProject (createProject NOT included; users create projects
 *                  via the manual UI in V1)
 *   createTask, updateTask
 *   updateOpportunity
 *   markOpportunityWon, markOpportunityLost   ← status-flip mutators
 *   markTaskDone                              ← status-flip mutator
 *
 * EXCLUDED FROM V1 (destructive deletes):
 *   deleteContact, deleteProject, deleteTask, etc. — separate future
 *   commit with type-name-to-confirm friction.
 *
 * EXCLUDED FROM V1 (association adds/removes / bulk):
 *   add/remove project_photographers / project_contacts / task
 *   dependencies / checklist items — too complex for first-pass AI
 *   surface; manual UI is fine.
 *
 * ESLint enforces: writers.ts is the ONLY file in this module
 * permitted to import @/modules/STAR/actions. Every other file is
 * blocked at lint time. The static-grep test in Zone 1 enforces
 * belt-and-suspenders.
 */

export const ASSISTANT_WRITERS = {
  createContact,
  updateContact,
  archiveContact,
  unarchiveContact,
  updateProject,
  createTask,
  updateTask,
  updateOpportunity,
  markOpportunityWon,
  markOpportunityLost,
  markTaskDone,
} as const

/**
 * The canonical inputSchema for each writer — imported VERBATIM from
 * each module's types.ts. No AI-permissive variants. No repair branch.
 * The validation gate in `validate.ts` uses these schemas to validate
 * the AI's proposed input BEFORE persisting the proposal; the
 * `confirmWriteProposal` action re-validates at confirm time
 * (tamper-defense — same pattern as `confirmAiWorkflowDraft`).
 */
export const ASSISTANT_WRITER_INPUT_SCHEMAS = {
  createContact: createContactInput,
  updateContact: updateContactInput,
  archiveContact: archiveContactInput,
  unarchiveContact: unarchiveContactInput,
  updateProject: updateProjectInput,
  createTask: createTaskInput,
  updateTask: updateTaskInput,
  updateOpportunity: updateOpportunityInput,
  markOpportunityWon: markOpportunityWonInput,
  markOpportunityLost: markOpportunityLostInput,
  markTaskDone: markTaskDoneInput,
} as const satisfies Record<keyof typeof ASSISTANT_WRITERS, z.ZodType>

export type AssistantWriterName = keyof typeof ASSISTANT_WRITERS
export const ASSISTANT_WRITER_NAMES = Object.keys(ASSISTANT_WRITERS) as AssistantWriterName[]
