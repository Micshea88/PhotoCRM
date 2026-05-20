/**
 * RLS read-boundary proofs for the AI Assistant (Module 17a).
 *
 * STRATEGY: the retrievers are thin wrappers around existing
 * queries.ts functions that use `withOrgContext`. The RLS read
 * boundary (assignment-scoped overlay on contacts/projects/tasks) is
 * already exhaustively proven in
 * `tests/integration/assignment-scoped-rls.test.ts` (Module 14a) —
 * 22 cases across read, write, cross-org attack, and full-visibility
 * control roles. The AI assistant's retrievers inherit that proof
 * by construction because:
 *
 *   1. They CANNOT construct ad-hoc Drizzle queries — proven by
 *      `ai-assistant-no-db-imports.test.ts`. The only read paths
 *      available to the AI module are the queries.ts surfaces of
 *      contacts and projects, which use `withOrgContext` and thus
 *      run under the layout-bound RLS context.
 *
 *   2. The retriever input schemas use `.strict()` and do NOT
 *      declare an `orgId` field. The AI cannot smuggle an `orgId`
 *      override; RLS uses `current_setting('app.current_org')`
 *      which is set by the request's layout, never by a model
 *      argument.
 *
 * The unit-level proofs below assert (2) directly. The integration-
 * level proof of (1) lives in the no-db-imports test. The
 * end-to-end RLS proof IS the existing assignment-scoped-rls
 * suite — re-running the retriever wrappers under withTestDb
 * fights the connection model (queries.ts opens a separate pool
 * connection invisible to the test's BEGIN/ROLLBACK envelope), so
 * we anchor the proof structurally rather than by direct
 * end-to-end run.
 */
import { describe, it, expect } from "vitest"
import {
  findContactsByNameInput,
  getContactByIdInput,
  findProjectsByNameInput,
  getProjectByIdInput,
  listContactsForCompanyInput,
  listProjectsByLifecycleStatusInput,
  ASSISTANT_RETRIEVER_NAMES,
} from "@/modules/ai-assistant/retrievers"

describe("AI Assistant — retriever input schemas reject orgId override", () => {
  // PROOF that the AI cannot override the active-org via a model
  // argument. Every retriever's Zod input is `.strict()` and has no
  // `orgId` field — RLS uses app.current_org set by the layout.
  //
  // If a future contributor relaxes any of these schemas to .passthrough()
  // or adds an orgId field, these tests fail loudly.

  it("findContactsByNameInput is strict — rejects orgId", () => {
    expect(findContactsByNameInput.safeParse({ q: "x", orgId: "another_org" }).success).toBe(false)
  })

  it("getContactByIdInput is strict — rejects orgId", () => {
    expect(getContactByIdInput.safeParse({ id: "x", orgId: "another_org" }).success).toBe(false)
  })

  it("listContactsForCompanyInput is strict — rejects orgId", () => {
    expect(
      listContactsForCompanyInput.safeParse({ companyId: "x", orgId: "another_org" }).success,
    ).toBe(false)
  })

  it("findProjectsByNameInput is strict — rejects orgId", () => {
    expect(findProjectsByNameInput.safeParse({ q: "x", orgId: "another_org" }).success).toBe(false)
  })

  it("getProjectByIdInput is strict — rejects orgId", () => {
    expect(getProjectByIdInput.safeParse({ id: "x", orgId: "x" }).success).toBe(false)
  })

  it("listProjectsByLifecycleStatusInput is strict — rejects orgId", () => {
    expect(
      listProjectsByLifecycleStatusInput.safeParse({
        lifecycleStatus: "Booked",
        orgId: "x",
      }).success,
    ).toBe(false)
  })
})

describe("AI Assistant — retriever allowlist is the only read surface", () => {
  // PROOF that the retriever name set is closed. The validation gate
  // in validate.ts only accepts names in this list; the AI cannot
  // invoke functions outside this map.
  it("ASSISTANT_RETRIEVER_NAMES matches the V1 catalog exactly", () => {
    expect(ASSISTANT_RETRIEVER_NAMES.sort()).toEqual(
      [
        "findContactsByName",
        "getContactById",
        "listContactsForCompany",
        "findProjectsByName",
        "getProjectById",
        "listProjectsByLifecycleStatus",
      ].sort(),
    )
  })
})

describe("AI Assistant — model output validation rejects out-of-catalog retriever names", () => {
  // The end-to-end proof: a model output trying to call an invented
  // retriever fails the validation gate. Combined with the
  // ASSISTANT_RETRIEVER_NAMES enum, the AI is structurally bounded.
  it("validateAssistantOutput rejects retrieve with name='rawSqlExec'", async () => {
    const { validateAssistantOutput } = await import("@/modules/ai-assistant/validate")
    const result = validateAssistantOutput({
      kind: "retrieve",
      name: "rawSqlExec",
      args: { sql: "DELETE FROM contacts" },
    })
    expect(result.kind).toBe("rejected")
  })

  it("validateAssistantOutput rejects retrieve with malformed args", async () => {
    const { validateAssistantOutput } = await import("@/modules/ai-assistant/validate")
    const result = validateAssistantOutput({
      kind: "retrieve",
      name: "findContactsByName",
      // Missing required `q`; has extra `orgId` (strict rejects)
      args: { orgId: "other_org" },
    })
    expect(result.kind).toBe("rejected")
  })

  it("validateAssistantOutput rejects write_proposal with missing summaryForUser (17b — .strict)", async () => {
    const { validateAssistantOutput } = await import("@/modules/ai-assistant/validate")
    const result = validateAssistantOutput({
      kind: "write_proposal",
      action: "updateContact",
      input: { id: "x", primaryPhone: "555-0000" },
      // missing required summaryForUser
    })
    // 17b's write_proposal variant requires summaryForUser. .strict()
    // means the discriminated union member's parse fails → rejected.
    expect(result.kind).toBe("rejected")
  })
})
