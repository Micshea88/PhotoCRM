"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import { Button } from "@/components/ui/button"
import { updateUserViewPrefs } from "@/modules/saved-views/actions"
import {
  CONTACTS_DEFAULT_PAGE_SIZE,
  CONTACTS_VALID_PAGE_SIZES,
  type ContactsPageSize,
} from "../pagination"

/**
 * Push 2c — pagination footer for /contacts. Renders below the table
 * when the result set is paginated:
 *
 *   - Page-size selector (25 / 50 / 100). Selection persists per user
 *     via user_object_view_prefs.contact_page_size — fire-and-forget
 *     prefs upsert + URL update.
 *   - Prev / Next + first / current / last page chips (compact
 *     numeric pager).
 *   - Hidden entirely when totalCount ≤ pageSize (no pagination needed).
 *
 * The component is intentionally URL-driven — page lives in ?page=,
 * pageSize lives in ?pageSize=. Both round-trip through the server.
 */
export function ContactsPagination({
  totalCount,
  page,
  pageSize,
}: {
  totalCount: number
  page: number
  pageSize: ContactsPageSize
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [, startTransition] = useTransition()

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const showPager = totalCount > pageSize

  function goTo(nextPage: number, nextPageSize?: ContactsPageSize) {
    const next = new URLSearchParams(params)
    next.set("page", String(nextPage))
    if (nextPageSize) next.set("pageSize", String(nextPageSize))
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`)
    })
  }

  function onChangePageSize(value: number) {
    const ps = (CONTACTS_VALID_PAGE_SIZES as readonly number[]).includes(value)
      ? (value as ContactsPageSize)
      : CONTACTS_DEFAULT_PAGE_SIZE
    // Reset to page 1 when page size changes — otherwise a deep page on
    // pageSize=25 could become invalid on pageSize=100.
    goTo(1, ps)
    void updateUserViewPrefs({ objectType: "contact", contactPageSize: ps })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3 text-sm">
      <div className="flex items-center gap-2 text-[var(--color-muted-foreground)]">
        <label htmlFor="contacts-page-size" className="text-xs">
          Rows per page:
        </label>
        <select
          id="contacts-page-size"
          value={pageSize}
          onChange={(e) => {
            onChangePageSize(parseInt(e.target.value, 10))
          }}
          className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
        >
          {CONTACTS_VALID_PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="ml-2 text-xs">
          {totalCount === 0
            ? "0"
            : `${String((page - 1) * pageSize + 1)}–${String(Math.min(page * pageSize, totalCount))} of ${String(totalCount)}`}
        </span>
      </div>

      {showPager && (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => {
              goTo(page - 1)
            }}
          >
            Prev
          </Button>
          {pageNumbersWindow(page, totalPages).map((p, i) =>
            p === "..." ? (
              <span
                key={`g-${String(i)}`}
                className="px-2 text-xs text-[var(--color-muted-foreground)]"
              >
                …
              </span>
            ) : (
              <Button
                key={String(p)}
                size="sm"
                variant={p === page ? "default" : "outline"}
                onClick={() => {
                  goTo(p)
                }}
              >
                {p}
              </Button>
            ),
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => {
              goTo(page + 1)
            }}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Build a compact paginator window: [1, …, p-1, p, p+1, …, total].
 * For ≤ 7 pages, render them all. Avoid duplicate / out-of-order entries.
 */
function pageNumbersWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out: (number | "...")[] = [1]
  if (current > 3) out.push("...")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    out.push(p)
  }
  if (current < total - 2) out.push("...")
  out.push(total)
  return out
}
