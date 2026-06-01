"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchableSelect, type SearchableSelectItem } from "@/components/ui/searchable-select"
import { previewContactsImport, runContactsImport } from "../import-actions"
import { scanColumnsWithAi } from "../import-ai"
import type { ColumnScanSuggestion } from "../import-ai-parser"
import {
  autoMapHeaders,
  buildCleanRow,
  buildCustomFieldMapping,
  buildErrorsCsv,
  coerceImportRawToTyped,
  CSV_MAX_ROWS,
  detectFieldType,
  detectionAgreesWithMapping,
  FIELD_LABELS,
  findCsvInternalDuplicates,
  firstNonEmptySample,
  IMPORTABLE_FIELDS,
  isCustomFieldMapping,
  parseCsv,
  type CleanRow,
  type DetectedType,
  type ImportableField,
  type ImportCustomFieldDef,
  type MappingChoice,
  type ParsedCsv,
} from "../import-spec"
import { formatCustomFieldCell } from "@/modules/custom-fields/ui/column-helpers"

type Step = "upload" | "map" | "preview" | "done"
const STEP_BY_NUM: Record<1 | 2 | 3 | 4, Step> = {
  1: "upload",
  2: "map",
  3: "preview",
  4: "done",
}
const NUM_BY_STEP: Record<Step, 1 | 2 | 3 | 4> = {
  upload: 1,
  map: 2,
  preview: 3,
  done: 4,
}

function parseStepParam(raw: string | null): 1 | 2 | 3 | 4 {
  const n = raw ? parseInt(raw, 10) : 1
  if (n === 2 || n === 3 || n === 4) return n
  return 1
}
type OwnerMode = "self" | "specific" | "from_csv"
// Push 2c.3 — removed the "If a row errors" radio. Behavior is now
// always skip-and-keep-going. The "Stop on first error" option was
// unnecessary friction (HubSpot doesn't expose it either) and made
// the error UX harder to reason about.

function stripUndefined(values: Partial<Record<ImportableField, string>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === "string") out[k] = v
  }
  return out
}

interface OrgMember {
  id: string
  name: string
  email: string
}

// Push 2c.3 — exported so the wizard's PreviewStep can be unit-tested
// against fixture data. Internal to the import flow otherwise.
export interface PreviewRow {
  rowIndex: number
  matchedContactId: string | null
  matchedContactName: string | null
  action: "create" | "update" | "skip"
  duplicateOfRow: number | null
}

interface ImportResult {
  successCount: number
  errorCount: number
  errorRows: { rowIndex: number; error: string; raw: string[] }[]
  /** P3 (C5) — broken out from successCount so the post-import UPLOAD
   *  COMPLETE screen can show "X created · Y updated · Z skipped". */
  createdCount: number
  updatedCount: number
  skippedCount: number
  /** P3 (C5) — rows the user explicitly chose to skip, surfaced as a
   *  list under the summary so they can see WHAT was skipped (most
   *  often a matched-contact row defaulted to skip per memory #24). */
  skippedRows: {
    rowIndex: number
    name: string
    email: string | null
    matchedContactId: string | null
    reason: string
  }[]
}

/**
 * Push 2c / 2c.1 — 4-step contacts CSV import wizard.
 *
 *   1. Upload — file picker; parse via the inline RFC-4180 parser in
 *      import-spec.ts. Hard cap 10,000 rows.
 *   2. Map — smart-match auto-mapping (alias table); user can override.
 *      Each row shows a sample value + amber warning if the detected
 *      shape disagrees with the chosen mapping. Preview button enables
 *      when fullName | lastName | primaryEmail is mapped.
 *   3. Preview & dedupe — server-side dedupe by email (primary) /
 *      phone (fallback). Bulk owner mode (Me / Specific / From CSV),
 *      bulk tag picker, error-handling toggle, validation-summary
 *      banner. Per-row override dropdown + CSV-internal duplicate
 *      flags.
 *   4. Importing → Done — runs the server import action; shows a
 *      summary + "Download errors as CSV" + "stopped early" banner if
 *      errorMode=stop fired.
 *
 * All state is client-side until step 3/4's server roundtrips.
 */
export function ContactsImportWizard({
  currentUserId,
  orgMembers,
  existingTags,
  customFieldDefs,
}: {
  currentUserId: string
  orgMembers: OrgMember[]
  existingTags: string[]
  /** Push 4 (A4) — non-archived contact custom field defs for the
   * mapping dropdown's Custom fields optgroup. Empty array OK. */
  customFieldDefs: ImportCustomFieldDef[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  // Push 2c.2.2 — wizard step lives in ?step=1..4 so browser Back walks
  // backwards through the wizard instead of exiting it. React state
  // still owns the per-step DATA (uploaded CSV rows, mappings, preview
  // rows) — that state is lost on full-page refresh, in which case
  // an effect below redirects forward steps back to step=1.
  const stepNum = parseStepParam(searchParams.get("step"))
  const step: Step = STEP_BY_NUM[stepNum]
  function goToStep(target: Step) {
    const next = NUM_BY_STEP[target]
    if (next === stepNum) return
    router.push(`${pathname}?step=${String(next)}`)
  }

  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [mapping, setMapping] = useState<(MappingChoice | null)[]>([])
  const [cleanRows, setCleanRows] = useState<CleanRow[]>([])
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [orgMemberEmails, setOrgMemberEmails] = useState<string[]>([])
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // ─── CSV V2 — AI column-scan state ──────────────────────────────────
  // Cached on the import session: scanColumnsWithAi is called ONCE on
  // entry to step=map; result lives here so re-renders don't re-call.
  // Survives Back/Forward (state is in React); lost on full reload
  // along with the parsed CSV itself (the upload-step guard redirects
  // to step=1 anyway when parsed is null).
  const [aiSuggestions, setAiSuggestions] = useState<ColumnScanSuggestion[] | null>(null)
  const [aiState, setAiState] = useState<"idle" | "loading" | "done" | "failed">("idle")
  const [aiConfirmed, setAiConfirmed] = useState(false)
  // Set of column indices the user has explicitly changed in the Map
  // step. Pills hide for these rows; the "Confirm all" affordance also
  // skips them. Reset when the user uploads a new CSV.
  const [userTouchedColumns, setUserTouchedColumns] = useState<Set<number>>(new Set())
  // Set of column indices where the user picked "Create new custom
  // field" but hasn't created it yet. Stored separately from mapping
  // (mapping[i] stays null) so the import action contract is unchanged
  // until the inline-create-field commit wires it through.
  const [createNewIntent, setCreateNewIntent] = useState<Set<number>>(new Set())

  // Preview-step bulk settings
  const [ownerMode, setOwnerMode] = useState<OwnerMode>("self")
  const [specificOwnerId, setSpecificOwnerId] = useState<string>(currentUserId)
  const [bulkTags, setBulkTags] = useState<string[]>([])

  // Push 2c.2.2 — guard against ?step=2|3|4 landings (refresh, direct
  // URL share) where per-step React data is missing. Redirect to
  // step=1 with reason=state_lost so the user sees a notice
  // explaining why they bounced back to Upload. The notice is
  // surfaced via URL (not React state) so the effect can stay
  // setState-free per the strict lint config.
  useEffect(() => {
    if (step === "upload") return
    if (step === "map" && !parsed) {
      router.replace(`${pathname}?step=1&reason=state_lost`)
      return
    }
    if (step === "preview" && previewRows.length === 0) {
      router.replace(`${pathname}?step=${parsed ? "2" : "1"}&reason=state_lost`)
      return
    }
    if (step === "done" && !importResult) {
      router.replace(`${pathname}?step=1&reason=state_lost`)
    }
  }, [step, parsed, previewRows.length, importResult, pathname, router])
  const stateLost = searchParams.get("reason") === "state_lost"

  // Per-column detected types — memoized off parsed rows for the
  // mapping step warnings + auto-suggestion checkmarks.
  const detectedTypes = useMemo<DetectedType[]>(() => {
    if (!parsed) return []
    return parsed.headers.map((_, colIdx) => {
      const samples = parsed.rows.slice(0, 50).map((r) => r[colIdx] ?? "")
      return detectFieldType(samples)
    })
  }, [parsed])

  const sampleValues = useMemo<string[]>(() => {
    if (!parsed) return []
    return parsed.headers.map((_, colIdx) => firstNonEmptySample(parsed.rows, colIdx))
  }, [parsed])

  // ─── Step 1: upload ───────────────────────────────────────────────────
  // V2: file pick parses the CSV but does NOT auto-advance — user
  // confirms via the explicit "Next: Map columns →" button so the
  // Haiku column-scan timing lines up cleanly with the Map step entry.
  async function onFileChange(file: File) {
    setError(null)
    setBusy(true)
    try {
      const text = await file.text()
      const next = parseCsv(text)
      if (next.headers.length === 0) {
        setError("Couldn't find any columns in this CSV. Add a header row and try again.")
        return
      }
      if (next.rows.length > CSV_MAX_ROWS) {
        setError(
          `This CSV has ${String(next.rows.length)} rows — the maximum is ${String(CSV_MAX_ROWS)}. Split it into batches and import each one.`,
        )
        return
      }
      if (next.rows.length === 0) {
        setError("This CSV has a header row but no data rows.")
        return
      }
      setParsed(next)
      // V2: alias-based defaults applied INSTANTLY for instant feedback;
      // AI scan kicks in on Map-step entry and updates only the columns
      // the user hasn't touched.
      setMapping(autoMapHeaders(next.headers, customFieldDefs))
      // Reset AI state for the new upload.
      setAiSuggestions(null)
      setAiState("idle")
      setAiConfirmed(false)
      setUserTouchedColumns(new Set())
      setCreateNewIntent(new Set())
    } catch {
      setError(
        "Couldn't parse this CSV — re-export from your editor as standard UTF-8 CSV and try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  /**
   * CSV V2 — fire the AI column scan and advance to the Map step in
   * one user gesture. Called from the Upload step's "Next: Map
   * columns →" button. Putting the trigger in the handler (not a
   * reactive useEffect) keeps the one-shot semantics explicit and
   * avoids the react-hooks/set-state-in-effect lint trap (any
   * setState in an effect body would flag, even after await).
   *
   * The action is RLS-safe (orgAction wraps SET LOCAL ROLE) and never
   * throws — failure modes (no API key, malformed JSON, network
   * error) return ok=false + an all-skip suggestion array, and the
   * wizard falls through to the alias-based defaults already in
   * `mapping`.
   */
  function continueToMap() {
    if (!parsed) return
    setError(null)
    goToStep("map")
    if (aiState !== "idle") return
    setAiState("loading")
    void runAiScan()
  }

  async function runAiScan() {
    if (!parsed) return
    const sampleRows = parsed.rows
      .slice(0, 8)
      .map((row) => parsed.headers.map((_, c) => row[c] ?? ""))
    const result = await scanColumnsWithAi({
      headers: parsed.headers,
      sampleRows,
    })
    if (result.serverError || !result.data) {
      setAiState("failed")
      return
    }
    const data = result.data
    setAiSuggestions(data.suggestions)
    setAiState(data.ok ? "done" : "failed")
    // Snapshot the user-touched set ONCE so the suggestions only
    // apply to columns the user hasn't already changed during the
    // (brief) loading window.
    const touchedAtScan = userTouchedColumns
    setMapping((prev) => {
      const next = [...prev]
      data.suggestions.forEach((s, i) => {
        if (touchedAtScan.has(i)) return
        if (s.target === "skip") {
          // Leave the alias default in place — a "skip" from AI is
          // "we don't have a confident pick", not "ignore this
          // column"; the alias may still be right.
          return
        }
        if (s.target === "create_new") {
          // Inline-create lands in a follow-up commit. For now the
          // wizard records the intent + clears the mapping.
          next[i] = null
          return
        }
        // cf:<id> or an IMPORTABLE_FIELDS id — both are valid
        // MappingChoice values per the existing wizard contract.
        next[i] = s.target as MappingChoice
      })
      return next
    })
    setCreateNewIntent((prev) => {
      const next = new Set(prev)
      data.suggestions.forEach((s, i) => {
        if (touchedAtScan.has(i)) return
        if (s.target === "create_new") next.add(i)
      })
      return next
    })
  }

  function setMappingAt(i: number, choice: MappingChoice | null) {
    setMapping((prev) => {
      const next = [...prev]
      next[i] = choice
      return next
    })
    setUserTouchedColumns((prev) => {
      const n = new Set(prev)
      n.add(i)
      return n
    })
    setCreateNewIntent((prev) => {
      if (!prev.has(i)) return prev
      const n = new Set(prev)
      n.delete(i)
      return n
    })
  }

  function markCreateNewAt(i: number) {
    // Intent only — the actual definition is created in a follow-up
    // commit's inline modal. For now this clears the mapping and flags
    // the row so Next is disabled until the user resolves it.
    setMapping((prev) => {
      const next = [...prev]
      next[i] = null
      return next
    })
    setCreateNewIntent((prev) => {
      const n = new Set(prev)
      n.add(i)
      return n
    })
    setUserTouchedColumns((prev) => {
      const n = new Set(prev)
      n.add(i)
      return n
    })
  }

  function confirmAllAiSuggestions() {
    // Hides all AI pills + dismisses the banner. The mapping values are
    // already in place (applied when scan returned); this is purely a
    // visual acknowledgement.
    setAiConfirmed(true)
  }

  function clearAiSuggestions() {
    // Reverts mapping to the alias-based defaults from the original
    // upload. createNewIntent + touched set are also reset so the
    // user starts from the alias baseline.
    if (!parsed) return
    setMapping(autoMapHeaders(parsed.headers, customFieldDefs))
    setUserTouchedColumns(new Set())
    setCreateNewIntent(new Set())
    setAiConfirmed(true)
  }

  // ─── Step 2 → 3: map + run server dedupe ─────────────────────────────
  async function continueToPreview() {
    if (!parsed) return
    setError(null)
    const cleaned = parsed.rows.map((row, i) => buildCleanRow(i + 1, row, mapping, customFieldDefs))
    setCleanRows(cleaned)
    const sendable = cleaned.filter((c) => c.errors.length === 0)
    if (sendable.length === 0) {
      setError(
        "No rows are importable. Every row is missing an identifier (first name, last name, or email).",
      )
      return
    }
    setBusy(true)
    const result = await previewContactsImport({
      rows: sendable.map((c) => ({
        rowIndex: c.rowIndex,
        values: stripUndefined(c.values),
        customValues: c.customValues,
      })),
    })
    setBusy(false)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    const dupesMap = findCsvInternalDuplicates(cleaned)
    const previews: PreviewRow[] = (result.data?.rows ?? []).map((r) => {
      const dupOf = dupesMap.get(r.rowIndex) ?? null
      // P3 (C5) — Per memory #24, matched rows default to "skip" (not
      // "update"). Users explicitly opt into Update Contact per row,
      // which prevents accidental bulk overwrites from CSV re-uploads.
      // Internal CSV duplicates also default to skip (unchanged).
      let action: "create" | "update" | "skip"
      if (dupOf !== null) {
        action = "skip"
      } else if (r.matchedContactId) {
        action = "skip"
      } else {
        action = "create"
      }
      return {
        rowIndex: r.rowIndex,
        matchedContactId: r.matchedContactId,
        matchedContactName: r.matchedContactName,
        action,
        duplicateOfRow: dupOf,
      }
    })
    setPreviewRows(previews)
    setOrgMemberEmails(result.data?.orgMemberEmails ?? [])
    goToStep("preview")
  }

  // Push 2c.5 — track which rows the user has individually overridden
  // so the bulk "Set all matched / unmatched to..." controls below
  // skip them. The set lives at wizard level so it survives across
  // re-renders of the Preview step's bulk-settings panel.
  const [userTouchedRows, setUserTouchedRows] = useState<Set<number>>(new Set())

  function setRowAction(rowIndex: number, action: "create" | "update" | "skip") {
    setPreviewRows((prev) => prev.map((r) => (r.rowIndex === rowIndex ? { ...r, action } : r)))
    setUserTouchedRows((prev) => {
      const next = new Set(prev)
      next.add(rowIndex)
      return next
    })
  }

  function setAllMatchedTo(action: "create" | "update" | "skip") {
    setPreviewRows((prev) =>
      prev.map((r) => {
        if (userTouchedRows.has(r.rowIndex)) return r
        if (!r.matchedContactId) return r
        return { ...r, action }
      }),
    )
  }

  function setAllUnmatchedTo(action: "create" | "update" | "skip") {
    setPreviewRows((prev) =>
      prev.map((r) => {
        if (userTouchedRows.has(r.rowIndex)) return r
        if (r.matchedContactId) return r
        return { ...r, action }
      }),
    )
  }

  // ─── Step 4: run ─────────────────────────────────────────────────────
  // Push 2c.2.2 — `busy` shows the "Importing…" inline on the preview
  // step. The transient "importing" step that used to live in the
  // state machine was elided when steps moved to ?step=1..4 URL
  // params — keeping a transient state outside the URL would confuse
  // the back-button navigation contract.
  async function runImport() {
    setError(null)
    setBusy(true)
    const byIndex = new Map(previewRows.map((r) => [r.rowIndex, r]))
    const payload = cleanRows
      .filter((c) => c.errors.length === 0)
      .map((c) => {
        const p = byIndex.get(c.rowIndex)
        return {
          rowIndex: c.rowIndex,
          values: stripUndefined(c.values),
          customValues: c.customValues,
          action: p?.action ?? "create",
          matchedContactId: p?.matchedContactId ?? null,
        }
      })
    const result = await runContactsImport({
      rows: payload,
      ownerMode,
      ownerUserId:
        ownerMode === "specific" ? specificOwnerId : ownerMode === "self" ? currentUserId : null,
      applyTags: bulkTags.length > 0 ? bulkTags : undefined,
    })
    setBusy(false)
    if (result.serverError) {
      setError(result.serverError)
      // We're still on step=preview — no URL transition needed.
      return
    }
    const serverErrors = (result.data?.results ?? [])
      .filter((r) => !r.ok)
      .map((r) => ({
        rowIndex: r.rowIndex,
        error: r.error ?? "Unknown error",
        raw: parsed?.rows[r.rowIndex - 1] ?? [],
      }))
    const preflightErrors = cleanRows
      .filter((c) => c.errors.length > 0)
      .map((c) => ({
        rowIndex: c.rowIndex,
        error: c.errors.join("; "),
        raw: parsed?.rows[c.rowIndex - 1] ?? [],
      }))

    // P3 (C5) — break out create / update / skip counts so the UPLOAD
    // COMPLETE screen can summarize each path. The server returns per-
    // row results with an `ok` flag and (for blocked rows) a
    // `blockedByDedup` flag. Cross-reference with the user's preview
    // selections to classify accurately.
    const serverResults = result.data?.results ?? []
    const byRowIndex = new Map(serverResults.map((r) => [r.rowIndex, r]))
    const previewByIndex = new Map(previewRows.map((p) => [p.rowIndex, p]))
    const cleanRowsByIndex = new Map(cleanRows.map((c) => [c.rowIndex, c]))
    let createdCount = 0
    let updatedCount = 0
    let skippedCount = 0
    const skippedRows: ImportResult["skippedRows"] = []
    for (const c of cleanRows) {
      if (c.errors.length > 0) continue // error rows go to errorRows below
      const preview = previewByIndex.get(c.rowIndex)
      const server = byRowIndex.get(c.rowIndex)
      if (!server) continue
      const rowName =
        [c.values.firstName, c.values.lastName].filter(Boolean).join(" ").trim() || "(no name)"
      const rowEmail = c.values.primaryEmail ?? null
      if (server.ok) {
        if (preview?.action === "skip") {
          skippedCount++
          skippedRows.push({
            rowIndex: c.rowIndex,
            name: rowName,
            email: rowEmail,
            matchedContactId: preview.matchedContactId,
            reason:
              preview.duplicateOfRow !== null ? "Duplicate row in CSV" : "Matched existing contact",
          })
        } else if (preview?.action === "update") {
          updatedCount++
        } else {
          createdCount++
        }
      } else if (server.blockedByDedup) {
        // P3 (C4 + C5) — server-side dedup blocked this create. Treat
        // it as a skip in the summary so the user sees the matched id.
        skippedCount++
        skippedRows.push({
          rowIndex: c.rowIndex,
          name: rowName,
          email: rowEmail,
          matchedContactId: server.blockedByDedupMatchedId ?? null,
          reason: "Blocked by duplicate detection (already exists)",
        })
      }
    }
    void cleanRowsByIndex

    setImportResult({
      successCount: result.data?.successCount ?? 0,
      errorCount: (result.data?.errorCount ?? 0) + preflightErrors.length,
      errorRows: [...preflightErrors, ...serverErrors],
      createdCount,
      updatedCount,
      skippedCount,
      skippedRows,
    })
    goToStep("done")
  }

  function downloadErrorsCsv() {
    if (!parsed || !importResult) return
    const csv = buildErrorsCsv(parsed.headers, importResult.errorRows)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "contacts-import-errors.csv"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <Stepper current={step} />

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {stateLost && step === "upload" && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          Wizard state was lost (refresh or direct link). Re-upload the CSV to continue.
        </div>
      )}

      {step === "upload" && (
        <UploadStep
          busy={busy}
          parsed={parsed}
          onFile={(f) => {
            void onFileChange(f)
          }}
          onContinue={continueToMap}
        />
      )}

      {step === "map" && parsed && (
        <MapStep
          headers={parsed.headers}
          mapping={mapping}
          onChangeAt={setMappingAt}
          onMarkCreateNewAt={markCreateNewAt}
          rowCount={parsed.rows.length}
          sampleValues={sampleValues}
          detectedTypes={detectedTypes}
          customFieldDefs={customFieldDefs}
          aiSuggestions={aiSuggestions}
          aiState={aiState}
          aiConfirmed={aiConfirmed}
          userTouchedColumns={userTouchedColumns}
          createNewIntent={createNewIntent}
          onConfirmAllAi={confirmAllAiSuggestions}
          onClearAi={clearAiSuggestions}
          busy={busy}
          onBack={() => {
            goToStep("upload")
          }}
          onNext={() => {
            void continueToPreview()
          }}
        />
      )}

      {step === "preview" && (
        <PreviewStep
          cleanRows={cleanRows}
          previewRows={previewRows}
          orgMembers={orgMembers}
          orgMemberEmails={orgMemberEmails}
          existingTags={existingTags}
          customFieldDefs={customFieldDefs}
          ownerMode={ownerMode}
          onOwnerModeChange={setOwnerMode}
          specificOwnerId={specificOwnerId}
          onSpecificOwnerIdChange={setSpecificOwnerId}
          bulkTags={bulkTags}
          onBulkTagsChange={setBulkTags}
          ownerEmailColumnMapped={mapping.includes("ownerUserId")}
          onSetAction={setRowAction}
          onSetAllMatchedTo={setAllMatchedTo}
          onSetAllUnmatchedTo={setAllUnmatchedTo}
          busy={busy}
          onBack={() => {
            goToStep("map")
          }}
          onCancel={() => {
            startTransition(() => {
              router.push("/contacts")
            })
          }}
          onNext={() => {
            void runImport()
          }}
        />
      )}

      {step === "preview" && busy && (
        <div className="rounded-md border border-[var(--color-border)] p-3 text-center text-sm text-[var(--color-muted-foreground)]">
          Importing… don&apos;t close this tab.
        </div>
      )}

      {step === "done" && importResult && (
        <DoneStep
          result={importResult}
          onDownloadErrors={downloadErrorsCsv}
          onDone={() => {
            startTransition(() => {
              router.push("/contacts")
            })
          }}
        />
      )}
    </div>
  )
}

function Stepper({ current }: { current: Step }) {
  const labels: { step: Step; label: string }[] = [
    { step: "upload", label: "1. Upload" },
    { step: "map", label: "2. Map fields" },
    { step: "preview", label: "3. Preview & dedupe" },
    { step: "done", label: "4. Import" },
  ]
  const currentIndex = labels.findIndex((l) => l.step === current)
  return (
    <ol className="flex items-center gap-3 text-sm">
      {labels.map((l, i) => {
        const active = i === currentIndex
        const done = i < currentIndex
        return (
          <li
            key={l.step}
            className={`rounded-md px-2.5 py-1 ${
              active
                ? "bg-[var(--color-primary)]/15 font-medium text-[var(--color-primary)]"
                : done
                  ? "text-[var(--color-muted-foreground)]"
                  : "text-[var(--color-muted-foreground)]/60"
            }`}
          >
            {l.label}
          </li>
        )
      })}
    </ol>
  )
}

function UploadStep({
  busy,
  onFile,
  parsed,
  onContinue,
}: {
  busy: boolean
  onFile: (f: File) => void
  /** Set once the picked file has been parsed. Drives the summary
   *  block + enables the "Next: Map columns →" button. */
  parsed: ParsedCsv | null
  onContinue: () => void
}) {
  return (
    <div className="space-y-4 rounded-md border border-[var(--color-border)] p-6">
      <div>
        <h2 className="text-base font-medium">Upload CSV</h2>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          UTF-8 CSV with a header row. Up to {String(CSV_MAX_ROWS).toLocaleString()} rows per
          import.
        </p>
      </div>
      <Input
        type="file"
        accept=".csv,text/csv"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
        }}
      />
      {parsed && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-3 py-2 text-xs">
          <p className="font-medium">
            Parsed {String(parsed.rows.length)} data row
            {parsed.rows.length === 1 ? "" : "s"} · {String(parsed.headers.length)} column
            {parsed.headers.length === 1 ? "" : "s"}
          </p>
          <p className="mt-0.5 text-[var(--color-muted-foreground)]">
            On the next step we&apos;ll scan your columns with AI and pre-fill the field mapping.
          </p>
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={onContinue} disabled={busy || !parsed}>
          Next: Map columns →
        </Button>
      </div>
    </div>
  )
}

// ─── CSV V2 — sentinel values for the SearchableSelect ─────────────
// MappingChoice is `ImportableField | cf:${string}` — null in the
// wizard's array represents "Don't import." The dropdown surface
// needs string sentinels so SearchableSelect's value/onChange can
// distinguish, then we translate at the boundary in onChangeAt.
const SKIP_VALUE = "__skip__"
const CREATE_NEW_VALUE = "__create_new__"

const SPECIAL_OPTGROUP = "Special"
const STANDARD_OPTGROUP = "Standard fields"
const CUSTOM_OPTGROUP = "Custom fields"

function MapStep({
  headers,
  mapping,
  onChangeAt,
  onMarkCreateNewAt,
  rowCount,
  sampleValues,
  detectedTypes,
  customFieldDefs,
  aiSuggestions,
  aiState,
  aiConfirmed,
  userTouchedColumns,
  createNewIntent,
  onConfirmAllAi,
  onClearAi,
  busy,
  onBack,
  onNext,
}: {
  headers: string[]
  mapping: (MappingChoice | null)[]
  onChangeAt: (i: number, choice: MappingChoice | null) => void
  onMarkCreateNewAt: (i: number) => void
  rowCount: number
  sampleValues: string[]
  detectedTypes: DetectedType[]
  customFieldDefs: ImportCustomFieldDef[]
  aiSuggestions: ColumnScanSuggestion[] | null
  aiState: "idle" | "loading" | "done" | "failed"
  aiConfirmed: boolean
  userTouchedColumns: Set<number>
  createNewIntent: Set<number>
  onConfirmAllAi: () => void
  onClearAi: () => void
  busy: boolean
  onBack: () => void
  onNext: () => void
}) {
  const mapped = new Set(
    mapping.filter((m): m is ImportableField => typeof m === "string" && !isCustomFieldMapping(m)),
  )
  // Preview enables when at least one identifier-shaped field is
  // mapped. lastName preferred, fullName equivalent, email also works
  // (HubSpot pattern: email-only leads are common). Plus: no row can
  // be left in "Create new custom field" intent — the inline-create
  // modal commit will resolve this, but for now block Next on it.
  const unresolvedCreateNew = createNewIntent.size > 0
  const canContinue =
    !busy &&
    !unresolvedCreateNew &&
    (mapped.has("fullName") || mapped.has("lastName") || mapped.has("primaryEmail"))

  // Build the SearchableSelect item list ONCE — items are stable
  // across rows so we can reuse the same array. Order within each
  // optgroup is alphabetical by label for the standard fields (with
  // the identifier-y ones first) and CSV-order for custom fields
  // (preserves the org's intentional ordering).
  const dropdownItems: SearchableSelectItem[] = useMemo(() => {
    const items: SearchableSelectItem[] = []
    for (const f of IMPORTABLE_FIELDS) {
      items.push({ value: f, label: FIELD_LABELS[f], optgroup: STANDARD_OPTGROUP })
    }
    for (const def of customFieldDefs) {
      items.push({
        value: buildCustomFieldMapping(def.id),
        label: def.name,
        description: def.fieldType,
        optgroup: CUSTOM_OPTGROUP,
      })
    }
    // Special: Don't import + Create new custom field (last commit
    // adds the inline modal; the option is selectable now and shows
    // the in-flight intent state).
    items.push({
      value: SKIP_VALUE,
      label: "Don't import",
      optgroup: SPECIAL_OPTGROUP,
    })
    items.push({
      value: CREATE_NEW_VALUE,
      label: "+ Create new custom field",
      description: "Add a new field for this column",
      optgroup: SPECIAL_OPTGROUP,
    })
    return items
  }, [customFieldDefs])

  // Track which columns have a currently-active AI suggestion that
  // the user hasn't overridden — drives the pill render.
  function isAiSuggestedActive(i: number): boolean {
    if (aiConfirmed) return false
    if (userTouchedColumns.has(i)) return false
    if (!aiSuggestions) return false
    const s = aiSuggestions[i]
    if (!s) return false
    // Pill only on non-skip suggestions — "skip" suggestions don't
    // override the mapping, so showing an AI badge on a row whose
    // value came from the alias autoMapper would be misleading.
    if (s.target === "skip") return false
    if (s.target === "create_new") return createNewIntent.has(i)
    // For a real target, the suggestion is "active" iff it equals
    // the current mapping value (i.e., the AI pre-fill still stands).
    const current = mapping[i]
    return current !== null && current === s.target
  }

  // Count of currently-active AI suggestions for the banner copy.
  const activeAiCount = aiSuggestions
    ? aiSuggestions.reduce((n, _s, i) => (isAiSuggestedActive(i) ? n + 1 : n), 0)
    : 0

  return (
    <div className="space-y-4 rounded-md border border-[var(--color-border)] p-6">
      <div>
        <h2 className="text-base font-medium">Map columns to contact fields</h2>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {rowCount === 1 ? "1 data row found." : `${String(rowCount)} data rows found.`} Confirm or
          change the field mapping below. Each row needs at least one of <strong>Full name</strong>,{" "}
          <strong>Last name</strong>, or <strong>Primary email</strong> mapped.
        </p>
      </div>

      {/* CSV V2 — AI scan banner. Three states: loading / done / failed.
          aiConfirmed dismisses the done banner (user clicked Confirm
          all). The failed-state copy makes it clear manual mapping is
          fully supported. */}
      {aiState === "loading" && (
        <div
          className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-3 py-2 text-xs"
          data-testid="csv-v2-ai-banner-loading"
        >
          <Sparkles
            className="size-3.5 animate-pulse text-[var(--color-primary)]"
            aria-hidden="true"
          />
          <span>Scanning columns with AI…</span>
        </div>
      )}
      {aiState === "done" && !aiConfirmed && activeAiCount > 0 && (
        <div
          className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 px-3 py-2 text-xs"
          data-testid="csv-v2-ai-banner-done"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-[var(--color-primary)]" aria-hidden="true" />
            <span>
              AI suggested mappings for {String(activeAiCount)} column
              {activeAiCount === 1 ? "" : "s"}. Review and confirm, or change individually.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClearAi}
              data-testid="csv-v2-ai-clear"
            >
              Clear AI
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onConfirmAllAi}
              data-testid="csv-v2-ai-confirm-all"
            >
              Confirm all
            </Button>
          </div>
        </div>
      )}
      {aiState === "failed" && (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
          data-testid="csv-v2-ai-banner-failed"
        >
          AI mapping wasn&apos;t available for this upload — map columns manually below.
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-muted)] text-left text-xs text-[var(--color-muted-foreground)]">
            <tr>
              <th className="px-3 py-2">CSV column</th>
              <th className="px-3 py-2">Sample</th>
              <th className="px-3 py-2">Maps to</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((h, i) => {
              const chosen = mapping[i] ?? null
              const detected = detectedTypes[i] ?? null
              const intrinsic: ImportableField | null =
                chosen !== null && !isCustomFieldMapping(chosen) ? chosen : null
              const agrees = intrinsic ? detectionAgreesWithMapping(detected, intrinsic) : true
              const detectedMismatch =
                detected !== null && intrinsic !== null && !agrees ? intrinsic : null
              const showAiPill = isAiSuggestedActive(i)
              const isCreateNew = createNewIntent.has(i)

              // SearchableSelect value: null mapping → null
              // (placeholder), SKIP_VALUE when user explicitly picked
              // Don't import, CREATE_NEW_VALUE for the in-flight
              // create-field intent, otherwise the mapping value
              // (intrinsic field id or cf:<id>).
              let selectValue: string | null
              if (isCreateNew) {
                selectValue = CREATE_NEW_VALUE
              } else if (chosen === null && userTouchedColumns.has(i)) {
                selectValue = SKIP_VALUE
              } else {
                selectValue = chosen
              }

              return (
                <tr key={h + String(i)} className="border-t border-[var(--color-border)] align-top">
                  <td className="px-3 py-2 font-mono text-xs">{h}</td>
                  <td className="px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
                    {sampleValues[i] === "" ? <em>empty</em> : sampleValues[i]}
                  </td>
                  <td className="px-3 py-2">
                    <SearchableSelect
                      items={dropdownItems}
                      value={selectValue}
                      onChange={(v) => {
                        if (v === null || v === SKIP_VALUE) {
                          onChangeAt(i, null)
                          return
                        }
                        if (v === CREATE_NEW_VALUE) {
                          onMarkCreateNewAt(i)
                          return
                        }
                        onChangeAt(i, v as MappingChoice)
                      }}
                      placeholder="— Don't include in import —"
                      aria-label={`Map column ${h}`}
                      valuePrefix={
                        showAiPill ? (
                          <span
                            className="inline-flex items-center gap-0.5 rounded-sm bg-[var(--color-primary)]/15 px-1 py-0 text-[10px] font-medium tracking-wide text-[var(--color-primary)]"
                            title="AI-suggested mapping"
                            data-testid={`csv-v2-ai-pill-${String(i)}`}
                          >
                            <Sparkles className="size-2.5" aria-hidden="true" />
                            AI
                          </span>
                        ) : undefined
                      }
                    />
                    {isCreateNew && (
                      <p
                        className="mt-1 text-xs text-amber-700 dark:text-amber-300"
                        data-testid={`csv-v2-create-new-pending-${String(i)}`}
                      >
                        New custom field for this column — inline create lands in the next push.
                        Pick an existing field or &quot;Don&apos;t import&quot; to continue.
                      </p>
                    )}
                    {detectedMismatch && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        This column looks like {humanizeType(detected)} but is mapped to{" "}
                        {FIELD_LABELS[detectedMismatch]}.
                      </p>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={!canContinue}
          title={
            unresolvedCreateNew
              ? "Resolve the 'Create new custom field' selection(s) before continuing"
              : undefined
          }
        >
          {busy ? "Checking…" : "Next: Review & dedupe →"}
        </Button>
      </div>
    </div>
  )
}

function humanizeType(t: DetectedType): string {
  switch (t) {
    case "email":
      return "email addresses"
    case "phone":
      return "phone numbers"
    case "date":
      return "dates"
    case "url":
      return "URLs"
    default:
      return "values"
  }
}

export function PreviewStep({
  cleanRows,
  previewRows,
  orgMembers,
  orgMemberEmails,
  existingTags,
  customFieldDefs,
  ownerMode,
  onOwnerModeChange,
  specificOwnerId,
  onSpecificOwnerIdChange,
  bulkTags,
  onBulkTagsChange,
  ownerEmailColumnMapped,
  onSetAction,
  onSetAllMatchedTo,
  onSetAllUnmatchedTo,
  busy,
  onBack,
  onCancel,
  onNext,
}: {
  cleanRows: CleanRow[]
  previewRows: PreviewRow[]
  orgMembers: OrgMember[]
  orgMemberEmails: string[]
  existingTags: string[]
  /** Push 4 (B1 Part 0) — per-org contact custom field defs. When any
   * row's customValues references one of these, the preview surfaces
   * the coerced typed display value in its own column so users can
   * see what'll land on the contact's custom_fields jsonb before
   * clicking Import. */
  customFieldDefs: ImportCustomFieldDef[]
  ownerMode: OwnerMode
  onOwnerModeChange: (m: OwnerMode) => void
  specificOwnerId: string
  onSpecificOwnerIdChange: (id: string) => void
  bulkTags: string[]
  onBulkTagsChange: (tags: string[]) => void
  ownerEmailColumnMapped: boolean
  onSetAction: (rowIndex: number, action: "create" | "update" | "skip") => void
  /** Push 2c.5 — bulk Set-all controls. Apply to rows the user hasn't
   *  individually overridden; error rows stay locked at Skip. */
  onSetAllMatchedTo: (action: "create" | "update" | "skip") => void
  onSetAllUnmatchedTo: (action: "create" | "update" | "skip") => void
  busy: boolean
  onBack: () => void
  /** Push 2c.2.2 — exits the wizard entirely (to /contacts). Co-located
   * with Import for users expecting Cancel next to the commit button. */
  onCancel: () => void
  onNext: () => void
}) {
  // Push 4 (B1 Part 0) — surface a preview column for each custom
  // field that ANY row in this import maps a value to. Skips defs that
  // aren't referenced in the active mapping so the preview table
  // doesn't widen pointlessly when the user only mapped a couple of
  // intrinsic columns.
  const usedCustomFieldIds = new Set<string>()
  for (const row of cleanRows) {
    for (const fieldId of Object.keys(row.customValues)) usedCustomFieldIds.add(fieldId)
  }
  const previewCustomFields = customFieldDefs.filter((d) => usedCustomFieldIds.has(d.id))
  const importableRows = cleanRows.filter((c) => c.errors.length === 0)
  const erroredRows = cleanRows.filter((c) => c.errors.length > 0)
  const byPreview = new Map(previewRows.map((p) => [p.rowIndex, p]))

  const createCount = previewRows.filter((p) => p.action === "create").length
  const updateCount = previewRows.filter((p) => p.action === "update").length
  // Push 2c.3 — separated previewSkipCount (user-elected skips + CSV
  // duplicates) from erroredRows.length so the summary banner can
  // surface "skipped due to errors" as its own red-text line.
  const previewSkipCount = previewRows.filter((p) => p.action === "skip").length
  const warningCount = importableRows.filter((c) => c.warnings.length > 0).length
  const duplicateCount = previewRows.filter((p) => p.duplicateOfRow !== null).length
  const willImportCount = createCount + updateCount

  // Owner-from-csv preview: how many rows have an ownerUserId column
  // value that resolves to an org member? Computed inline (not via
  // useMemo) so the React Compiler doesn't trip over importableRows
  // being recomputed each render. The cost is trivial (<10k rows,
  // string lookups against a Set).
  const ownerEmailSet = new Set(orgMemberEmails)
  let ownerCsvResolveStats: { resolved: number; unresolved: number; missing: number } | null = null
  if (ownerMode === "from_csv") {
    let resolved = 0
    let unresolved = 0
    let missing = 0
    for (const c of importableRows) {
      const raw = (c.values.ownerUserId ?? "").trim().toLowerCase()
      if (!raw) missing++
      else if (ownerEmailSet.has(raw)) resolved++
      else unresolved++
    }
    ownerCsvResolveStats = { resolved, unresolved, missing }
  }

  return (
    <div className="space-y-4 rounded-md border border-[var(--color-border)] p-6">
      <div>
        <h2 className="text-base font-medium">Preview &amp; dedupe</h2>
      </div>

      {/* Push 2c.3 — validation summary. The skip-due-to-errors line
          stands out in destructive red so users can't miss that some
          rows won't import. Warning / duplicate lines keep amber
          (will import; just heads-up). */}
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3 text-xs">
        <p className="font-medium">Before import:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>{String(createCount)} rows will create new contacts</li>
          <li>{String(updateCount)} rows will update existing contacts</li>
          {/* Skip count here excludes error rows — they get their own
              red line below for visibility. */}
          {previewSkipCount > 0 && <li>{String(previewSkipCount)} rows will be skipped</li>}
          {warningCount > 0 && (
            <li className="text-amber-700 dark:text-amber-300">
              {String(warningCount)} rows have warnings (will import without the problem field)
            </li>
          )}
          {duplicateCount > 0 && (
            <li className="text-amber-700 dark:text-amber-300">
              {String(duplicateCount)} rows look like duplicates of earlier rows in this CSV
              (defaulted to Skip)
            </li>
          )}
          {erroredRows.length > 0 && (
            <li className="font-medium text-red-700 dark:text-red-400">
              {String(erroredRows.length)} rows will be SKIPPED due to errors — fix these in your
              CSV and re-upload to include them.
            </li>
          )}
        </ul>
      </div>

      {/* Bulk settings */}
      <div className="grid grid-cols-1 gap-3 rounded-md border border-[var(--color-border)] p-3 md:grid-cols-2">
        <fieldset className="space-y-1.5 text-sm">
          <legend className="font-medium">Owner</legend>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              checked={ownerMode === "self"}
              onChange={() => {
                onOwnerModeChange("self")
              }}
            />
            <span>Assign to me</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              checked={ownerMode === "specific"}
              onChange={() => {
                onOwnerModeChange("specific")
              }}
            />
            <span>Assign to…</span>
            <select
              value={specificOwnerId}
              disabled={ownerMode !== "specific"}
              onChange={(e) => {
                onSpecificOwnerIdChange(e.target.value)
              }}
              className="h-7 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-1 text-xs disabled:opacity-50"
            >
              {orgMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.email}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="radio"
              checked={ownerMode === "from_csv"}
              disabled={!ownerEmailColumnMapped}
              onChange={() => {
                onOwnerModeChange("from_csv")
              }}
            />
            <span>
              Use the &ldquo;Owner (by email)&rdquo; column from the CSV
              {!ownerEmailColumnMapped && (
                <span className="ml-1 text-[var(--color-muted-foreground)]">
                  (map the column first)
                </span>
              )}
              {ownerCsvResolveStats && (
                <span className="ml-1 text-[var(--color-muted-foreground)]">
                  — {String(ownerCsvResolveStats.resolved)} resolve,{" "}
                  {String(ownerCsvResolveStats.unresolved)} won&apos;t,{" "}
                  {String(ownerCsvResolveStats.missing)} empty
                </span>
              )}
            </span>
          </label>
        </fieldset>

        <fieldset className="space-y-1.5 text-sm">
          <legend className="font-medium">Tag every imported contact</legend>
          <BulkTagPicker tags={bulkTags} onChange={onBulkTagsChange} existingTags={existingTags} />
        </fieldset>
      </div>

      {/* Push 2c.5 — bulk "Set all to..." controls. Apply only to rows
          the user hasn't individually overridden via the per-row
          dropdown. Error rows (cleanRows with errors > 0) aren't in
          previewRows so they stay locked at "Skip — has errors". */}
      <SetAllRow
        label="Set all matched rows to"
        defaultAction="skip"
        allowedActions={["skip", "update"]}
        onApply={onSetAllMatchedTo}
      />
      <SetAllRow
        label="Set all unmatched rows to"
        defaultAction="create"
        allowedActions={["create", "skip"]}
        onApply={onSetAllUnmatchedTo}
      />

      {/* P3 (C5) — red text duplicate warning above the table. Per
          memory #24 + spec text verbatim. Renders only when there's
          at least one matched (DB-side) duplicate to warn about;
          internal CSV duplicates already get their own amber line in
          the summary banner above. */}
      {previewRows.some((p) => p.matchedContactId !== null) && (
        <p className="text-xs text-red-600 dark:text-red-400">
          There appear to be duplicate contacts in your CSV file that already exists as contacts.
          These entries can be used to update current contact records but are standardly set to skip
          on import. If you wish to change this status please change import entry to Update Contact
          below.
        </p>
      )}

      {/* Row preview table */}
      <div className="max-h-[440px] overflow-auto rounded-md border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--color-muted)] text-left text-xs text-[var(--color-muted-foreground)]">
            <tr>
              <th className="px-3 py-2">Row</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Phone</th>
              {previewCustomFields.map((d) => (
                <th key={d.id} className="px-3 py-2">
                  {d.name}
                </th>
              ))}
              <th className="px-3 py-2">Match / dup</th>
              <th className="px-3 py-2">Action</th>
            </tr>
          </thead>
          {/* Push 2c.3 — error rows now interleave with normal rows in
              CSV row order, each with a destructive-tinted background
              and a disabled "Skip — has errors" action so the user
              sees exactly where the bad rows are in their original
              CSV (rather than the bad rows being clumped at the end
              of the preview list as the old layout did). */}
          <tbody>
            {cleanRows.map((c) => {
              const hasError = c.errors.length > 0
              const preview = byPreview.get(c.rowIndex)
              const hasWarning = c.warnings.length > 0
              const dupOf = preview?.duplicateOfRow ?? null
              const isDup = dupOf !== null
              const bgClass = hasError
                ? "bg-[var(--color-destructive)]/5"
                : isDup || hasWarning
                  ? "bg-amber-500/5"
                  : ""
              return (
                <tr
                  key={c.rowIndex}
                  className={`border-t border-[var(--color-border)] ${bgClass} ${
                    preview?.action === "skip" && !hasError ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-3 py-2 align-top text-xs text-[var(--color-muted-foreground)]">
                    {c.rowIndex}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {[c.values.firstName, c.values.lastName].filter(Boolean).join(" ") || (
                      <em className="text-[var(--color-muted-foreground)]">—</em>
                    )}
                    {hasError && (
                      <p className="mt-1 text-[11px] font-medium text-red-700 dark:text-red-400">
                        {c.errors.join("; ")}
                      </p>
                    )}
                    {!hasError && hasWarning && (
                      <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                        {c.warnings.join("; ")}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-xs">{c.values.primaryEmail ?? "—"}</td>
                  <td className="px-3 py-2 align-top text-xs">{c.values.primaryPhone ?? "—"}</td>
                  {previewCustomFields.map((def) => {
                    const raw = c.customValues[def.id]
                    if (raw === undefined) {
                      return (
                        <td
                          key={def.id}
                          className="px-3 py-2 align-top text-xs text-[var(--color-muted-foreground)]"
                        >
                          —
                        </td>
                      )
                    }
                    const typed = coerceImportRawToTyped(def.fieldType, raw)
                    // checkbox renders as ✓ for true, blank for false,
                    // with a hover tooltip explaining the coercion rules
                    // (yes/no/true/false/1/0 spelling tolerated).
                    if (def.fieldType === "checkbox") {
                      return (
                        <td
                          key={def.id}
                          className="px-3 py-2 align-top text-xs"
                          title={`Raw "${raw}" → ${typed === true ? "true" : typed === false ? "false" : "unrecognized"}. Recognized: yes/no, true/false, 1/0, y/n.`}
                        >
                          {typed === true ? "✓" : ""}
                        </td>
                      )
                    }
                    return (
                      <td
                        key={def.id}
                        className="px-3 py-2 align-top text-xs"
                        title={`Raw value from CSV: "${raw}"`}
                      >
                        {formatCustomFieldCell(
                          {
                            id: def.id,
                            name: def.name,
                            fieldType: def.fieldType,
                            options: null,
                            archivedAt: def.archivedAt,
                          },
                          typed,
                        ) || "—"}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 align-top text-xs">
                    {hasError ? (
                      <span className="text-red-700 dark:text-red-400">—</span>
                    ) : isDup ? (
                      <span className="text-amber-700 dark:text-amber-300">
                        Duplicate of row {String(dupOf)}
                      </span>
                    ) : (
                      (preview?.matchedContactName ?? "—")
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {hasError ? (
                      <select
                        disabled
                        value="skip-error"
                        className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs text-red-700 disabled:opacity-70 dark:text-red-400"
                        aria-label={`Action for row ${String(c.rowIndex)} — disabled because the row has errors`}
                      >
                        <option value="skip-error">Skip — has errors</option>
                      </select>
                    ) : preview?.matchedContactId ? (
                      // P3 (C5) — Matched rows: Skip or Update Contact ONLY.
                      // Memory #24: never let a CSV import create a duplicate
                      // contact; the only safe actions for a matched row are
                      // skip (default) or update the existing record.
                      <select
                        value={preview.action === "create" ? "skip" : preview.action}
                        onChange={(e) => {
                          onSetAction(c.rowIndex, e.target.value as "update" | "skip")
                        }}
                        className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
                      >
                        <option value="skip">Skip</option>
                        <option value="update">Update Contact</option>
                      </select>
                    ) : (
                      <select
                        value={preview?.action ?? "create"}
                        onChange={(e) => {
                          onSetAction(c.rowIndex, e.target.value as "create" | "update" | "skip")
                        }}
                        className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
                      >
                        <option value="create">Create new</option>
                        <option value="skip">Skip</option>
                      </select>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Back
        </Button>
        {/* Push 2c.2.2 — co-locate Cancel with the commit button.
            Users about to confirm a destructive-feeling import expect
            a Cancel option right there, not just at the top of the
            wizard. */}
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={onNext} disabled={busy || willImportCount === 0}>
          {busy
            ? "Importing…"
            : erroredRows.length > 0
              ? `Import ${String(willImportCount)} rows (${String(erroredRows.length)} skipped due to errors)`
              : `Import ${String(willImportCount)} rows`}
        </Button>
      </div>
    </div>
  )
}

/**
 * Push 2c.5 — single-line "Set all <bucket> rows to: [action] [Apply]"
 * control rendered twice above the Preview step's row table (once for
 * matched rows, once for unmatched). Pure UI; the wizard owns the
 * actual mutation via onSetAllMatchedTo / onSetAllUnmatchedTo.
 */
function SetAllRow({
  label,
  defaultAction,
  allowedActions,
  onApply,
}: {
  label: string
  defaultAction: "create" | "update" | "skip"
  /** P3 (C5) — explicit list of allowed actions for this row's
   *  context. Matched-rows caller passes ["skip", "update"] (no
   *  Create new — memory #24); unmatched caller passes
   *  ["create", "skip"]. */
  allowedActions: ("create" | "update" | "skip")[]
  onApply: (action: "create" | "update" | "skip") => void
}) {
  const [action, setAction] = useState<"create" | "update" | "skip">(defaultAction)
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/30 px-3 py-2 text-xs">
      <span className="text-[var(--color-muted-foreground)]">{label}:</span>
      <select
        value={action}
        onChange={(e) => {
          setAction(e.target.value as "create" | "update" | "skip")
        }}
        className="h-7 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
        aria-label={label}
      >
        {allowedActions.includes("create") && <option value="create">Create new</option>}
        {allowedActions.includes("update") && <option value="update">Update Contact</option>}
        {allowedActions.includes("skip") && <option value="skip">Skip</option>}
      </select>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          onApply(action)
        }}
      >
        Apply
      </Button>
      <span className="text-[10px] text-[var(--color-muted-foreground)]">
        Skips rows you&apos;ve already changed individually + error rows.
      </span>
    </div>
  )
}

function BulkTagPicker({
  tags,
  onChange,
  existingTags,
}: {
  tags: string[]
  onChange: (next: string[]) => void
  existingTags: string[]
}) {
  const [input, setInput] = useState("")
  function add(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    if (trimmed.length > 80) return
    if (tags.includes(trimmed)) return
    onChange([...tags, trimmed])
    setInput("")
  }
  function remove(t: string) {
    onChange(tags.filter((x) => x !== t))
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {tags.length === 0 ? (
          <span className="text-xs text-[var(--color-muted-foreground)]">
            No bulk tags. Each row&apos;s own tags column (if mapped) still applies.
          </span>
        ) : (
          tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                remove(t)
              }}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary)]/15 px-2 py-0.5 text-xs text-[var(--color-primary)] hover:bg-[var(--color-primary)]/25"
              aria-label={`Remove ${t}`}
            >
              {t}
              <span aria-hidden="true">×</span>
            </button>
          ))
        )}
      </div>
      <div className="flex gap-1">
        <Input
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              add(input)
            }
          }}
          placeholder="Add a tag, press Enter"
          list="bulk-import-tag-options"
          maxLength={80}
          className="h-8 flex-1 text-xs"
        />
        <datalist id="bulk-import-tag-options">
          {existingTags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            add(input)
          }}
        >
          Add
        </Button>
      </div>
    </div>
  )
}

function DoneStep({
  result,
  onDownloadErrors,
  onDone,
}: {
  result: ImportResult
  onDownloadErrors: () => void
  onDone: () => void
}) {
  return (
    <div className="space-y-4 rounded-md border border-[var(--color-border)] p-6">
      {/* P3 (C5) — UPLOAD COMPLETE header per spec. text-2xl
          font-semibold matches the page title hierarchy. */}
      <div>
        <h2 className="text-2xl font-semibold">UPLOAD COMPLETE</h2>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {String(result.createdCount)} contact
          {result.createdCount === 1 ? "" : "s"} created · {String(result.updatedCount)} contact
          {result.updatedCount === 1 ? "" : "s"} updated · {String(result.skippedCount)} contact
          {result.skippedCount === 1 ? "" : "s"} skipped
        </p>
      </div>

      {/* P3 (C5) — skipped-rows list. Each row shows name + email
          + the matched contact link (if dedup) or a plain reason. */}
      {result.skippedRows.length > 0 && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3 text-xs">
          <p className="mb-2 font-medium">Skipped rows:</p>
          <ul className="max-h-48 space-y-1 overflow-y-auto pl-1">
            {result.skippedRows.map((s) => (
              <li key={s.rowIndex} className="flex items-center gap-2">
                <span className="text-[var(--color-muted-foreground)]">
                  Row {String(s.rowIndex)}:
                </span>
                <span>{s.name}</span>
                {s.email && (
                  <span className="text-[var(--color-muted-foreground)]">({s.email})</span>
                )}
                <span className="ml-auto text-[var(--color-muted-foreground)]">
                  {s.matchedContactId ? (
                    <Link
                      href={`/contacts/${s.matchedContactId}`}
                      className="underline hover:text-[var(--color-foreground)]"
                    >
                      {s.reason}
                    </Link>
                  ) : (
                    s.reason
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Push 2c.3 — errors-CSV download for any rows that failed
          mid-import (validation or DB error, NOT dedup skips). */}
      {result.errorCount > 0 && (
        <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-3 text-sm">
          <p className="mb-2 font-medium text-red-700 dark:text-red-400">
            {String(result.errorCount)} row{result.errorCount === 1 ? "" : "s"} couldn&apos;t be
            imported.
          </p>
          <p className="mb-3 text-xs text-red-700/80 dark:text-red-400/80">
            Fix the errors in this CSV and re-upload to import the remaining rows.
          </p>
          <Button onClick={onDownloadErrors}>Download errors as CSV</Button>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Link href="/contacts/import">
          <Button variant="outline">Import another file</Button>
        </Link>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  )
}
