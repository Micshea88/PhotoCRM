import "server-only"
import { z } from "zod"
import {
  searchContactsByName,
  getContactForOrg,
  listContactsByCompany,
} from "@/modules/contacts/queries"
import {
  listProjectsForOrg,
  getProjectForOrg,
  listProjectsByLifecycle,
} from "@/modules/projects/queries"

/**
 * THE READ ALLOWLIST. Every entry wraps an existing queries.ts
 * function which uses withOrgContext. RLS bounds visibility
 * automatically: the AI sees only what the requesting user would
 * see by clicking through the UI.
 *
 * AI LAYER PRINCIPLE (AI1): the AI cannot construct ad-hoc Drizzle
 * queries. Its read surface is exactly this fixed map. The
 * static-grep test in
 * tests/integration/ai-assistant-no-db-imports.test.ts proves
 * retrievers.ts does not import drizzle-orm, @/db, @/lib/db, or
 * @/modules/star/schema. Reads go through the existing queries.ts
 * surfaces.
 *
 * Each retriever has a Zod input schema that uses .strict(), so the
 * model cannot smuggle extra fields. The orgId field is intentionally
 * absent from every retriever input. RLS uses the layout-bound
 * app.current_org setting, never a model argument. Each retriever
 * has a typed handler that calls the underlying queries.ts function.
 *
 * The combined map ASSISTANT_RETRIEVERS is the single grep-able
 * surface. Adding a retriever in V2 requires adding a new entry
 * here AND a Zod schema; there is no way to add a retriever without
 * showing up in this file.
 */

// ─── findContactsByName ────────────────────────────────────────────────

export const findContactsByNameInput = z
  .object({
    q: z.string().min(1).max(120),
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict()

export async function findContactsByName(input: z.infer<typeof findContactsByNameInput>) {
  const args = findContactsByNameInput.parse(input)
  return searchContactsByName(args.q, args.limit)
}

// ─── getContactById ────────────────────────────────────────────────────

export const getContactByIdInput = z.object({ id: z.string().min(1) }).strict()

export async function getContactById(input: z.infer<typeof getContactByIdInput>) {
  const { id } = getContactByIdInput.parse(input)
  return getContactForOrg(id)
}

// ─── listContactsForCompany ────────────────────────────────────────────

export const listContactsForCompanyInput = z.object({ companyId: z.string().min(1) }).strict()

export async function listContactsForCompany(input: z.infer<typeof listContactsForCompanyInput>) {
  const { companyId } = listContactsForCompanyInput.parse(input)
  return listContactsByCompany(companyId)
}

// ─── findProjectsByName ────────────────────────────────────────────────
// projects/queries.ts has no search-by-name helper; we wrap
// listProjectsForOrg and filter in-memory. RLS still applies because
// listProjectsForOrg uses withOrgContext — the AI sees only the
// in-scope projects to start with. The in-memory filter is
// presentation logic, not a privileged DB access.

export const findProjectsByNameInput = z
  .object({
    q: z.string().min(1).max(120),
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict()

export async function findProjectsByName(input: z.infer<typeof findProjectsByNameInput>) {
  const args = findProjectsByNameInput.parse(input)
  // listProjectsForOrg doesn't accept a limit option in V1; we pull the
  // org-scoped set and filter+truncate here. This is presentation logic,
  // not a privileged DB path.
  const rows = await listProjectsForOrg()
  const needle = args.q.toLowerCase()
  return rows.filter((r) => r.name.toLowerCase().includes(needle)).slice(0, args.limit)
}

// ─── getProjectById ────────────────────────────────────────────────────

export const getProjectByIdInput = z.object({ id: z.string().min(1) }).strict()

export async function getProjectById(input: z.infer<typeof getProjectByIdInput>) {
  const { id } = getProjectByIdInput.parse(input)
  return getProjectForOrg(id)
}

// ─── listProjectsByLifecycleStatus ─────────────────────────────────────

export const listProjectsByLifecycleStatusInput = z
  .object({
    lifecycleStatus: z.string().min(1).max(40),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict()

export async function listProjectsByLifecycleStatus(
  input: z.infer<typeof listProjectsByLifecycleStatusInput>,
) {
  const args = listProjectsByLifecycleStatusInput.parse(input)
  const rows = await listProjectsByLifecycle(args.lifecycleStatus)
  return rows.slice(0, args.limit)
}

// ─── THE ALLOWLIST ─────────────────────────────────────────────────────

/**
 * The map the AI model is permitted to invoke. Validator at
 * `validate.ts` asserts the model's `retrieve.name` is a key of this
 * object. Cannot be extended at runtime; cannot be bypassed by the
 * model.
 */
export const ASSISTANT_RETRIEVERS = {
  findContactsByName,
  getContactById,
  listContactsForCompany,
  findProjectsByName,
  getProjectById,
  listProjectsByLifecycleStatus,
} as const

export const ASSISTANT_RETRIEVER_INPUT_SCHEMAS = {
  findContactsByName: findContactsByNameInput,
  getContactById: getContactByIdInput,
  listContactsForCompany: listContactsForCompanyInput,
  findProjectsByName: findProjectsByNameInput,
  getProjectById: getProjectByIdInput,
  listProjectsByLifecycleStatus: listProjectsByLifecycleStatusInput,
} as const

export type AssistantRetrieverName = keyof typeof ASSISTANT_RETRIEVERS
export const ASSISTANT_RETRIEVER_NAMES = Object.keys(
  ASSISTANT_RETRIEVERS,
) as AssistantRetrieverName[]
