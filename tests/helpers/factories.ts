import { createId } from "@paralleldrive/cuid2"
import type { TestDb } from "./db"
import { account, member, organization, user } from "@/modules/auth/schema"

export async function createUser(
  db: TestDb,
  overrides: Partial<{ name: string; email: string }> = {},
) {
  const id = createId()
  await db.insert(user).values({
    id,
    name: overrides.name ?? `User ${id.slice(0, 6)}`,
    email: overrides.email ?? `${id.slice(0, 8)}@example.com`,
    emailVerified: true,
  })
  return id
}

export async function createOrganization(
  db: TestDb,
  ownerUserId: string,
  overrides: Partial<{ name: string; slug: string }> = {},
) {
  const id = createId()
  const slug = overrides.slug ?? `org-${id.slice(0, 6)}`
  await db.insert(organization).values({
    id,
    name: overrides.name ?? `Org ${id.slice(0, 6)}`,
    slug,
    createdAt: new Date(),
  })
  await db.insert(member).values({
    id: createId(),
    organizationId: id,
    userId: ownerUserId,
    role: "owner",
    createdAt: new Date(),
  })
  return id
}

export async function createCredentialAccount(db: TestDb, userId: string, password: string) {
  await db.insert(account).values({
    id: createId(),
    userId,
    accountId: userId,
    providerId: "credential",
    password,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}
