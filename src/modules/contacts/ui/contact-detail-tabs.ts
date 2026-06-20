/**
 * Contact-detail tab identity — shared by the server page (which reads the
 * `?tab=` search param and normalizes it per surface) and the two client tab
 * shells (desktop ContactDetailCenter + mobile ContactDetailMobile).
 *
 * FIX 1 (Mike, 2026-06-19): the active tab lives in the URL so a server action
 * + router.refresh (e.g. adding a task) keeps the user on their current tab
 * instead of snapping back to the default. The two surfaces share the URL value
 * but have different valid sets, so each normalizes independently — an unknown
 * or other-surface value falls back to that surface's default tab.
 *
 * The canonical value for the activity tab is the SINGULAR "activity" (shared
 * by both surfaces); "tasks" is also shared, so a deep-link to ?tab=tasks lands
 * on Tasks on either surface.
 */
export type DesktopTab = "overview" | "activity" | "tasks"
export type MobileTab = "about" | "activity" | "tasks" | "associations"

export const DESKTOP_TABS: DesktopTab[] = ["overview", "activity", "tasks"]
export const MOBILE_TABS: MobileTab[] = ["about", "activity", "tasks", "associations"]

export const DESKTOP_DEFAULT_TAB: DesktopTab = "overview"
export const MOBILE_DEFAULT_TAB: MobileTab = "activity"

export function normalizeDesktopTab(raw: string | undefined): DesktopTab {
  return (DESKTOP_TABS as string[]).includes(raw ?? "") ? (raw as DesktopTab) : DESKTOP_DEFAULT_TAB
}

export function normalizeMobileTab(raw: string | undefined): MobileTab {
  return (MOBILE_TABS as string[]).includes(raw ?? "") ? (raw as MobileTab) : MOBILE_DEFAULT_TAB
}
