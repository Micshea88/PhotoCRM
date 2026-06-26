import "server-only"
import { db } from "@/lib/db"
import { fileScanDiagnostics } from "./scan-diagnostics-schema"

/**
 * TEMPORARY database-backed scan-pipeline observability (2026-06-26).
 *
 * Each pipeline step writes one row; the admin viewer renders the timeline.
 * Used because the [SCAN-DIAG] console logs aren't surfacing in Vercel prod.
 *
 * CONTRACT: this is diagnostic infra and MUST NEVER affect the upload flow.
 * The insert is best-effort — any failure is swallowed (logged to stderr via
 * console.error only, which is the one place this is intentional — pino logs
 * are exactly what we can't see, so we fall back to console here). It does not
 * throw and is safe to `await` or fire-and-forget at every instrumentation site.
 */
export interface ScanStepOpts {
  fileId?: string
  status?: string
  durationMs?: number
  requestId?: string
  fileSizeBytes?: number
  filename?: string
  errorMessage?: string
  responsePayload?: unknown
  metadata?: Record<string, unknown>
  orgId?: string
}

export async function logScanStep(step: string, opts: ScanStepOpts = {}): Promise<void> {
  try {
    await db.insert(fileScanDiagnostics).values({
      step,
      fileId: opts.fileId ?? null,
      status: opts.status ?? null,
      durationMs: opts.durationMs ?? null,
      requestId: opts.requestId ?? null,
      fileSizeBytes: opts.fileSizeBytes ?? null,
      filename: opts.filename ?? null,
      errorMessage: opts.errorMessage ?? null,
      responsePayload: opts.responsePayload ?? null,
      metadata: opts.metadata ?? null,
      orgId: opts.orgId ?? null,
    })
  } catch (err) {
    // Diagnostic infra must never break uploads — swallow.
    // eslint-disable-next-line no-console
    console.error("[SCAN-DIAG] logScanStep insert failed", step, err)
  }
}
