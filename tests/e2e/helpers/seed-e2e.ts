import { Pool } from "pg"

/**
 * E2E seed helpers — insert domain rows directly for a signed-up user's org.
 *
 * The test Postgres role is a superuser, so these raw inserts bypass RLS (the
 * same way `reset-db.ts` truncates). Used by the Phase-0 reskin guardrail specs
 * that need a populated bell dropdown / a contact detail page a fresh signup
 * doesn't have.
 */

async function resolveOrgUser(pool: Pool, email: string): Promise<{ userId: string; orgId: string }> {
  const u = await pool.query<{ id: string }>(`select id from "user" where email = $1 limit 1`, [email])
  const userId = u.rows[0]?.id
  if (!userId) throw new Error(`seed-e2e: no user for ${email}`)
  const m = await pool.query<{ organization_id: string }>(
    `select organization_id from "member" where user_id = $1 limit 1`,
    [userId],
  )
  const orgId = m.rows[0]?.organization_id
  if (!orgId) throw new Error(`seed-e2e: no org membership for ${email}`)
  return { userId, orgId }
}

export interface SeedNotificationOpts {
  type?: string
  category?: string
  title?: string
  /** Pass null explicitly for a no-body (shortest) row. */
  body?: string | null
}

/** Insert one UNREAD notification (read_at NULL) for the user's org. */
export async function seedUnreadNotification(
  connectionString: string,
  email: string,
  opts: SeedNotificationOpts = {},
): Promise<string> {
  const pool = new Pool({ connectionString, max: 1 })
  try {
    const { userId, orgId } = await resolveOrgUser(pool, email)
    const id = `notif_e2e_${String(Date.now())}_${Math.random().toString(36).slice(2, 8)}`
    await pool.query(
      `insert into notifications
         (id, organization_id, recipient_user_id, type, category, tier, title, body, source_module, read_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL)`,
      [
        id,
        orgId,
        userId,
        opts.type ?? "payment.received",
        opts.category ?? "payments",
        "routine",
        opts.title ?? "Payment received",
        opts.body === undefined ? "A deposit landed for an upcoming session." : opts.body,
        "email",
      ],
    )
    return id
  } finally {
    await pool.end()
  }
}

/** Insert one contact for the user's org; returns its id. */
export async function seedContact(
  connectionString: string,
  email: string,
  opts: { firstName?: string; lastName?: string } = {},
): Promise<string> {
  const pool = new Pool({ connectionString, max: 1 })
  try {
    const { orgId } = await resolveOrgUser(pool, email)
    const id = `contact_e2e_${String(Date.now())}_${Math.random().toString(36).slice(2, 8)}`
    await pool.query(
      `insert into contacts (id, organization_id, first_name, last_name)
       values ($1,$2,$3,$4)`,
      [id, orgId, opts.firstName ?? "Jane", opts.lastName ?? "Smith"],
    )
    return id
  } finally {
    await pool.end()
  }
}
