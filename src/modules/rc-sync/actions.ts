"use server"

import { z } from "zod"
import { orgAction } from "@/lib/safe-action"
import { enqueueRcSyncJob } from "@/modules/rc-sync/queries"
import { isRcSyncEnabled, kickRcSyncConsumer } from "@/modules/rc-sync/runner"

const enqueueCallSyncInput = z.object({
  telephonySessionId: z.string().min(1),
})

/**
 * Layer 2 producer. Called by the dialer after a Pathway-witnessed call is
 * logged: enqueues a `call_log` sync job keyed by the telephony session id
 * (the precise Rule-0 reconciliation key) and kicks the consumer.
 *
 * Best-effort + flag-gated: when RC_SYNC_ENABLED is off it's a no-op, so the
 * dialer can call it unconditionally. No audit (operational queue insert, not
 * a user-facing resource); no revalidate (no rendered page changes here — the
 * row's disposition badge re-renders when the worker writes RC truth and the
 * activity feed refetches).
 */
export const enqueueCallSync = orgAction
  .metadata({ actionName: "rc_sync.enqueue_call" })
  .inputSchema(enqueueCallSyncInput)
  .action(async ({ parsedInput, ctx }) => {
    if (!isRcSyncEnabled()) return { skipped: true as const }
    await enqueueRcSyncJob(ctx.db, {
      organizationId: ctx.activeOrg.id,
      kind: "call_log",
      telephonySessionId: parsedInput.telephonySessionId,
    })
    kickRcSyncConsumer()
    return { ok: true as const }
  })
