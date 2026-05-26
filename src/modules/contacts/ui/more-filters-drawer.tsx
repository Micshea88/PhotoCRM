"use client"

import { useCallback, useState, useTransition } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Drawer } from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"

export interface CustomFieldDef {
  id: string
  name: string
  fieldType: string
  options: { choices?: { value: string; label: string }[] } | null
  /** Push 4 (A4) — surface archived state so the drawer (and other
   * consumers sharing this prop shape) can suffix the label with
   * "(archived)" and prevent new filter additions on archived fields. */
  archivedAt: string | Date | null
}

interface MoreFiltersDrawerProps {
  open: boolean
  onClose: () => void
  customFields: CustomFieldDef[]
}

/**
 * "+ More filters" slideout. Five sections, all URL-driven so the
 * applied state survives navigation + shows up on the chip strip via
 * the existing parseFilters → listContactsForView path.
 *
 * Empty/"no filter" maps to the URL param being absent. Toggling a
 * filter off deletes the param, never sets it to a sentinel value.
 */
export function MoreFiltersDrawer({ open, onClose, customFields }: MoreFiltersDrawerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params)
      if (value === null || value === "") {
        next.delete(key)
      } else {
        next.set(key, value)
      }
      setBusy(true)
      startTransition(() => {
        router.push(`${pathname}?${next.toString()}`)
        setBusy(false)
      })
    },
    [params, pathname, router],
  )

  const hasPhone = params.get("hasPhone") === "true"
  const hasEmail = params.get("hasEmail") === "true"
  const lastActFrom = params.get("lastActivityFrom") ?? ""
  const lastActTo = params.get("lastActivityTo") ?? ""
  const tasksFrom = params.get("openTasksFrom") ?? ""
  const tasksTo = params.get("openTasksTo") ?? ""

  function applyPresetTo(prefix: "lastActivity" | "openTasks", days: number) {
    const end = new Date()
    const start = new Date()
    if (days > 0) start.setDate(end.getDate() - days)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const next = new URLSearchParams(params)
    next.set(`${prefix}From`, fmt(start))
    next.set(`${prefix}To`, fmt(end))
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`)
    })
  }

  function clearRange(prefix: "lastActivity" | "openTasks") {
    const next = new URLSearchParams(params)
    next.delete(`${prefix}From`)
    next.delete(`${prefix}To`)
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`)
    })
  }

  return (
    <Drawer open={open} onClose={onClose} title="More filters">
      <div className="space-y-6">
        {/* Has Phone / Has Email — boolean toggles */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Has contact info</h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hasPhone}
              onChange={(e) => {
                updateParam("hasPhone", e.target.checked ? "true" : null)
              }}
              disabled={busy}
            />
            Has phone number
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hasEmail}
              onChange={(e) => {
                updateParam("hasEmail", e.target.checked ? "true" : null)
              }}
              disabled={busy}
            />
            Has email address
          </label>
        </section>

        {/* Last Activity Date */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Last activity date</h3>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            V1 uses the contact&apos;s last-updated timestamp as the activity proxy.
          </p>
          <DateRangeBlock
            prefix="lastActivity"
            from={lastActFrom}
            to={lastActTo}
            updateParam={updateParam}
            applyPreset={(days) => {
              applyPresetTo("lastActivity", days)
            }}
            clearRange={() => {
              clearRange("lastActivity")
            }}
          />
        </section>

        {/* Open tasks */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Open tasks</h3>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Contacts whose linked events have an incomplete task due in the range.
          </p>
          <DateRangeBlock
            prefix="openTasks"
            from={tasksFrom}
            to={tasksTo}
            updateParam={updateParam}
            applyPreset={(days) => {
              applyPresetTo("openTasks", days)
            }}
            clearRange={() => {
              clearRange("openTasks")
            }}
          />
        </section>

        {/* Custom fields — render per-type inputs */}
        {customFields.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Custom fields</h3>
            {customFields.map((f) => (
              <CustomFieldInput key={f.id} field={f} />
            ))}
          </section>
        )}
      </div>
    </Drawer>
  )
}

function DateRangeBlock({
  prefix,
  from,
  to,
  updateParam,
  applyPreset,
  clearRange,
}: {
  prefix: "lastActivity" | "openTasks"
  from: string
  to: string
  updateParam: (key: string, value: string | null) => void
  applyPreset: (days: number) => void
  clearRange: () => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            applyPreset(0)
          }}
        >
          Today
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            applyPreset(7)
          }}
        >
          This week
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            applyPreset(30)
          }}
        >
          This month
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            applyPreset(90)
          }}
        >
          This quarter
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            applyPreset(365)
          }}
        >
          This year
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs">From</label>
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              updateParam(`${prefix}From`, e.target.value || null)
            }}
          />
        </div>
        <div>
          <label className="text-xs">To</label>
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              updateParam(`${prefix}To`, e.target.value || null)
            }}
          />
        </div>
      </div>
      {(from || to) && (
        <Button type="button" variant="outline" size="sm" onClick={clearRange}>
          Clear range
        </Button>
      )}
    </div>
  )
}

/**
 * Per-type input renderer for one custom field. Skips read-only
 * `formula` fields per spec. URL key shape: `cf:<fieldId>:<op>`.
 */
function CustomFieldInput({ field }: { field: CustomFieldDef }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function setParam(op: string, value: string | null) {
    const key = `cf:${field.id}:${op}`
    const next = new URLSearchParams(params)
    if (value === null || value === "") {
      next.delete(key)
    } else {
      next.set(key, value)
    }
    router.push(`${pathname}?${next.toString()}`)
  }

  const getParam = (op: string) => params.get(`cf:${field.id}:${op}`) ?? ""
  // Push 4 (A4) — suffix archived defs so loaded saved views show
  // the user why the filter row is greyed out. Archived defs can
  // still be CLEARED from a view but new filter values shouldn't be
  // entered; the per-type input rows remain rendered so the user
  // can edit-then-clear.
  const label = field.archivedAt ? `${field.name} (archived)` : field.name

  switch (field.fieldType) {
    case "formula":
      return null

    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={getParam("eq") === "true"}
            onChange={(e) => {
              setParam("eq", e.target.checked ? "true" : null)
            }}
          />
          {label}
        </label>
      )

    case "number":
    case "currency":
      return (
        <div className="space-y-1">
          <div className="text-xs font-medium">{label}</div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              placeholder="Min"
              value={getParam("min")}
              onChange={(e) => {
                setParam("min", e.target.value || null)
              }}
            />
            <Input
              type="number"
              placeholder="Max"
              value={getParam("max")}
              onChange={(e) => {
                setParam("max", e.target.value || null)
              }}
            />
          </div>
        </div>
      )

    case "date":
    case "datetime":
      return (
        <div className="space-y-1">
          <div className="text-xs font-medium">{label}</div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              value={getParam("from")}
              onChange={(e) => {
                setParam("from", e.target.value || null)
              }}
            />
            <Input
              type="date"
              value={getParam("to")}
              onChange={(e) => {
                setParam("to", e.target.value || null)
              }}
            />
          </div>
        </div>
      )

    case "single_select":
    case "radio": {
      const choices = field.options?.choices ?? []
      return (
        <div className="space-y-1">
          <div className="text-xs font-medium">{label}</div>
          <select
            className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm"
            value={getParam("eq")}
            onChange={(e) => {
              setParam("eq", e.target.value || null)
            }}
          >
            <option value="">— Any —</option>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )
    }

    case "multi_select": {
      const choices = field.options?.choices ?? []
      const selected = getParam("in").split(",").filter(Boolean)
      return (
        <div className="space-y-1">
          <div className="text-xs font-medium">{label}</div>
          <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-[var(--color-border)] p-2">
            {choices.map((c) => {
              const checked = selected.includes(c.value)
              return (
                <label key={c.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...selected, c.value]
                        : selected.filter((v) => v !== c.value)
                      setParam("in", next.length > 0 ? next.join(",") : null)
                    }}
                  />
                  {c.label}
                </label>
              )
            })}
          </div>
        </div>
      )
    }

    default:
      // text / multiline / email / phone / url / user_ref / contact_ref /
      // event_ref / file / image — all use "contains" against the stored
      // jsonb scalar.
      return (
        <div className="space-y-1">
          <div className="text-xs font-medium">{label}</div>
          <Input
            type="text"
            placeholder="Contains…"
            value={getParam("contains")}
            onChange={(e) => {
              setParam("contains", e.target.value || null)
            }}
          />
        </div>
      )
  }
}
