"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { previewContactsImport, runContactsImport } from "../import-actions"
import {
  autoMapHeaders,
  buildCleanRow,
  buildErrorsCsv,
  CSV_MAX_ROWS,
  detectFieldType,
  detectionAgreesWithMapping,
  FIELD_LABELS,
  findCsvInternalDuplicates,
  firstNonEmptySample,
  IMPORTABLE_FIELDS,
  parseCsv,
  type CleanRow,
  type DetectedType,
  type ImportableField,
  type ParsedCsv,
} from "../import-spec"

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
}: {
  currentUserId: string
  orgMembers: OrgMember[]
  existingTags: string[]
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
  const [mapping, setMapping] = useState<(ImportableField | null)[]>([])
  const [cleanRows, setCleanRows] = useState<CleanRow[]>([])
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [orgMemberEmails, setOrgMemberEmails] = useState<string[]>([])
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
      setMapping(autoMapHeaders(next.headers))
      goToStep("map")
    } catch {
      setError(
        "Couldn't parse this CSV — re-export from your editor as standard UTF-8 CSV and try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  // ─── Step 2 → 3: map + run server dedupe ─────────────────────────────
  async function continueToPreview() {
    if (!parsed) return
    setError(null)
    const cleaned = parsed.rows.map((row, i) => buildCleanRow(i + 1, row, mapping))
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
      // Default: duplicates skip, server-matched rows update, otherwise create.
      let action: "create" | "update" | "skip" = r.proposedAction
      if (dupOf !== null) action = "skip"
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
    setImportResult({
      successCount: result.data?.successCount ?? 0,
      errorCount: (result.data?.errorCount ?? 0) + preflightErrors.length,
      errorRows: [...preflightErrors, ...serverErrors],
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
          onFile={(f) => {
            void onFileChange(f)
          }}
        />
      )}

      {step === "map" && parsed && (
        <MapStep
          headers={parsed.headers}
          mapping={mapping}
          onChange={setMapping}
          rowCount={parsed.rows.length}
          sampleValues={sampleValues}
          detectedTypes={detectedTypes}
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

function UploadStep({ busy, onFile }: { busy: boolean; onFile: (f: File) => void }) {
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
    </div>
  )
}

function MapStep({
  headers,
  mapping,
  onChange,
  rowCount,
  sampleValues,
  detectedTypes,
  busy,
  onBack,
  onNext,
}: {
  headers: string[]
  mapping: (ImportableField | null)[]
  onChange: (next: (ImportableField | null)[]) => void
  rowCount: number
  sampleValues: string[]
  detectedTypes: DetectedType[]
  busy: boolean
  onBack: () => void
  onNext: () => void
}) {
  const mapped = new Set(mapping.filter((m): m is ImportableField => !!m))
  // Push 2c.1 — preview enables when at least one identifier-shaped
  // field is mapped. lastName preferred, fullName equivalent, email
  // also works (HubSpot pattern: email-only leads are common).
  const canContinue =
    !busy && (mapped.has("fullName") || mapped.has("lastName") || mapped.has("primaryEmail"))

  return (
    <div className="space-y-4 rounded-md border border-[var(--color-border)] p-6">
      <div>
        <h2 className="text-base font-medium">Map columns to contact fields</h2>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {rowCount === 1 ? "1 data row found." : `${String(rowCount)} data rows found.`} We&apos;ve
          auto-mapped familiar headers — confirm or change below. Each row needs at least one of{" "}
          <strong>Full name</strong>, <strong>Last name</strong>, or <strong>Primary email</strong>{" "}
          mapped.
        </p>
      </div>
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
              const agrees = detectionAgreesWithMapping(detected, chosen)
              const showWarning = detected !== null && chosen !== null && !agrees
              const showSuggestionCheck = detected !== null && chosen !== null && agrees
              return (
                <tr key={h + String(i)} className="border-t border-[var(--color-border)] align-top">
                  <td className="px-3 py-2 font-mono text-xs">{h}</td>
                  <td className="px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
                    {sampleValues[i] === "" ? <em>empty</em> : sampleValues[i]}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={chosen ?? ""}
                        onChange={(e) => {
                          const next = [...mapping]
                          next[i] = (e.target.value || null) as ImportableField | null
                          onChange(next)
                        }}
                        className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
                      >
                        <option value="">— Don&apos;t include in import —</option>
                        {IMPORTABLE_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {FIELD_LABELS[f]}
                          </option>
                        ))}
                      </select>
                      {showSuggestionCheck && (
                        <span
                          aria-label="Detected type matches mapping"
                          title="Detected type matches mapping"
                          className="text-green-600 dark:text-green-400"
                        >
                          ✓
                        </span>
                      )}
                    </div>
                    {showWarning && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        This column looks like {humanizeType(detected)} but is mapped to{" "}
                        {FIELD_LABELS[chosen]}.
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
        <Button onClick={onNext} disabled={!canContinue}>
          {busy ? "Checking…" : "Preview"}
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
        defaultAction="update"
        onApply={onSetAllMatchedTo}
      />
      <SetAllRow
        label="Set all unmatched rows to"
        defaultAction="create"
        onApply={onSetAllUnmatchedTo}
      />

      {/* Row preview table */}
      <div className="max-h-[440px] overflow-auto rounded-md border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--color-muted)] text-left text-xs text-[var(--color-muted-foreground)]">
            <tr>
              <th className="px-3 py-2">Row</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Phone</th>
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
                <tr key={c.rowIndex} className={`border-t border-[var(--color-border)] ${bgClass}`}>
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
                    ) : (
                      <select
                        value={preview?.action ?? "create"}
                        onChange={(e) => {
                          onSetAction(c.rowIndex, e.target.value as "create" | "update" | "skip")
                        }}
                        className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
                      >
                        <option value="create">Create new</option>
                        <option value="update" disabled={!preview?.matchedContactId}>
                          Update existing
                        </option>
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
  onApply,
}: {
  label: string
  defaultAction: "create" | "update" | "skip"
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
        <option value="create">Create new</option>
        <option value="update">Update existing</option>
        <option value="skip">Skip</option>
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
      <div>
        <h2 className="text-base font-medium">Import complete</h2>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {String(result.successCount)} imported · {String(result.errorCount)} skipped or errored.
        </p>
      </div>
      {/* Push 2c.3 — hoist the errors-CSV download ABOVE the closing
          action row so users with failed rows see the recovery
          affordance immediately. Border + bg color now red (was
          amber) to match the Preview-step error treatment. */}
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
