/**
 * The static action guard (`scripts/check-actions.mjs`) — asserts it actually
 * FLAGS a state-changing action missing `audit()` (and a chain missing
 * `.inputSchema`), per-action, and that the AUDIT_EXEMPT registry suppresses a
 * documented exemption while a stale exemption is surfaced. Tests the observable
 * RESULT of the detector, not that it merely runs (LAW 7).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// @ts-expect-error — plain .mjs build script, no type declarations
import * as checkActionsModule from "../../scripts/check-actions.mjs"

interface ActionFact {
  name: string
  hasInput: boolean
  hasAudit: boolean
  line: number
}
interface Offender {
  file: string
  name: string
  line: number
}
interface ScanResult {
  missingInput: Offender[]
  missingAudit: Offender[]
  staleExemptions: string[]
}
const { analyzeActionsFile, scan } = checkActionsModule as unknown as {
  analyzeActionsFile: (text: string) => ActionFact[]
  scan: (roots: string[], exempt: Record<string, string>) => ScanResult
}

/** Two audited + one unaudited + one no-inputSchema action, one file. */
const SOURCE = `"use server"
import { orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"

export const goodAction = orgAction
  .metadata({ actionName: "faux.good" })
  .inputSchema(schema)
  .action(async ({ ctx }) => {
    await ctx.db.insert(t).values({})
    await audit({ db: ctx.db }, "faux.good", {})
    return {}
  })

export const gapAction = orgAction
  .metadata({ actionName: "faux.gap" })
  .inputSchema(schema)
  .action(async ({ ctx }) => {
    await ctx.db.update(t).set({ x: 1 })
    return {}
  })

export const noInputAction = orgAction
  .metadata({ actionName: "faux.noinput" })
  .action(async ({ ctx }) => {
    await audit({ db: ctx.db }, "faux.noinput", {})
    return {}
  })
`

describe("check-actions: analyzeActionsFile", () => {
  it("classifies each action independently — a later action can't ride the first's audit/inputSchema", () => {
    const facts = analyzeActionsFile(SOURCE)
    expect(facts.map((f) => f.name)).toEqual(["faux.good", "faux.gap", "faux.noinput"])
    expect(facts.find((f) => f.name === "faux.good")).toMatchObject({
      hasInput: true,
      hasAudit: true,
    })
    // The gap: mutates, no audit — MUST be detected even though a sibling audits.
    expect(facts.find((f) => f.name === "faux.gap")).toMatchObject({
      hasInput: true,
      hasAudit: false,
    })
    expect(facts.find((f) => f.name === "faux.noinput")).toMatchObject({
      hasInput: false,
      hasAudit: true,
    })
  })
})

describe("check-actions: scan over a fixture root", () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "check-actions-"))
    mkdirSync(join(dir, "faux"), { recursive: true })
    writeFileSync(join(dir, "faux", "actions.ts"), SOURCE)
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("flags the unaudited action and the missing-inputSchema action", () => {
    const res = scan([dir], {})
    expect(res.missingAudit.map((o) => o.name)).toContain("faux.gap")
    expect(res.missingInput.map((o) => o.name)).toContain("faux.noinput")
  })

  it("a documented AUDIT_EXEMPT entry suppresses the flag", () => {
    const res = scan([dir], { "faux.gap": "test — deliberately exempt" })
    expect(res.missingAudit.map((o) => o.name)).not.toContain("faux.gap")
  })

  it("surfaces a stale exemption that matches no unaudited action", () => {
    const res = scan([dir], { "faux.gap": "used", "faux.does_not_exist": "stale" })
    expect(res.staleExemptions).toContain("faux.does_not_exist")
    expect(res.staleExemptions).not.toContain("faux.gap")
  })
})
