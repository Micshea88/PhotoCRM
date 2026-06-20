"use client"

import { useSyncExternalStore } from "react"

/**
 * The viewer's LOCAL civil date as YYYY-MM-DD, or null until hydrated.
 * Decision (Mike, 2026-06-19): task due-date colors use each user's own
 * browser-local "today" (Notion/Linear/ClickUp pattern), not a server tz.
 *
 * Implemented with useSyncExternalStore so the server snapshot is `null`
 * (SSR + the hydration render render uncolored, matching server HTML — no
 * hydration mismatch), then it re-renders with the real local date. This is
 * the idiomatic client-only-value read; it avoids a setState-in-effect.
 */
function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n)
}

// Cached so getSnapshot is referentially stable across renders (required by
// useSyncExternalStore). The date is fixed for the page session — a viewer who
// crosses midnight without reloading keeps the date they loaded with.
let cachedToday: string | null = null
function clientToday(): string {
  if (cachedToday === null) {
    const d = new Date()
    cachedToday = `${String(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  }
  return cachedToday
}

function unsubscribe(): void {
  // intentionally empty — the local date never pushes updates within a session.
}
const subscribe = (): (() => void) => unsubscribe
const getServerSnapshot = (): string | null => null

export function useToday(): string | null {
  return useSyncExternalStore(subscribe, clientToday, getServerSnapshot)
}
