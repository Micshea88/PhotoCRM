import "server-only"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { DEFAULT_SHARE_LINK_EXPIRATION } from "@/modules/files/share-link-core"
import { orgPreferences } from "./schema"

/** The org's default share-link expiration option, or the system default
 *  ("1 month") when no preferences row exists yet. */
export async function getDefaultShareExpiration(orgId: string): Promise<string> {
  const [row] = await db
    .select({ exp: orgPreferences.defaultShareLinkExpiration })
    .from(orgPreferences)
    .where(eq(orgPreferences.organizationId, orgId))
    .limit(1)
  return row?.exp ?? DEFAULT_SHARE_LINK_EXPIRATION
}
