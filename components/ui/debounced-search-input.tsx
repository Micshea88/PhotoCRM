"use client"

import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * Search input that debounces its committed value (300ms default — matches the
 * existing contacts-filter-bar). Local state drives the field while typing;
 * `onDebouncedChange` fires once typing pauses. Reusable primitive — the task
 * filter strip uses it now, the Activity feed filter strip (memory #12) later.
 *
 * External `value` changes (e.g. "Clear all filters" emptying the search) are
 * adopted via the React "adjust state during render" pattern (compare to the
 * previously-seen prop), NOT a setState-in-effect — keeps the lint rule happy
 * and avoids a cursor-jumping remount while typing.
 */
export function DebouncedSearchInput({
  value,
  onDebouncedChange,
  placeholder,
  delayMs = 300,
  className,
  testId,
}: {
  value: string
  onDebouncedChange: (value: string) => void
  placeholder?: string
  delayMs?: number
  className?: string
  testId?: string
}) {
  const [local, setLocal] = useState(value)
  const [seenValue, setSeenValue] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Adopt an externally-changed value (Clear all / pill removal) at render time.
  if (value !== seenValue) {
    setSeenValue(value)
    setLocal(value)
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  function onType(next: string) {
    setLocal(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      onDebouncedChange(next)
    }, delayMs)
  }

  return (
    <Input
      type="search"
      value={local}
      placeholder={placeholder}
      onChange={(e) => {
        onType(e.target.value)
      }}
      className={cn(className)}
      data-testid={testId}
    />
  )
}
