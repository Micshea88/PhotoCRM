"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Modal } from "@/components/ui/modal"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { createCompany } from "../actions"

export interface CompanyOption {
  id: string
  name: string
}

/**
 * Single-select company picker with an inline "Add company" affordance.
 *
 * Renders as a native `<select>` for accessibility + zero-dep keyboard
 * navigation. Typeahead through the dropdown is browser-native; with
 * a sub-500-company list (V1 single-studio scale) that's enough. If
 * the list grows beyond that, swap the select for a server-side
 * typeahead in PUSH 2b or later.
 *
 * Clicking "+ Add company" opens the modal, captures the name (other
 * fields are deferred to the dedicated /companies module — not in V1),
 * invokes the `createCompany` server action, and on success calls
 * `onChange(newCompanyId)` so the form picks up the new company.
 */
export function CompanyPicker({
  id,
  options,
  value,
  onChange,
  onCompanyCreated,
  allowEmpty = true,
  emptyLabel = "— No company —",
  placeholder = "Select a company",
  inlineMode = false,
  onDismiss,
}: {
  id?: string
  options: CompanyOption[]
  value: string | null
  onChange: (id: string | null) => void
  /** Called after inline create succeeds. Receives the new company so the
   * parent can update its in-memory options list. */
  onCompanyCreated?: (company: CompanyOption) => void
  allowEmpty?: boolean
  emptyLabel?: string
  placeholder?: string
  /** P3 (C6c polish #3) — render as a SearchableSelect with
   *  defaultOpen + inlineMode, no bordered chrome. The "+ Add company"
   *  affordance is omitted in inline mode; use the full edit form via
   *  Actions dropdown when a new company needs to be created. */
  inlineMode?: boolean
  /** Forwarded to SearchableSelect.onDismiss in inlineMode. */
  onDismiss?: () => void
}) {
  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sorted = useMemo(() => {
    return [...options].sort((a, b) => a.name.localeCompare(b.name))
  }, [options])

  if (inlineMode) {
    return (
      <SearchableSelect
        id={id}
        items={sorted.map((c) => ({ value: c.id, label: c.name }))}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label="Search companies"
        defaultOpen
        inlineMode
        onDismiss={onDismiss}
        allowClear={allowEmpty}
      />
    )
  }

  async function onCreate() {
    if (!name.trim()) {
      setError("Name is required.")
      return
    }
    setSubmitting(true)
    setError(null)
    const result = await createCompany({ name: name.trim() })
    setSubmitting(false)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    if (result.validationErrors) {
      setError("Please fix the form errors above.")
      return
    }
    if (result.data?.id) {
      const newCompany: CompanyOption = { id: result.data.id, name: name.trim() }
      onCompanyCreated?.(newCompany)
      onChange(newCompany.id)
      setName("")
      setModalOpen(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        id={id}
        className="h-9 flex-1 rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm shadow-sm"
        value={value ?? ""}
        onChange={(e) => {
          onChange(e.target.value === "" ? null : e.target.value)
        }}
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {!value && !allowEmpty && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {sorted.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setError(null)
          setModalOpen(true)
        }}
      >
        + Add company
      </Button>

      <Modal
        open={modalOpen}
        onClose={() => {
          if (!submitting) setModalOpen(false)
        }}
        title="Add company"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-company-name">Name</Label>
            <Input
              id="new-company-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
              }}
              placeholder="Evergreen Planning"
            />
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Other company details can be edited later from the contact detail page.
            </p>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setModalOpen(false)
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void onCreate()
              }}
              disabled={submitting}
            >
              {submitting ? "Creating…" : "Create company"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
