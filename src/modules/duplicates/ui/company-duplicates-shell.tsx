"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { formatPhoneDisplay } from "@/lib/format/phone"
import type { ListCustomFieldDef } from "@/modules/custom-fields/ui/column-helpers"
import { scanCompanyDuplicates, type CompanyDuplicateGroupView } from "../actions"
import type { CompanyMatchReason } from "../matching"
import { CompanyMergeModal } from "./merge-company-modal"

const REASON_LABEL: Record<CompanyMatchReason, string> = {
  domain: "Same domain",
  name_and_phone: "Same name + phone",
  name_and_industry: "Same name + industry",
}

/**
 * Push 4 (B1) — interactive shell on /companies/duplicates. Mirrors
 * the contact-duplicates-shell pattern; per-entity display columns
 * differ.
 */
export function CompanyDuplicatesShell() {
  const [groups, setGroups] = useState<CompanyDuplicateGroupView[] | null>(null)
  const [recordCount, setRecordCount] = useState<number | null>(null)
  const [customFieldDefs, setCustomFieldDefs] = useState<ListCustomFieldDef[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewGroup, setReviewGroup] = useState<CompanyDuplicateGroupView | null>(null)

  async function runScan() {
    setBusy(true)
    setError(null)
    const result = await scanCompanyDuplicates({})
    setBusy(false)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    setGroups(result.data?.groups ?? null)
    setRecordCount(result.data?.recordCount ?? null)
    setCustomFieldDefs(result.data?.customFieldDefs ?? [])
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {groups === null
            ? "Click Scan for duplicates to check your companies."
            : groups.length === 0
              ? `No duplicate companies found across ${String(recordCount ?? 0)} active records.`
              : `Found ${String(groups.length)} duplicate group${groups.length === 1 ? "" : "s"} across ${String(recordCount ?? 0)} active records.`}
        </p>
        <Button
          type="button"
          onClick={() => {
            void runScan()
          }}
          disabled={busy}
        >
          {busy ? "Scanning…" : "Scan for duplicates"}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 p-3 text-sm text-[var(--color-destructive)]">
          {error}
        </div>
      )}

      {groups?.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          No duplicate companies found. Click Scan for duplicates to check again.
        </div>
      )}

      {groups && groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((g, i) => (
            <Card key={i} className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex flex-wrap gap-1.5">
                  {g.reasons.map((r) => (
                    <Badge key={r}>{REASON_LABEL[r]}</Badge>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setReviewGroup(g)
                  }}
                >
                  Review
                </Button>
              </div>
              <ul className="divide-y divide-[var(--color-border)]">
                {g.records.map((r) => (
                  <li
                    key={r.id}
                    className="grid grid-cols-[1fr_1fr_140px_140px_120px] gap-3 py-2 text-sm"
                  >
                    <div className="font-medium">{r.name}</div>
                    <div className="truncate text-[var(--color-muted-foreground)]">
                      {r.website ?? "—"}
                    </div>
                    <div className="text-[var(--color-muted-foreground)]">
                      {formatPhoneDisplay(r.mainPhone)}
                    </div>
                    <div className="text-[var(--color-muted-foreground)]">{r.category ?? "—"}</div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">
                      {r.createdAt.slice(0, 10)}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <CompanyMergeModal
        open={reviewGroup !== null}
        group={reviewGroup}
        customFieldDefs={customFieldDefs}
        onClose={() => {
          setReviewGroup(null)
        }}
        onMerged={() => {
          setReviewGroup(null)
          void runScan()
        }}
      />
    </div>
  )
}
