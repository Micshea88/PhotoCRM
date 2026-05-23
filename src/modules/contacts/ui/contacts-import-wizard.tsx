"use client"

import Link from "next/link"
import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
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

type Step = "upload" | "map" | "preview" | "importing" | "done"
type OwnerMode = "self" | "specific" | "from_csv"
type ErrorMode = "skip" | "stop"

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

interface PreviewRow {
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
  stopped: boolean
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
  const [, startTransition] = useTransition()

  const [step, setStep] = useState<Step>("upload")
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
  const [errorMode, setErrorMode] = useState<ErrorMode>("skip")

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
      setStep("map")
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
    setStep("preview")
  }

  function setRowAction(rowIndex: number, action: "create" | "update" | "skip") {
    setPreviewRows((prev) => prev.map((r) => (r.rowIndex === rowIndex ? { ...r, action } : r)))
  }

  // ─── Step 4: run ─────────────────────────────────────────────────────
  async function runImport() {
    setError(null)
    setStep("importing")
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
      errorMode,
    })
    setBusy(false)
    if (result.serverError) {
      setError(result.serverError)
      setStep("preview")
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
      stopped: result.data?.stopped ?? false,
    })
    setStep("done")
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
            setStep("upload")
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
          errorMode={errorMode}
          onErrorModeChange={setErrorMode}
          ownerEmailColumnMapped={mapping.includes("ownerUserId")}
          onSetAction={setRowAction}
          busy={busy}
          onBack={() => {
            setStep("map")
          }}
          onNext={() => {
            void runImport()
          }}
        />
      )}

      {step === "importing" && (
        <div className="rounded-md border border-[var(--color-border)] p-6 text-center">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Importing… don&apos;t close this tab.
          </p>
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
  const currentIndex = labels.findIndex(
    (l) => l.step === (current === "importing" ? "done" : current),
  )
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
          {String(rowCount)} data row{rowCount === 1 ? "" : "s"} found. We&apos;ve auto-mapped
          familiar headers — confirm or change below. Each row needs at least one of{" "}
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

function PreviewStep({
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
  errorMode,
  onErrorModeChange,
  ownerEmailColumnMapped,
  onSetAction,
  busy,
  onBack,
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
  errorMode: ErrorMode
  onErrorModeChange: (m: ErrorMode) => void
  ownerEmailColumnMapped: boolean
  onSetAction: (rowIndex: number, action: "create" | "update" | "skip") => void
  busy: boolean
  onBack: () => void
  onNext: () => void
}) {
  const importableRows = cleanRows.filter((c) => c.errors.length === 0)
  const erroredRows = cleanRows.filter((c) => c.errors.length > 0)
  const byPreview = new Map(previewRows.map((p) => [p.rowIndex, p]))

  const createCount = previewRows.filter((p) => p.action === "create").length
  const updateCount = previewRows.filter((p) => p.action === "update").length
  const skipCount = previewRows.filter((p) => p.action === "skip").length + erroredRows.length
  const warningCount = importableRows.filter((c) => c.warnings.length > 0).length
  const duplicateCount = previewRows.filter((p) => p.duplicateOfRow !== null).length

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

      {/* Validation summary */}
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3 text-xs">
        <p className="font-medium">Before import:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>{String(createCount)} rows will create new contacts</li>
          <li>{String(updateCount)} rows will update existing contacts</li>
          <li>{String(skipCount)} rows will be skipped</li>
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

        <fieldset className="space-y-1.5 text-sm md:col-span-2">
          <legend className="font-medium">If a row errors</legend>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              checked={errorMode === "skip"}
              onChange={() => {
                onErrorModeChange("skip")
              }}
            />
            <span>Skip the row and import the rest</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              checked={errorMode === "stop"}
              onChange={() => {
                onErrorModeChange("stop")
              }}
            />
            <span>Stop the import on the first error</span>
          </label>
        </fieldset>
      </div>

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
          <tbody>
            {importableRows.map((c) => {
              const preview = byPreview.get(c.rowIndex)
              const hasWarning = c.warnings.length > 0
              const dupOf = preview?.duplicateOfRow ?? null
              const isDup = dupOf !== null
              return (
                <tr
                  key={c.rowIndex}
                  className={`border-t border-[var(--color-border)] ${
                    isDup || hasWarning ? "bg-amber-500/5" : ""
                  }`}
                >
                  <td className="px-3 py-2 align-top text-xs text-[var(--color-muted-foreground)]">
                    {c.rowIndex}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {[c.values.firstName, c.values.lastName].filter(Boolean).join(" ") || (
                      <em className="text-[var(--color-muted-foreground)]">—</em>
                    )}
                    {hasWarning && (
                      <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                        {c.warnings.join("; ")}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-xs">{c.values.primaryEmail ?? "—"}</td>
                  <td className="px-3 py-2 align-top text-xs">{c.values.primaryPhone ?? "—"}</td>
                  <td className="px-3 py-2 align-top text-xs">
                    {isDup ? (
                      <span className="text-amber-700 dark:text-amber-300">
                        Duplicate of row {String(dupOf)}
                      </span>
                    ) : (
                      (preview?.matchedContactName ?? "—")
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
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
                  </td>
                </tr>
              )
            })}
            {erroredRows.map((c) => (
              <tr key={c.rowIndex} className="border-t border-[var(--color-border)] bg-red-500/5">
                <td className="px-3 py-2 text-xs text-red-700 dark:text-red-300">{c.rowIndex}</td>
                <td colSpan={5} className="px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  Skipped: {c.errors.join("; ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button onClick={onNext} disabled={busy || importableRows.length === 0}>
          {busy ? "Importing…" : `Import ${String(createCount + updateCount)} rows`}
        </Button>
      </div>
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
      {result.stopped && (
        <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          Import stopped early because &ldquo;Stop on first error&rdquo; was selected. Earlier rows
          were imported; later rows were not attempted.
        </div>
      )}
      {result.errorCount > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
          <p className="mb-2 text-amber-700 dark:text-amber-300">
            {String(result.errorCount)} row{result.errorCount === 1 ? "" : "s"} couldn&apos;t be
            imported. Download the error CSV, fix the issues, and re-import.
          </p>
          <Button variant="outline" size="sm" onClick={onDownloadErrors}>
            Download errors as CSV
          </Button>
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
