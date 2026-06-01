import { Pool } from "pg"

/**
 * Truncates application tables before an E2E test. Keeps Better Auth's auth
 * tables but wipes user-generated data + sessions so each spec starts clean.
 *
 * Lists are explicit (not "drop all") to avoid wiping schema metadata or
 * unrelated tables a future module might add. Update when adding modules.
 */
const TABLES_TO_TRUNCATE = [
  "audit_log",
  "call_log",
  "email_log",
  "companies",
  "contact_company_associations",
  "contact_notes",
  "contacts",
  "custom_field_definitions",
  "faq_entries",
  "files",
  "items",
  "member_permission_override",
  "member_role",
  "opportunities",
  "payment_installments",
  "pipeline_stages",
  "pipelines",
  "project_contacts",
  "project_photographers",
  "project_stages",
  "project_sub_events",
  "project_template_task_items",
  "project_templates",
  "projects",
  "saved_views",
  "user_object_view_prefs",
  "task_checklist_items",
  "task_dependencies",
  "tasks",
  "terminology_map",
  "ai_assistant_messages",
  "ai_workflow_drafts",
  "workflow_executions",
  "workflow_steps",
  "workflows",
  "invitation",
  "member",
  "organization",
  "session",
  "account",
  "verification",
  "user",
] as const

export async function resetDatabase(connectionString: string) {
  const pool = new Pool({ connectionString, max: 1 })
  try {
    const list = TABLES_TO_TRUNCATE.map((t) => `"${t}"`).join(", ")
    await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
  } finally {
    await pool.end()
  }
}
