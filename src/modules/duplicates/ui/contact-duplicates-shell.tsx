"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { formatPhoneDisplay } from "@/lib/format/phone"
import type { ListCustomFieldDef } from "@/modules/custom-fields/ui/column-helpers"
import { scanContactDuplicates, type ContactDuplicateGroupView } from "../actions"
import type { ContactMatchReason } from "../matching"
import { ContactMergeModal } from "./merge-contact-modal"

const REASON_LABEL: Record<ContactMatchReason, string> = {
  email: "Same email",
  phone: "Same phone",
  name_and_company: "Similar name and company",
  similar_email: "Similar email",
  similar_name_and_email: "Similar name and email",
  similar_name_and_phone: "Similar name and phone",
}

/**
 * Push 4 (B1) — interactive shell on /contacts/duplicates.
 *
 * - "Scan for duplicates" button invokes the orgAction
 *   `scanContactDuplicates`. The action enforces Owner+Admin, runs
 *   the matching engine, hydrates display rows, and writes the
 *   audit log entry.
 * - Result groups render below. Each card lists the matching
 *   reasons + per-record metadata.
 * - "Review" button per group is a STUB in B1 — wires up in B2.
 *
 * Server-side state is intentionally absent: duplicates are
 * computed on demand. Page refreshes show the empty state until
 * the user clicks Scan.
 */
export function ContactDuplicatesShell() {
  const [groups, setGroups] = useState<ContactDuplicateGroupView[] | null>(null)
  const [recordCount, setRecordCount] = useState<number | null>(null)
  const [customFieldDefs, setCustomFieldDefs] = useState<ListCustomFieldDef[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewGroup, setReviewGroup] = useState<ContactDuplicateGroupView | null>(null)

  async function runScan() {
    setBusy(true)
    setError(null)
    const result = await scanContactDuplicates({})
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
            ? "Click Scan for duplicates to check your contacts."
            : groups.length === 0
              ? `No duplicate contacts found across ${String(recordCount ?? 0)} active records.`
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
          No duplicate contacts found. Click Scan for duplicates to check again.
        </div>
      )}

      {groups && groups.length > 0 && (
        <ul className="space-y-3">
          {groups.map((g, i) => (
            <li
              key={i}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex flex-wrap gap-1.5">
                  {g.reasons.map((r) => (
                    <span
                      key={r}
                      className="rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs"
                    >
                      {REASON_LABEL[r]}
                    </span>
                  ))}
                </div>
                {g.records.length === 2 && g.records[0] && g.records[1] ? (
                  <Button type="button" variant="outline" size="sm" asChild>
                    {/* P3 C7 rebuild — pairwise groups route to the
                        full-record merge surface. 3+ groups continue
                        to use the B2 modal until multi-way merge
                        ships (captured upcoming). */}
                    <a
                      href={`/contacts/${g.records[0].id}/merge?with=${g.records[1].id}`}
                      data-testid="duplicate-review-pairwise"
                    >
                      Review
                    </a>
                  </Button>
                ) : (
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
                )}
              </div>
              <ul className="divide-y divide-[var(--color-border)]">
                {g.records.map((r) => (
                  <li
                    key={r.id}
                    className="grid grid-cols-[1fr_1fr_1fr_120px_120px] gap-3 py-2 text-sm"
                  >
                    <div className="font-medium">
                      {r.firstName} {r.lastName}
                    </div>
                    <div className="truncate text-[var(--color-muted-foreground)]">
                      {r.primaryEmail ?? "—"}
                    </div>
                    <div className="text-[var(--color-muted-foreground)]">
                      {formatPhoneDisplay(r.primaryPhone)}
                    </div>
                    <div className="text-[var(--color-muted-foreground)]">
                      {r.companyName ?? "—"}
                    </div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">
                      {r.lifecycleStatus ?? "—"} · {r.createdAt.slice(0, 10)}
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <ContactMergeModal
        open={reviewGroup !== null}
        group={reviewGroup}
        customFieldDefs={customFieldDefs}
        onClose={() => {
          setReviewGroup(null)
        }}
        onMerged={() => {
          setReviewGroup(null)
          // Re-scan to pick up the merged state so the just-merged
          // group disappears from the list.
          void runScan()
        }}
      />
    </div>
  )
}
