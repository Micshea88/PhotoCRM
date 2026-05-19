#!/usr/bin/env tsx
/**
 * Idempotent dev seed.
 *
 * Creates:
 *   - Demo user (demo@pathway.local) with a working scrypt password hash
 *     that matches Better Auth's default scheme — sign in via /sign-in works.
 *   - Credential account for the demo user
 *   - Demo organization with the demo user as owner
 *   - Three sample items
 *
 * Re-running is safe — skips anything that already exists, and rewrites the
 * demo password if a previous seed left a placeholder hash.
 */

import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { and, eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { config as loadEnv } from "dotenv"
import { hashPassword } from "better-auth/crypto"
import { account, member, organization, user } from "@/modules/auth/schema"
import { items } from "@/modules/items/schema"
import { seedTerminologyForOrg } from "@/modules/terminology/seed"
import { seedMemberRoleForOrgOwner } from "@/modules/rbac/seed"
import * as schema from "@/db/schema"

loadEnv({ path: ".env.local" })

// Seed runs as the admin role. The runtime DATABASE_URL is a non-privileged
// role subject to RLS; seeding cross-org demo data + RLS-protected rows
// requires the BYPASSRLS-equipped admin role (or per-row SET LOCAL
// app.current_org gymnastics, which would be needless complexity for a dev
// seed). Refuses if the admin URL is missing.
const url = process.env.DATABASE_URL_ADMIN
if (!url) {
  console.error("DATABASE_URL_ADMIN is required (set it in .env.local).")
  process.exit(1)
}

/**
 * Refuse to seed against anything but a local Postgres. The seed inserts a
 * real user with a known password; running this against staging/prod would
 * create a backdoor account.
 *
 * Inlined here (not imported from `@/lib/db`) because importing `@/lib/db`
 * transitively loads `@/lib/env`, which validates env vars at module-load
 * time — and ESM imports run before this script's `loadEnv` call, so the
 * validator would see an empty environment.
 */
function assertLocalDbUrl(connectionString: string): void {
  let host: string
  try {
    host = new URL(connectionString).hostname
  } catch {
    throw new Error(`[seed] DATABASE_URL is not a valid URL: ${connectionString}`)
  }
  const allowed = new Set(["localhost", "127.0.0.1", "::1", "db", "postgres"])
  if (!allowed.has(host)) {
    throw new Error(
      `[seed] refuses to run: DATABASE_URL host "${host}" is not local. Seed inserts a known-password user.`,
    )
  }
}

try {
  assertLocalDbUrl(url)
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
}

const DEMO_EMAIL = "demo@pathway.local"
const DEMO_PASSWORD = "demopassword12345"
const DEMO_NAME = "Demo User"
const DEMO_ORG_SLUG = "demo-co"
const DEMO_ORG_NAME = "Demo Co"

async function main() {
  const pool = new Pool({ connectionString: url })
  const db = drizzle(pool, { schema })

  try {
    const passwordHash = await hashPassword(DEMO_PASSWORD)

    // 1. Demo user + credential account
    let demoUserId: string
    const existingUser = await db.query.user.findFirst({
      where: eq(user.email, DEMO_EMAIL),
    })

    if (existingUser) {
      demoUserId = existingUser.id
      console.log(`✓ User ${DEMO_EMAIL} already exists (${demoUserId})`)
      // Refresh the credential password so a previous broken seed becomes usable.
      const existingCredential = await db.query.account.findFirst({
        where: and(eq(account.userId, demoUserId), eq(account.providerId, "credential")),
      })
      if (existingCredential) {
        await db
          .update(account)
          .set({ password: passwordHash, updatedAt: new Date() })
          .where(eq(account.id, existingCredential.id))
        console.log(`  → Refreshed credential password`)
      } else {
        await db.insert(account).values({
          id: createId(),
          userId: demoUserId,
          accountId: demoUserId,
          providerId: "credential",
          password: passwordHash,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        console.log(`  → Added credential account`)
      }
    } else {
      demoUserId = createId()
      await db.insert(user).values({
        id: demoUserId,
        name: DEMO_NAME,
        email: DEMO_EMAIL,
        emailVerified: true,
      })
      await db.insert(account).values({
        id: createId(),
        userId: demoUserId,
        accountId: demoUserId,
        providerId: "credential",
        password: passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      console.log(`✓ Created user ${DEMO_EMAIL} with credential account`)
    }

    // 2. Demo organization + membership
    let demoOrgId: string
    const existingOrg = await db.query.organization.findFirst({
      where: eq(organization.slug, DEMO_ORG_SLUG),
    })

    if (existingOrg) {
      demoOrgId = existingOrg.id
      console.log(`✓ Org ${DEMO_ORG_SLUG} already exists (${demoOrgId})`)
    } else {
      demoOrgId = createId()
      await db.insert(organization).values({
        id: demoOrgId,
        name: DEMO_ORG_NAME,
        slug: DEMO_ORG_SLUG,
        createdAt: new Date(),
      })
      await db.insert(member).values({
        id: createId(),
        organizationId: demoOrgId,
        userId: demoUserId,
        role: "owner",
        createdAt: new Date(),
      })
      console.log(`✓ Created org ${DEMO_ORG_NAME} (${demoOrgId}) with ${DEMO_EMAIL} as owner`)
    }

    // 3. Terminology pack (idempotent; photographer pack — see modules/terminology/seed.ts)
    await seedTerminologyForOrg(db, demoOrgId)
    console.log(`✓ Seeded terminology pack for ${DEMO_ORG_SLUG}`)

    // 4. RBAC owner row (Better Auth's afterCreateOrganization hook does this
    //    in production, but the dev seed bypasses Better Auth — direct INSERT
    //    into organization + member — so we replicate the seed here.)
    await seedMemberRoleForOrgOwner(db, demoOrgId, demoUserId)
    console.log(`✓ Seeded rbac owner row for ${DEMO_ORG_SLUG}`)

    // 5. Demo items
    const existingItems = await db.query.items.findMany({
      where: eq(items.organizationId, demoOrgId),
    })

    if (existingItems.length === 0) {
      const samples = [
        { name: "Welcome to Pathway", status: "active" as const },
        { name: "First draft idea", status: "draft" as const },
        { name: "An archived thought", status: "archived" as const },
      ]
      for (const sample of samples) {
        await db.insert(items).values({
          id: createId(),
          organizationId: demoOrgId,
          name: sample.name,
          description: "Seed item.",
          status: sample.status,
          createdBy: demoUserId,
          updatedBy: demoUserId,
        })
      }
      console.log(`✓ Inserted ${String(samples.length)} demo items`)
    } else {
      console.log(`✓ ${String(existingItems.length)} items already in ${DEMO_ORG_SLUG}`)
    }

    console.log("\nSeed complete. Sign in with:")
    console.log(`  email:    ${DEMO_EMAIL}`)
    console.log(`  password: ${DEMO_PASSWORD}`)
  } finally {
    await pool.end()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
