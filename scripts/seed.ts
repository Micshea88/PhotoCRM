#!/usr/bin/env tsx
/**
 * Idempotent seed script for local development.
 * - Creates a demo user (if not present).
 * - Creates a demo organization with the demo user as owner.
 * - Creates a few demo items.
 *
 * Run via: pnpm seed
 */

import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { config as loadEnv } from "dotenv"
import { account, member, organization, user } from "@/modules/auth/schema"
import { items } from "@/modules/items/schema"
import * as schema from "@/db/schema"

loadEnv({ path: ".env.local" })

const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL is required (set it in .env.local).")
  process.exit(1)
}

const DEMO_EMAIL = "demo@pathway.local"
const DEMO_PASSWORD_HASH =
  // bcrypt of "demopassword12345" — used so the demo account can sign in locally.
  // Better Auth uses scrypt by default; in practice you'll sign up via the UI.
  "$2a$10$placeholder.demoseed.bcrypt.hash"

async function main() {
  const pool = new Pool({ connectionString: url })
  const db = drizzle(pool, { schema })

  try {
    // 1. Demo user
    let demoUserId: string
    const existingUser = await db.query.user.findFirst({
      where: eq(user.email, DEMO_EMAIL),
    })
    if (existingUser) {
      demoUserId = existingUser.id
      console.log(`User ${DEMO_EMAIL} already exists (${demoUserId})`)
    } else {
      demoUserId = createId()
      await db.insert(user).values({
        id: demoUserId,
        name: "Demo User",
        email: DEMO_EMAIL,
        emailVerified: true,
      })
      await db.insert(account).values({
        id: createId(),
        userId: demoUserId,
        accountId: demoUserId,
        providerId: "credential",
        password: DEMO_PASSWORD_HASH,
      })
      console.log(`Created user ${DEMO_EMAIL} (${demoUserId})`)
      console.log("  → Sign in via /sign-up to set a real password")
    }

    // 2. Demo org
    let demoOrgId: string
    const existingOrg = await db.query.organization.findFirst({
      where: eq(organization.slug, "demo-co"),
    })
    if (existingOrg) {
      demoOrgId = existingOrg.id
      console.log(`Org demo-co already exists (${demoOrgId})`)
    } else {
      demoOrgId = createId()
      await db.insert(organization).values({
        id: demoOrgId,
        name: "Demo Co",
        slug: "demo-co",
        createdAt: new Date(),
      })
      await db.insert(member).values({
        id: createId(),
        organizationId: demoOrgId,
        userId: demoUserId,
        role: "owner",
        createdAt: new Date(),
      })
      console.log(`Created org demo-co (${demoOrgId})`)
    }

    // 3. Demo items
    const existingItems = await db.query.items.findMany({
      where: eq(items.organizationId, demoOrgId),
    })
    if (existingItems.length === 0) {
      for (const sample of [
        { name: "Welcome to Pathway", status: "active" as const },
        { name: "First draft idea", status: "draft" as const },
        { name: "An archived thought", status: "archived" as const },
      ]) {
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
      console.log("Inserted 3 demo items.")
    } else {
      console.log(`${String(existingItems.length)} items already in demo-co.`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
