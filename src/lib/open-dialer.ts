"use client"

/**
 * Main-app side of the popup dialer: opens (or focuses) the
 * authenticated /dialer popup and tells it what number to call.
 *
 * Design constraints — both must hold simultaneously:
 *   1. Popup blocker — `window.open()` must be called SYNCHRONOUSLY
 *      from the user-gesture click handler. No `await` between the
 *      click and the open, or modern browsers refuse to open it.
 *   2. Don't reload an active call — `window.open(url, name)` with a
 *      non-empty URL NAVIGATES an existing window of that name per
 *      the HTML spec, which would tear down a live WebRTC SIP
 *      session. A second dial during an active call must not cause
 *      navigation.
 *
 * Algorithm (industry-standard CTI pattern — RingCentral, Aircall,
 * Dialpad all do this):
 *
 *   A. Common-case fast path: cached `popupRef`. If we still hold a
 *      live reference from a prior open in THIS tab, focus it and
 *      send the dial via BroadcastChannel. No window.open at all.
 *
 *   B. Cache-miss probe: synchronous `window.open("", DIALER_WINDOW_NAME,
 *      POPUP_FEATURES)`. Per HTML spec, an empty URL is the no-navigate
 *      signal:
 *        - Existing window with that name → focuses it, returns the
 *          Window, does NOT navigate. (Features are ignored against
 *          an existing window — active call preserved.)
 *        - No matching window → opens a fresh about:blank with the
 *          requested features.
 *      Distinguish the two by inspecting `probe.location.href`
 *      (same-origin, so no cross-origin throw):
 *        - `=== "about:blank"` → fresh popup → assign location.href
 *          to /dialer?to=... to navigate it.
 *        - anything else → existing dialer popup → channel-dial it.
 *
 *   C. Popup blocker — `window.open()` returns `null`. Surface as
 *      `{ kind: "blocked" }` so the caller can show "please allow
 *      popups" inline. Cache + channel sends are skipped to avoid
 *      leaving the cache in a half-set state.
 *
 * Race-on-fresh-popup mitigation: the fresh popup needs to know
 * what to dial, but its BroadcastChannel listener isn't attached
 * until /dialer's React tree mounts. To avoid that race, the dial
 * intent is encoded in the URL (`?to=&contactId=&contactLabel=`);
 * the popup's init code reads URLSearchParams on boot. Subsequent
 * dials (popup already open) take the channel path where the
 * listener is guaranteed alive.
 *
 * Edge cases:
 *   - First dial of session     → probe returns about:blank → navigate.
 *   - Second dial, same session → cache hit → focus + channel dial.
 *   - User closed popup         → popupRef.closed === true → probe path.
 *   - Main-app reload mid-call  → cache lost; probe returns existing
 *     live popup (location.href is the /dialer URL, not about:blank);
 *     re-cache + channel dial. Active call preserved.
 */

import { DIALER_WINDOW_NAME, createDialerChannel, sendDial } from "@/lib/dialer-channel"

/**
 * Module-scope, per-tab, intentional. Cross-tab coordination is via
 * BroadcastChannel, not this cache — don't try to share popupRef
 * across tabs (Window objects don't structured-clone). Treat this
 * as a same-tab optimization; the probe path below is the
 * correctness path and works whether or not the cache hits.
 */
let popupRef: Window | null = null

const POPUP_FEATURES = "popup=yes,width=420,height=720"

export interface OpenDialerArgs {
  phoneNumber: string
  contactId?: string
  contactLabel?: string
}

export type OpenDialerResult = { kind: "reused" } | { kind: "opened" } | { kind: "blocked" }

export function openDialer(args: OpenDialerArgs): OpenDialerResult {
  // (A) Fast path: cache hit.
  if (popupRef && !popupRef.closed) {
    popupRef.focus()
    postDialToChannel(args)
    return { kind: "reused" }
  }

  // (B) Cache miss. Sync probe with empty URL — focuses existing
  // dialer popup of this name (no navigation) or opens about:blank
  // with the requested features.
  const probe = window.open("", DIALER_WINDOW_NAME, POPUP_FEATURES)

  // (C) Popup blocker. RETURN BEFORE any side effects (cache assign,
  // channel send) so we don't end up with a half-set cache or a
  // dial broadcast nobody will receive.
  if (probe === null) {
    return { kind: "blocked" }
  }

  // Same-origin popup, so probe.location.href is readable. about:blank
  // is the literal value Chrome/Firefox return for a freshly opened
  // window with no URL; pathname or origin checks would misfire on
  // edge values, so compare href verbatim.
  if (probe.location.href === "about:blank") {
    // Fresh popup. Encode the dial intent in the URL so the popup's
    // init code (which mounts AFTER its BroadcastChannel listener
    // attaches) reads it from URLSearchParams without a channel race.
    // Then focus and cache.
    probe.location.href = buildDialerUrl(args)
    probe.focus()
    popupRef = probe
    return { kind: "opened" }
  }

  // Existing dialer popup that we'd lost the ref to (typically: main
  // app reloaded mid-call). Re-cache + channel-dial; do NOT navigate
  // (would drop the active call).
  probe.focus()
  popupRef = probe
  postDialToChannel(args)
  return { kind: "reused" }
}

function postDialToChannel(args: OpenDialerArgs): void {
  const channel = createDialerChannel()
  try {
    sendDial(channel, args)
  } finally {
    channel.close()
  }
}

function buildDialerUrl(args: OpenDialerArgs): string {
  const params = new URLSearchParams({ to: args.phoneNumber })
  if (args.contactId) params.set("contactId", args.contactId)
  if (args.contactLabel) params.set("contactLabel", args.contactLabel)
  return `/dialer?${params.toString()}`
}
