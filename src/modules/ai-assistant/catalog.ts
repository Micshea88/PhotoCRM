import { ASSISTANT_RETRIEVER_NAMES } from "./retrievers"
import { ROUTE_CATALOG } from "./route-catalog"

/**
 * The combined catalog presented to the model. Derived from
 * `retrievers.ts` + `route-catalog.ts` at module load — single source
 * of truth, no separate maintenance.
 *
 * Module 17a: read + navigate capabilities only. No write surface.
 * The catalog's structure is what the system prompt enumerates so the
 * model knows the bounded universe.
 */

interface CatalogRetriever {
  name: string
  description: string
}

const RETRIEVER_DESCRIPTIONS: Record<string, string> = {
  findContactsByName:
    "Search contacts by name (first or last). args: { q: string, limit?: number (≤50) }",
  getContactById: "Fetch one contact by id. args: { id: string }",
  listContactsForCompany: "List contacts associated with a company. args: { companyId: string }",
  findProjectsByName:
    "Search events (projects) by name (case-insensitive substring). args: { q: string, limit?: number (≤50) }",
  getProjectById: "Fetch one event (project) by id. args: { id: string }",
  listProjectsByLifecycleStatus:
    "List events by lifecycle status (Inquiry / Booked / Active / Complete / Cancelled / Lost). args: { lifecycleStatus: string, limit?: number (≤100) }",
}

export interface PromptCatalog {
  retrievers: CatalogRetriever[]
  routes: { id: string; title: string; description: string }[]
}

export function buildCatalogForPrompt(): PromptCatalog {
  return {
    retrievers: ASSISTANT_RETRIEVER_NAMES.map((name) => ({
      name,
      description: RETRIEVER_DESCRIPTIONS[name] ?? name,
    })),
    routes: ROUTE_CATALOG.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
    })),
  }
}
