"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { previewContactsImport, runContactsImport } from "../import-actions"
import {
  autoMapHeaders,
  buildCleanRow,
  buildErrorsCsv,
  CSV_MAX_ROWS,
  FIELD_LABELS,
  IMPORTABLE_FIELDS,
  parseCsv,
  type CleanRow,
  type ImportableField,
  type ParsedCsv,
} from "../import-spec"

type Step = "upload" | "map" | "preview" | "importing" | "done"

function stripUndefined(values: Partial<Record<ImportableField, string>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === "string") out[k] = v
  }
  return out
}

interface PreviewRow {
  rowIndex: number
  matchedContactId: string | null
  matchedContactName: string | null
  action: "create" | "update" | "skip"
}

interface ImportResult {
  successCount: number
  errorCount: number
  errorRows: { rowIndex: number; error: string; raw: string[] }[]
}

/**
 * Push 2c — 4-step contacts CSV import wizard.
 *
 *   1. Upload — file picker, parse via the inline RFC-4180 parser in
 *      import-spec.ts. Hard cap 10,000 rows.
 *   2. Map — auto-mapped header → field dropdowns; user can override.
 *   3. Preview & dedupe — server-side dedupe by email (primary) /
 *      phone (fallback). Per-row dropdown to override the proposed
 *      action (Create new / Update existing / Skip).
 *   4. Importing → Done — runs the server import action, shows a
 *      summary + "Download errors as CSV" link if anything failed.
 *
 * All state is client-side until step 3/4's server roundtrips. The
 * wizard is intentionally one big component — Push 2c is the only
 * caller and the state machine is small enough that splitting into
 * sub-components adds more bookkeeping than it saves.
 */
export function ContactsImportWizard() {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [step, setStep] = useState<Step>("upload")
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [mapping, setMapping] = useState<(ImportableField | null)[]>([])
  const [cleanRows, setCleanRows] = useState<CleanRow[]>([])
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    // Send only the rows that have at least firstName + lastName to the
    // preview action — error rows are surfaced inline but not sent for
    // dedupe matching.
    const sendable = cleaned.filter((c) => c.errors.length === 0)
    if (sendable.length === 0) {
      setError(
        "No rows are importable as-is. Every row is missing required fields — check your column mapping.",
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
    const previews: PreviewRow[] = (result.data?.rows ?? []).map((r) => ({
      rowIndex: r.rowIndex,
      matchedContactId: r.matchedContactId,
      matchedContactName: r.matchedContactName,
      action: r.proposedAction,
    }))
    setPreviewRows(previews)
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
    const result = await runContactsImport({ rows: payload })
    setBusy(false)
    if (result.serverError) {
      setError(result.serverError)
      setStep("preview")
      return
    }
    // Build the errors list — server-side errors + client-side
    // pre-flight errors (rows with validation issues we never sent).
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
  busy,
  onBack,
  onNext,
}: {
  headers: string[]
  mapping: (ImportableField | null)[]
  onChange: (next: (ImportableField | null)[]) => void
  rowCount: number
  busy: boolean
  onBack: () => void
  onNext: () => void
}) {
  const mappedRequiredFields = new Set(mapping.filter((m): m is ImportableField => !!m))
  const hasFirstName = mappedRequiredFields.has("firstName")
  const hasLastName = mappedRequiredFields.has("lastName")
  const canContinue = hasFirstName && hasLastName && !busy

  return (
    <div className="space-y-4 rounded-md border border-[var(--color-border)] p-6">
      <div>
        <h2 className="text-base font-medium">Map columns to contact fields</h2>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {String(rowCount)} data row{rowCount === 1 ? "" : "s"} found. We&apos;ve auto-mapped
          familiar headers — confirm or change below. <strong>First name</strong> and{" "}
          <strong>Last name</strong> are required.
        </p>
      </div>
      <div className="overflow-hidden rounded-md border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-muted)] text-left text-xs text-[var(--color-muted-foreground)]">
            <tr>
              <th className="px-3 py-2">CSV column</th>
              <th className="px-3 py-2">Maps to</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((h, i) => (
              <tr key={h + String(i)} className="border-t border-[var(--color-border)]">
                <td className="px-3 py-2 font-mono text-xs">{h}</td>
                <td className="px-3 py-2">
                  <select
                    value={mapping[i] ?? ""}
                    onChange={(e) => {
                      const next = [...mapping]
                      next[i] = (e.target.value || null) as ImportableField | null
                      onChange(next)
                    }}
                    className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
                  >
                    <option value="">— Don&apos;t import —</option>
                    {IMPORTABLE_FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {FIELD_LABELS[f]}
                      </option>
                    ))}
                  </select>
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
        <Button onClick={onNext} disabled={!canContinue}>
          {busy ? "Checking…" : "Preview"}
        </Button>
      </div>
    </div>
  )
}

function PreviewStep({
  cleanRows,
  previewRows,
  onSetAction,
  busy,
  onBack,
  onNext,
}: {
  cleanRows: CleanRow[]
  previewRows: PreviewRow[]
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
  const skipCount = previewRows.filter((p) => p.action === "skip").length

  return (
    <div className="space-y-4 rounded-md border border-[var(--color-border)] p-6">
      <div>
        <h2 className="text-base font-medium">Preview &amp; dedupe</h2>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {String(createCount)} create · {String(updateCount)} update · {String(skipCount)} skip
          {erroredRows.length > 0
            ? ` · ${String(erroredRows.length)} row${erroredRows.length === 1 ? "" : "s"} with validation errors (won't be imported)`
            : ""}
          .
        </p>
      </div>

      <div className="max-h-[440px] overflow-auto rounded-md border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--color-muted)] text-left text-xs text-[var(--color-muted-foreground)]">
            <tr>
              <th className="px-3 py-2">Row</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Match</th>
              <th className="px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {importableRows.map((c) => {
              const preview = byPreview.get(c.rowIndex)
              return (
                <tr key={c.rowIndex} className="border-t border-[var(--color-border)]">
                  <td className="px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
                    {c.rowIndex}
                  </td>
                  <td className="px-3 py-2">
                    {[c.values.firstName, c.values.lastName].filter(Boolean).join(" ")}
                  </td>
                  <td className="px-3 py-2 text-xs">{c.values.primaryEmail ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{c.values.primaryPhone ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{preview?.matchedContactName ?? "—"}</td>
                  <td className="px-3 py-2">
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
          {busy ? "Importing…" : `Import ${String(importableRows.length)} rows`}
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
