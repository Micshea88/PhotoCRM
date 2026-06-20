import { z } from "zod"

/**
 * Per Requirements §4.8 + §6.29. The state machine for a task. `blocked`
 * is NEVER set manually — it's the output of the dependency-flip helper
 * (src/modules/tasks/dependency-flip.ts). The user-facing status mutators
 * are the markTask{Done,NotDone,InProgress,NotStarted} actions; status
 * doesn't appear on the updateTask input schema.
 */
export const TASK_STATUSES = ["not_started", "blocked", "ready", "in_progress", "done"] as const
export const taskStatusSchema = z.enum(TASK_STATUSES)
export type TaskStatus = z.infer<typeof taskStatusSchema>

// Low / Medium / High — the HubSpot/Salesforce 3-level pattern (Mike, 2026-06-19).
// "urgent" was dropped (it existed in the enum but was never used in UI/seed/tests).
export const TASK_PRIORITIES = ["low", "medium", "high"] as const
export const taskPrioritySchema = z.enum(TASK_PRIORITIES)
export type TaskPriority = z.infer<typeof taskPrioritySchema>

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .nullable()

const isoDateNullable = z
  .union([z.iso.date(), z.literal("")])
  .transform((v) => (v === "" ? null : v))
  .nullable()

const customFieldsSchema = z.record(z.string(), z.unknown()).optional().nullable()

// ─── Task CRUD ─────────────────────────────────────────────────────────

export const createTaskInput = z
  .object({
    // Contact Tasks: a task is scoped to a project (Event), a contact, or
    // both — at least one is required (the .refine below). Project-scoped
    // creation (Event detail, template instantiation) passes projectId;
    // contact-scoped creation (the contact Tasks tab) passes contactId.
    projectId: z.string().nullable().optional(),
    contactId: z.string().nullable().optional(),
    projectStageId: z.string().nullable().optional(),
    title: z.string().min(1).max(300),
    description: optionalText(10000).optional(),
    assigneeUserId: z.string().nullable().optional(),
    assigneeRole: optionalText(120).optional(),
    dueDate: isoDateNullable.optional(),
    priority: taskPrioritySchema.nullable().optional(),
    order: z.number().int().nonnegative().default(0),
    customFields: customFieldsSchema,
  })
  .refine((v) => !!v.projectId || !!v.contactId, {
    message: "A task must belong to an event or a contact.",
    path: ["contactId"],
  })

/**
 * updateTask explicitly EXCLUDES `status` and `completedAt` —
 * status transitions go through markTask{Done,NotDone,InProgress,NotStarted}
 * actions so the dependency-flip helper has a chance to sweep dependents
 * and completedAt stays consistent.
 */
export const updateTaskInput = z.object({
  id: z.string(),
  projectStageId: z.string().nullable().optional(),
  title: z.string().min(1).max(300).optional(),
  description: optionalText(10000).optional(),
  assigneeUserId: z.string().nullable().optional(),
  assigneeRole: optionalText(120).optional(),
  dueDate: isoDateNullable.optional(),
  priority: taskPrioritySchema.nullable().optional(),
  order: z.number().int().nonnegative().optional(),
  // Setting `dueDate` explicitly via this action flips
  // due_date_overridden=true (the recompute engine respects that). Not
  // exposed as a separate input — the action infers it.
  customFields: customFieldsSchema,
})

// Contact Tasks: associate an existing task with an Event (project), or clear
// the association. Associate keeps the contact link (rolls up to both);
// remove reverts a task to contact-scoped (the action rejects clearing the
// last scope — a project-only task can't drop its event without a contact).
export const associateTaskEventInput = z.object({
  id: z.string(),
  projectId: z.string().min(1),
})
export const removeTaskEventInput = z.object({ id: z.string() })

export const markTaskDoneInput = z.object({ id: z.string() })
export const markTaskNotDoneInput = z.object({ id: z.string() })
export const markTaskInProgressInput = z.object({ id: z.string() })
export const markTaskNotStartedInput = z.object({ id: z.string() })

export const deleteTaskInput = z.object({ id: z.string() })
export const restoreTaskInput = z.object({ id: z.string() })

// ─── Dependencies ─────────────────────────────────────────────────────

/**
 * Self-block check enforced via Zod refinement. Cycle detection beyond
 * direct self-reference (e.g., A → B → A) is V1-deferred; the UI is
 * expected to prevent it. Documented in the README.
 */
export const addTaskDependencyInput = z
  .object({
    taskId: z.string(),
    blockedByTaskId: z.string(),
  })
  .refine((v) => v.taskId !== v.blockedByTaskId, {
    message: "A task cannot block itself",
    path: ["blockedByTaskId"],
  })

export const removeTaskDependencyInput = z.object({ id: z.string() })

// ─── Checklist items ──────────────────────────────────────────────────

export const addTaskChecklistItemInput = z.object({
  taskId: z.string(),
  label: z.string().min(1).max(500),
  assigneeUserId: z.string().nullable().optional(),
  order: z.number().int().nonnegative().default(0),
})

export const updateTaskChecklistItemInput = z.object({
  id: z.string(),
  label: z.string().min(1).max(500).optional(),
  done: z.boolean().optional(),
  assigneeUserId: z.string().nullable().optional(),
  order: z.number().int().nonnegative().optional(),
})

export const removeTaskChecklistItemInput = z.object({ id: z.string() })

// ─── Project stages ──────────────────────────────────────────────────

export const createProjectStageInput = z.object({
  projectId: z.string(),
  name: z.string().min(1).max(120),
  order: z.number().int().nonnegative().default(0),
  color: z.string().max(40).nullable().optional(),
})

export const updateProjectStageInput = z.object({
  id: z.string(),
  name: z.string().min(1).max(120).optional(),
  order: z.number().int().nonnegative().optional(),
  color: z.string().max(40).nullable().optional(),
})

export const deleteProjectStageInput = z.object({ id: z.string() })

export type CreateTaskInput = z.infer<typeof createTaskInput>
export type UpdateTaskInput = z.infer<typeof updateTaskInput>
export type AddTaskDependencyInput = z.infer<typeof addTaskDependencyInput>
export type AddTaskChecklistItemInput = z.infer<typeof addTaskChecklistItemInput>
export type UpdateTaskChecklistItemInput = z.infer<typeof updateTaskChecklistItemInput>
export type CreateProjectStageInput = z.infer<typeof createProjectStageInput>
