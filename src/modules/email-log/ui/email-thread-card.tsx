"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Mail } from "lucide-react"
import { cn } from "@/lib/utils"
import { groupEmailsByThread } from "@/modules/email-log/threading"

/**
 * EmailThreadCard (Commit 3, Phase C).
 *
 * Collapses a contact's email_log rows that share a `threadId` into a single
 * "Thread (N replies)" card — the gmail/HubSpot conversation view. Newest
 * thread first; within an expanded thread, messages run oldest→newest.
 *
 * NOT user-reachable in Commit 3/4: the feed only renders this when the
 * `athread` URL param is present (the threading pipeline writes thread_ids now,
 * but the grouped UI is gated until Commit 5 wires it into the feed). Built and
 * unit-tested in isolation here so Commit 5 is a pure wiring change.
 */

export interface EmailThreadEntry {
  id: string
  threadId?: string | null
  timestamp: Date
  subject?: string | null
  body?: string | null
  /** "inbound" | "outbound" — drives the from/to affordance. */
  direction?: string | null
  actor?: string | null
}

function directionLabel(direction: string | null | undefined): string {
  if (direction === "inbound") return "Received"
  if (direction === "outbound") return "Sent"
  return "Email"
}

function formatWhen(t: Date): string {
  return t.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function ThreadMessage({ message }: { message: EmailThreadEntry }) {
  return (
    <div className="border-muted border-l-2 py-1.5 pl-3">
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <span className="text-foreground font-medium">{directionLabel(message.direction)}</span>
        {message.actor ? <span>· {message.actor}</span> : null}
        <span>· {formatWhen(message.timestamp)}</span>
      </div>
      {message.body ? (
        <p className="text-foreground mt-1 text-sm whitespace-pre-wrap">{message.body}</p>
      ) : null}
    </div>
  )
}

function SingleThread({ messages }: { messages: EmailThreadEntry[] }) {
  const [expanded, setExpanded] = useState(false)
  const root = messages[0]
  if (!root) return null
  const replyCount = messages.length - 1
  const trimmedSubject = root.subject?.trim()
  const subject = trimmedSubject && trimmedSubject.length > 0 ? trimmedSubject : "(no subject)"

  // Singleton (no replies) → render the one message flat, no expander.
  if (replyCount === 0) {
    return (
      <div data-testid="email-thread-card" className="bg-card rounded-md border p-3">
        <div className="flex items-center gap-2">
          <Mail className="text-muted-foreground size-4" aria-hidden="true" />
          <span className="text-sm font-medium">{subject}</span>
        </div>
        <div className="mt-2">
          <ThreadMessage message={root} />
        </div>
      </div>
    )
  }

  return (
    <div data-testid="email-thread-card" className="bg-card rounded-md border p-3">
      <button
        type="button"
        onClick={() => {
          setExpanded((v) => !v)
        }}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 text-left"
      >
        {expanded ? (
          <ChevronDown className="text-muted-foreground size-4" aria-hidden="true" />
        ) : (
          <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
        )}
        <Mail className="text-muted-foreground size-4" aria-hidden="true" />
        <span className="text-sm font-medium">{subject}</span>
        <span className="bg-muted text-muted-foreground text-3xs ml-auto shrink-0 rounded-full px-2 py-0.5 font-medium">
          Thread ({String(replyCount)} {replyCount === 1 ? "reply" : "replies"})
        </span>
      </button>

      {expanded ? (
        <div className="mt-3 space-y-2">
          {messages.map((m) => (
            <ThreadMessage key={m.id} message={m} />
          ))}
        </div>
      ) : (
        // Collapsed: show only the most recent message as a preview.
        <div className={cn("mt-2")}>
          <ThreadMessage message={messages[messages.length - 1] ?? root} />
        </div>
      )}
    </div>
  )
}

/** Renders all email entries grouped into threads. */
export function EmailThreadList({ emails }: { emails: EmailThreadEntry[] }) {
  const groups = groupEmailsByThread(emails)
  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <SingleThread key={g.threadId} messages={g.messages} />
      ))}
    </div>
  )
}
