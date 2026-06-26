import { redirect } from "next/navigation"
import Link from "next/link"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { getScanDiagnostics } from "@/modules/files/queries"
import type { FileScanDiagnostic } from "@/modules/files/scan-diagnostics-schema"

/**
 * TEMPORARY scan-pipeline diagnostics viewer (2026-06-26). Owner/Admin only.
 *
 * Renders the last 50 file_scan_diagnostics rows so Mike can read the upload →
 * scan → poll timeline from one URL (the [SCAN-DIAG] console logs aren't
 * surfacing in Vercel prod). Server-rendered plain HTML — no client JS, fast to
 * load. Delete this page + the table once the scan timing is understood.
 */

export const dynamic = "force-dynamic"

function fmtTs(d: Date): string {
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function DiagTable({ rows }: { rows: FileScanDiagnostic[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
          <th style={{ padding: "4px 8px" }}>Time</th>
          <th style={{ padding: "4px 8px" }}>Step</th>
          <th style={{ padding: "4px 8px" }}>Status</th>
          <th style={{ padding: "4px 8px" }}>ms</th>
          <th style={{ padding: "4px 8px" }}>Error</th>
          <th style={{ padding: "4px 8px" }}>Details</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const details = {
            requestId: r.requestId,
            filename: r.filename,
            fileSizeBytes: r.fileSizeBytes,
            fileId: r.fileId,
            orgId: r.orgId,
            responsePayload: r.responsePayload,
            metadata: r.metadata,
          }
          return (
            <tr key={r.id} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
              <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{fmtTs(r.createdAt)}</td>
              <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{r.step}</td>
              <td style={{ padding: "4px 8px" }}>{r.status ?? ""}</td>
              <td style={{ padding: "4px 8px", textAlign: "right" }}>{r.durationMs ?? ""}</td>
              <td style={{ padding: "4px 8px", color: r.errorMessage ? "#c00" : undefined }}>
                {r.errorMessage ?? ""}
              </td>
              <td style={{ padding: "4px 8px" }}>
                <details>
                  <summary style={{ cursor: "pointer" }}>view</summary>
                  <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: "4px 0" }}>
                    {JSON.stringify(details, null, 2)}
                  </pre>
                </details>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default async function ScanDiagnosticsPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const member = await getCurrentMember(orgId, session.user.id)
  if (!member) redirect("/dashboard")
  const tentativeRole = extendedFromBetterAuth(member.role as BetterAuthRole)
  const extendedRole =
    (await runWithOrgContext({ orgId, role: tentativeRole, userId: session.user.id }, async () =>
      getExtendedMemberRole(session.user.id),
    )) ?? tentativeRole
  if (extendedRole !== "owner" && extendedRole !== "admin") redirect("/dashboard")

  const rows = await getScanDiagnostics(orgId)

  // Split: rows with a file_id group into per-file timelines; rows without go in
  // the "Pre-upload" section (early steps that fire before the files row exists).
  const preUpload = rows.filter((r) => !r.fileId)
  const byFile = new Map<string, FileScanDiagnostic[]>()
  for (const r of rows) {
    if (!r.fileId) continue
    const list = byFile.get(r.fileId)
    if (list) list.push(r)
    else byFile.set(r.fileId, [r])
  }
  // Each group oldest→newest for a readable timeline; groups by most-recent first.
  const groups = [...byFile.entries()]
    .map(([fileId, list]) => ({
      fileId,
      rows: [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      lastAt: Math.max(...list.map((x) => x.createdAt.getTime())),
    }))
    .sort((a, b) => b.lastAt - a.lastAt)

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "24px", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "16px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 600 }}>Scan diagnostics</h1>
        <a href="/admin/scan-diagnostics" style={{ color: "#06c" }}>
          ↻ Refresh
        </a>
        <Link href="/dashboard" style={{ color: "#888", fontSize: "13px" }}>
          ← Dashboard
        </Link>
      </div>
      <p style={{ color: "#666", fontSize: "13px", margin: "4px 0 20px" }}>
        Last {String(rows.length)} steps (newest first within each section). Temporary diagnostic —
        delete once scan timing is understood.
      </p>

      {rows.length === 0 ? (
        <p>No diagnostics captured yet. Trigger an upload, then Refresh.</p>
      ) : null}

      {preUpload.length > 0 ? (
        <section style={{ marginBottom: "28px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 6px" }}>
            Pre-upload / unkeyed steps ({String(preUpload.length)})
          </h2>
          <DiagTable rows={preUpload} />
        </section>
      ) : null}

      {groups.map((g) => (
        <section key={g.fileId} style={{ marginBottom: "28px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 6px" }}>
            File <code>{g.fileId}</code> ({String(g.rows.length)} steps)
          </h2>
          <DiagTable rows={g.rows} />
        </section>
      ))}
    </div>
  )
}
