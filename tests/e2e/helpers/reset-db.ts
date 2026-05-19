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
  "companies",
  "contacts",
  "custom_field_definitions",
  "files",
  "items",
  "member_permission_override",
  "member_role",
  "opportunities",
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
  "task_checklist_items",
  "task_dependencies",
  "tasks",
  "terminology_map",
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
