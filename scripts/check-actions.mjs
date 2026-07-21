#!/usr/bin/env node
/**
 * Static check over every server action in `src/modules/.../actions.ts`. Two
 * guarantees, both enforcement the README/AGENTS.md promised that the
 * safe-action factory does NOT give on its own:
 *
 *   1. INPUT VALIDATION (AGENTS.md hard rule #3) — every action chain includes
 *      `.inputSchema(...)`. next-safe-action makes it opt-in; skip it once and
 *      the action accepts any shape from the client.
 *
 *   2. AUDIT (AGENTS.md hard rule #5 / backend policy 9) — every state-changing
 *      action calls `audit()`. `actions.ts` files hold WRITES by architecture
 *      (reads live in `queries.ts`), so the default is: an action must audit.
 *      The rare legitimate exception (a read-only action that structurally lives
 *      in actions.ts, or one that delegates auditing to a helper) is declared in
 *      `AUDIT_EXEMPT` below WITH A REASON — a single reviewable registry, not a
 *      scatter of inline opt-outs. A deliberately-unaudited state change (e.g.
 *      per-user UX prefs) is also listed here so the omission is a documented
 *      decision, not a silent gap.
 *
 * Parsing: each file is split into top-level `export` segments (the codebase is
 * `semi: false`, so statement-boundary heuristics don't work — one export = one
 * action). A segment containing `.action(` is an action; we assert both rules on
 * it. Failure exits 1 with the offending file + action name.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOTS = ["src/modules"]

// Whole files to skip (rare — a deliberate reason an action chain shouldn't go
// through inputSchema). Keep empty unless truly justified.
const ALLOWLIST_FILES = new Set([])

/**
 * Actions that legitimately do NOT call `audit()`, keyed by their
 * `metadata.actionName`, each with a reason. Three kinds:
 *   - READ-ONLY: no persistent state change (returns data / signs a token).
 *   - DELEGATES: audits inside a helper/engine the action calls.
 *   - DELIBERATE: a state change intentionally not audited (documented).
 * Adding an entry is a reviewable decision; a stale entry (no longer matching an
 * unaudited action) is reported as a warning so the registry can't silently rot.
 */
const AUDIT_EXEMPT = {
  // — READ-ONLY —
  "contacts.import.preview": "read-only — dedupe/preview SELECTs, no writes",
  "email_connections.begin_connect": "read-only — signs OAuth state + sets CSRF cookies, no DB persist",
  "files.list_attachable": "read-only — SELECT of attachable files",
  "files.poll_scan_state": "read-only — SELECT of scan status",
  "files.resolve_uploaded": "read-only — SELECT by blob url",
  "files.get_sharing": "read-only — SELECT links + events for display",
  "telephony.lookup_contact_by_phone": "read-only — caller-ID contact SELECT",
  // — DELEGATES (helper audits internally) —
  "contacts.merged": "audited by executeContactMerge (merge-engine.ts)",
  "companies.merged": "audited by executeCompanyMerge (merge-engine.ts)",
  "telephony.disconnect": "audited by disconnectTelephonyImpl (disconnect.ts)",
  "superadmin.password_reset": "audited by auditRecovery (superadmin/actions.ts, target-org-scoped)",
  "superadmin.revoke_sessions": "audited by auditRecovery (superadmin/actions.ts, target-org-scoped)",
  "superadmin.resend_verification":
    "audited by auditRecovery (superadmin/actions.ts, target-org-scoped)",
  // — DELIBERATE non-audit (documented deviation) —
  "rc_sync.enqueue_call": "operational queue insert (background_jobs), not a user-facing resource",
  "saved_views.prefs.update": "per-user UX state (user_object_view_prefs), not org-accountability data",
  "saved_views.pin": "per-user UX state — pinned tabs, not org-accountability data",
  "saved_views.unpin": "per-user UX state — pinned tabs, not org-accountability data",
  "saved_views.set_default": "per-user UX state — default view, not org-accountability data",
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) yield* walk(full)
    else if (full.endsWith("actions.ts")) yield full
  }
}

function actionNameOf(segment) {
  const m = segment.match(/actionName:\s*["'`]([^"'`]+)["'`]/)
  if (m) return m[1]
  const c = segment.match(/export\s+(?:const|async function|function)\s+(\w+)/)
  return c ? c[1] : "<unnamed>"
}

/** Line of the first `.action(` in `segment`, expressed in the whole-file. */
function lineOf(text, segment) {
  const at = text.indexOf(segment)
  const rel = segment.search(/\.action\s*\(/)
  const abs = at >= 0 && rel >= 0 ? at + rel : at
  return text.slice(0, abs < 0 ? 0 : abs).split("\n").length
}

/**
 * Parse one `actions.ts` file's text into per-action facts. Splitting on
 * top-level `export` (the codebase is `semi: false`) isolates each action so the
 * checks are per-action, not file-wide — a second action can't pass on the
 * FIRST action's `.inputSchema`/`audit`. Exported for unit testing (the CLI is
 * thin glue over this).
 */
export function analyzeActionsFile(text) {
  const out = []
  for (const segment of text.split(/\n(?=export\b)/)) {
    if (!/\.action\s*\(/.test(segment)) continue
    out.push({
      name: actionNameOf(segment),
      hasInput: /\.inputSchema\s*\(/.test(segment),
      hasAudit: /\baudit\s*\(/.test(segment),
      line: lineOf(text, segment),
    })
  }
  return out
}

export { AUDIT_EXEMPT }

/** Walk the roots and build the offender lists. Pure over the filesystem so a
 *  test can point it at a fixture root. */
export function scan(roots = ROOTS, exempt = AUDIT_EXEMPT) {
  const missingInput = []
  const missingAudit = []
  const usedExemptions = new Set()

  for (const root of roots) {
    try {
      statSync(root)
    } catch {
      continue
    }
    for (const file of walk(root)) {
      if (ALLOWLIST_FILES.has(file)) continue
      const text = readFileSync(file, "utf8")
      for (const a of analyzeActionsFile(text)) {
        if (!a.hasInput) missingInput.push({ file, name: a.name, line: a.line })
        const reason = exempt[a.name]
        if (reason) usedExemptions.add(a.name)
        if (!a.hasAudit && !reason) missingAudit.push({ file, name: a.name, line: a.line })
      }
    }
  }

  const staleExemptions = Object.keys(exempt).filter((k) => !usedExemptions.has(k))
  return { missingInput, missingAudit, staleExemptions }
}

// ── CLI ── (guarded so importing this module for tests has no side effects)
const invokedDirectly =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`

if (invokedDirectly) {
  const { missingInput, missingAudit, staleExemptions } = scan()
  let failed = false

  if (missingInput.length > 0) {
    failed = true
    console.error("\n[check-actions] Server actions missing `.inputSchema(...)`:\n")
    for (const o of missingInput) console.error(`  ${o.file}:${o.line}  (${o.name})`)
    console.error(
      "\nEvery server action MUST validate its input. Add `.inputSchema(zodSchema)` to the chain.",
    )
    console.error("See src/modules/items/actions.ts for the canonical pattern.\n")
  }

  if (missingAudit.length > 0) {
    failed = true
    console.error("\n[check-actions] State-changing server actions missing `audit()`:\n")
    for (const o of missingAudit) console.error(`  ${o.file}:${o.line}  (${o.name})`)
    console.error("\nEvery state-changing action MUST call audit() (AGENTS.md rule #5 / policy 9).")
    console.error(
      "If this action is genuinely read-only or delegates auditing to a helper, add it to",
    )
    console.error("AUDIT_EXEMPT in scripts/check-actions.mjs WITH A REASON.\n")
  }

  // Stale-registry guard: an exemption that no longer matches an unaudited action
  // (renamed, removed, or since given a real audit() call) is dead weight — surface
  // it so the registry can't rot the way hand-written lists do (policy 4 lesson).
  if (staleExemptions.length > 0) {
    console.warn(
      "\n[check-actions] WARNING — stale AUDIT_EXEMPT entries (no matching unaudited action):",
    )
    for (const k of staleExemptions) console.warn(`  ${k}`)
    console.warn("Remove them from scripts/check-actions.mjs.\n")
  }

  if (failed) process.exit(1)

  console.log(
    `[check-actions] all server actions validate input ✓  and audit (or are exempt) ✓  ` +
      `(${Object.keys(AUDIT_EXEMPT).length} documented audit exemptions)`,
  )
}
