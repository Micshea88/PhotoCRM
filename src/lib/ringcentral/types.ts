/**
 * RingCentral REST API response shapes used by the rc-sync layer.
 *
 * Hand-written minimal subsets of the real payloads — only the fields we
 * consume. Verified against RC's call-log + telephony-session + subscription
 * docs (2026-06). The single `RingCentralClient` parses raw JSON into these;
 * everything downstream is typed.
 */

/** A phone party on a call-log record (caller or callee). */
export interface RcCallParty {
  phoneNumber?: string
  name?: string
  location?: string
}

/** Recording handle attached to a call-log record when one exists. */
export interface RcRecording {
  id: string
  /** Authenticated URL to fetch the audio (`.../recording/{id}/content`). Expiring. */
  contentUri: string
  type?: string // e.g. "OnDemand" | "Automatic"
}

/**
 * One call-log record. `GET /restapi/v1.0/account/~/call-log/{id}?view=Detailed`
 * or an item from the list endpoint. `telephonySessionId` is the join key with
 * webhook telephony/sessions events; `id` is the stable `rc_call_id`.
 */
export interface RcCallLogRecord {
  id: string
  sessionId?: string
  telephonySessionId?: string
  startTime: string // ISO 8601
  /** Talk/connection duration in SECONDS (RC's measured truth). */
  duration?: number
  /** "Inbound" | "Outbound". */
  direction?: string
  /** Human result, e.g. "Call connected" | "Missed" | "Voicemail" | "Busy". */
  result?: string
  /** RC's last-modified timestamp — the monotonicity guard for reconciliation. */
  lastModifiedTime?: string
  from?: RcCallParty
  to?: RcCallParty
  recording?: RcRecording
}

/** List response wrapper for the call-log endpoint. */
export interface RcCallLogListResponse {
  records: RcCallLogRecord[]
  paging?: { page?: number; perPage?: number; totalPages?: number; totalElements?: number }
}

/**
 * Account-level telephony/sessions webhook event body. We only need enough to
 * detect a finished call and enqueue a sync job keyed by the session id; the
 * authoritative data is then pulled from the call-log.
 */
export interface RcTelephonySessionEvent {
  uuid: string
  event: string // the event filter that fired
  timestamp?: string
  subscriptionId?: string
  body: {
    telephonySessionId?: string
    sessionId?: string
    serverId?: string
    /** "Setup" | "Proceeding" | "Answered" | "Disconnected" | ... */
    parties?: {
      status?: { code?: string; reason?: string }
      direction?: string
      from?: RcCallParty
      to?: RcCallParty
    }[]
  }
}

/** Response from creating/renewing a webhook subscription. */
export interface RcSubscriptionResponse {
  id: string
  status: string // "Active" | ...
  creationTime?: string
  expirationTime?: string
  eventFilters?: string[]
  deliveryMode?: { transportType?: string; address?: string }
}
