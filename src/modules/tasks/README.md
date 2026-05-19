# tasks module

The project-management engine. Four tables per Requirements §4.8 + §6.29:

- `tasks` — units of work
- `task_dependencies` — `blocked_by` graph (one direction only)
- `task_checklist_items` — inline sub-task tracking
- `project_stages` — per-project, user-editable task stages

## What's here

- `schema.ts` — all 4 tables + indexes.
- `types.ts` — `TASK_STATUSES`, `TASK_PRIORITIES`, Zod schemas for ~17 actions.
- `dependency-flip.ts` — the danger-zone helper:
  `recomputeTaskStatus` + `sweepDependentsAfterStatusChange`. Pure
  functions over a tx handle. **Read the header comment before
  editing.**
- `queries.ts` — `listTasksForProject`, `listTasksForOrg`, `getTaskForOrg`
  (with blockers + checklist joined), `listTasksByAssignee` (My Tasks),
  `listTasksByStatus`, `listTaskBlockers`, `listTasksBlockedBy`,
  `listProjectStages`, `getProjectStage`.
- `actions.ts` — 17 actions: 8 task ops (CRUD + 4 status mutators +
  soft-delete + restore), 2 dependency ops, 3 checklist ops, 3
  project-stage ops.

## Status state machine (Requirements §4.8)

```
not_started → in_progress → done                 (manual progression)
not_started → done                               (skip)
* → blocked                                       (AUTO, never manual)
blocked → ready                                   (AUTO when blockers
                                                  complete)
ready → in_progress → done                        (manual)
done → not_started / in_progress                  (manual un-complete)
```

**`blocked` is never set manually.** The dependency-flip helper is
the sole source of the `blocked` ↔ `ready` transitions. The user-facing
mutators are:

| Action                 | Sets status to                     | Side effect                                         |
| ---------------------- | ---------------------------------- | --------------------------------------------------- |
| `markTaskDone`         | `done` + `completedAt=now`         | sweep dependents → may flip them from blocked→ready |
| `markTaskNotDone`      | `not_started` + `completedAt=null` | recompute self (may → blocked) + sweep dependents   |
| `markTaskInProgress`   | `in_progress`                      | none                                                |
| `markTaskNotStarted`   | `not_started`                      | recompute self + sweep dependents                   |
| `addTaskDependency`    | (no direct change)                 | recompute the dependent task                        |
| `removeTaskDependency` | (no direct change)                 | recompute the dependent task (may → ready)          |

`updateTask` explicitly EXCLUDES `status` so the only paths into the
state machine go through the status mutators or the helper.

## Dependency-flip invariants (the dangerous-area truth table)

The 8 edge cases encoded in
`tests/integration/tasks-dependency-flip.test.ts`:

| Scenario                                         | Result                                |
| ------------------------------------------------ | ------------------------------------- |
| A blocked by B + C; B done, C not done           | A stays `blocked`                     |
| A blocked by B + C; both done                    | A flips to `ready`                    |
| A has no blockers                                | status untouched                      |
| A is `done`; blocker B reopened                  | A stays `done` (final-state rule)     |
| Sweep after blocker B becomes done               | dependents in `blocked` → `ready`     |
| `addTaskDependency` when blocker is already done | no transition (task status unchanged) |
| A `ready`; new blocker C not done                | A flips to `blocked`                  |
| Remove the last not-done blocker                 | A flips to `ready`                    |

**Read `src/modules/tasks/dependency-flip.ts`** for the rationale. The
3 rules in the header comment are the load-bearing invariants:

1. `done` is final — recompute is a no-op on done tasks. Reopening a
   blocker does NOT flip a completed dependent back to blocked.
2. Any not-done blocker → status becomes `blocked`.
3. No not-done blockers + current status is `blocked` → flip to `ready`.
   Other statuses are NOT touched (don't move `in_progress` backward).

## `project_stages` vs `pipeline_stages` — naming distinction

| Table             | Scope          | Editability                                                                                    |
| ----------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| `pipeline_stages` | workspace-wide | Configurable per org. Shared across all projects of that pipeline type (e.g., "Sales").        |
| `project_stages`  | per-project    | User-editable per project without touching the project's template. Templated by instantiation. |

The Phase 2 template instantiation engine (module 4.30) will create
`project_stages` rows from the template's task plan's `stage_name`
fields. The user can add/remove/rename per project without affecting
future projects from the same template.

## FK cascade strategy

| FK                                      | ON DELETE | Rationale                                                      |
| --------------------------------------- | --------- | -------------------------------------------------------------- |
| `tasks.project_id`                      | CASCADE   | Project purge takes its tasks.                                 |
| `tasks.project_stage_id`                | SET NULL  | Deleted stage leaves the task unstaged, doesn't kill the task. |
| `tasks.assignee_user_id`                | SET NULL  | Removed user; task lives on, unassigned.                       |
| `task_dependencies.task_id`             | CASCADE   | Deleted task takes its deps.                                   |
| `task_dependencies.blocked_by_task_id`  | CASCADE   | Same.                                                          |
| `task_checklist_items.task_id`          | CASCADE   | Checklist dies with its task.                                  |
| `task_checklist_items.assignee_user_id` | SET NULL  |                                                                |
| `project_stages.project_id`             | CASCADE   | Stages die with their project.                                 |

## Hard rules

1. **`status` is set only by the status-mutator actions or the
   dependency-flip helper.** `updateTask` doesn't accept it.
2. **`blocked` is never set manually.** Adding a not-done blocker
   transitions a task automatically; removing all blockers transitions
   it back.
3. **`done` is final until manually undone via `markTaskNotDone`.**
   Reopening a blocker does not un-complete dependents.
4. **Cycle detection in V1 is single-step only** (self-block rejected
   in the Zod refinement). Deeper cycles (A → B → A) are not detected;
   the UI is expected to prevent them. Document a future task to add
   graph cycle detection if it becomes an issue.
5. **Dependency-flip tests are the spec** for the helper's behavior.
   Changes to `dependency-flip.ts` must update or extend those tests.

## What's deferred

- **Recompute engine** (relative-date offsets + override protection) —
  per Tech Arch §4, shares one helper with payment-schedule recompute.
  Lands with the templated-task-plan instantiation module + the
  invoices module.
- **Cycle detection beyond self-reference** — A → B → A. UI-side
  prevention is enough for V1; revisit if customers complain.
- **Checklist item bulk reorder** — V1 ships individual item update.
  A batched reorder action (like `reorderPipelineStages`) lands when
  the UI needs it.
- ~~**Assignment-scoped RLS on tasks**~~ — **CLOSED** in commit 14a (migration
  `0015_assignment_scoped_rls_overlay`). Photographer/contractor/editor see
  tasks on projects they're project-photographer-assigned to OR tasks where
  they are the direct `assignee_user_id` (the markTaskDone carve-out). The
  per-operation update policy allows assignees to mutate their own tasks
  even when not project-assigned. See `tests/integration/assignment-scoped-rls.test.ts`.
