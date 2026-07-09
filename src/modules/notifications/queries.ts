import "server-only"
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { notifications, notificationPreferences } from "./schema"
import type { Notification, NotificationPreference } from "./schema"
import { contacts } from "@/modules/contacts/schema"
import { NEEDS_ACTION_TYPES } from "./types"

/** A lightweight contact option for the notification filter contact picker. */
export interface NotificationContactOption {
  id: string
  name: string
}

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Escape Postgres ILIKE/LIKE pattern special characters (`%`, `_`, `\`) so a
 * user-supplied search term is treated as a literal substring. Drizzle already
 * parameterises the value (no injection risk), but without this escaping a
 * user who types `%` or `_` gets Postgres wildcard semantics instead of a
 * literal match.
 */
function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
}

/**
 * A notification row augmented with the linked contact's display name
 * (null when contactId IS NULL or the contact has been hard-deleted).
 */
export type NotificationWithContact = Notification & { contactName: string | null }

export interface NotificationFilter {
  preset?: "all" | "unread" | "needs_attention"
  /** Filter to these type keys (OR within the list). */
  types?: string[]
  /** Only notifications linked to this contact. */
  contactId?: string
  /** created_at range lower bound (inclusive). */
  from?: Date
  /** created_at range upper bound (inclusive). */
  to?: Date
  /**
   * Case-insensitive free-text search over notification title AND body (OR-
   * combined). AND-combined with all other filters.
   */
  q?: string
  /**
   * Sort order on created_at. Default "newest" (desc). "oldest" = asc.
   */
  sort?: "newest" | "oldest"
  /** Default 50. */
  limit?: number
  /** Simple offset pagination. Default 0. */
  offset?: number
}

/**
 * "Live" definition:
 *   archived_at IS NULL  AND  (snoozed_until IS NULL OR snoozed_until <= now())
 *
 * A snoozed row whose snoozed_until has passed in the past is live again.
 * An archived row is never live regardless of snoozed_until.
 */
function livePredicate() {
  return and(
    isNull(notifications.archivedAt),
    or(isNull(notifications.snoozedUntil), lte(notifications.snoozedUntil, sql`now()`)),
  )
}

/**
 * Count of live unread notifications for the given user in the given org.
 * Caller is responsible for setting up RLS context (app.current_org / app.current_user_id)
 * on the provided db handle before calling. The explicit WHERE clause on
 * organization_id + recipient_user_id provides clarity and index alignment;
 * RLS enforces the same constraint as an additional safety net.
 */
export async function unreadCount(db: DbHandle, orgId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ cnt: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, orgId),
        eq(notifications.recipientUserId, userId),
        livePredicate(),
        isNull(notifications.readAt),
      ),
    )
  return row?.cnt ?? 0
}

/**
 * List live notifications for the given user, with optional preset + stacking filters.
 *
 * Presets:
 *   all             — all live rows (default)
 *   unread          — live rows where read_at IS NULL
 *   needs_attention — live + unread + type ∈ NEEDS_ACTION_TYPES
 *
 * Additional filters (all combine with AND; types list is OR-within):
 *   types      — only notifications of these types
 *   contactId  — only notifications linked to this contact
 *   from / to  — created_at range (inclusive)
 *   limit      — default 50
 *   offset     — default 0
 *
 * Results ordered by created_at DESC.
 */
export async function listNotifications(
  db: DbHandle,
  orgId: string,
  userId: string,
  filter: NotificationFilter = {},
): Promise<NotificationWithContact[]> {
  const {
    preset = "all",
    types,
    contactId,
    from,
    to,
    q,
    sort = "newest",
    limit = 50,
    offset = 0,
  } = filter

  const rows = await db
    .select({
      // All notification columns
      id: notifications.id,
      organizationId: notifications.organizationId,
      recipientUserId: notifications.recipientUserId,
      type: notifications.type,
      category: notifications.category,
      tier: notifications.tier,
      title: notifications.title,
      body: notifications.body,
      linkPath: notifications.linkPath,
      contactId: notifications.contactId,
      payload: notifications.payload,
      sourceModule: notifications.sourceModule,
      readAt: notifications.readAt,
      archivedAt: notifications.archivedAt,
      snoozedUntil: notifications.snoozedUntil,
      scheduledFor: notifications.scheduledFor,
      emailSentAt: notifications.emailSentAt,
      createdAt: notifications.createdAt,
      updatedAt: notifications.updatedAt,
      // Contact anchor name (null when no linked contact)
      contactName: sql<string | null>`
        CASE WHEN ${contacts.id} IS NOT NULL
          THEN trim(${contacts.firstName} || ' ' || ${contacts.lastName})
          ELSE NULL
        END
      `.as("contact_name"),
    })
    .from(notifications)
    .leftJoin(contacts, eq(notifications.contactId, contacts.id))
    .where(
      and(
        eq(notifications.organizationId, orgId),
        eq(notifications.recipientUserId, userId),
        livePredicate(),
        // Preset conditions
        preset === "unread" ? isNull(notifications.readAt) : undefined,
        preset === "needs_attention" ? isNull(notifications.readAt) : undefined,
        preset === "needs_attention" && NEEDS_ACTION_TYPES.length > 0
          ? inArray(notifications.type, NEEDS_ACTION_TYPES)
          : undefined,
        // Stacking filters (AND with preset)
        types && types.length > 0 ? inArray(notifications.type, types) : undefined,
        contactId ? eq(notifications.contactId, contactId) : undefined,
        from ? gte(notifications.createdAt, from) : undefined,
        to ? lte(notifications.createdAt, to) : undefined,
        // Free-text search: ilike over title OR body (null body → body leg is NULL, OR-skips it).
        // escapeLikePattern ensures literal % and _ in the user's term are not treated as
        // Postgres wildcards — Drizzle parameterises the value so there is no injection risk,
        // but without escaping `%`-only or `_`-only searches would match every row.
        q?.trim()
          ? or(
              ilike(notifications.title, `%${escapeLikePattern(q.trim())}%`),
              ilike(notifications.body, `%${escapeLikePattern(q.trim())}%`),
            )
          : undefined,
      ),
    )
    .orderBy(sort === "oldest" ? asc(notifications.createdAt) : desc(notifications.createdAt))
    .limit(limit)
    .offset(offset)

  return rows
}

/**
 * List archived notifications for the given user (archived_at IS NOT NULL),
 * newest-first. For the Archive tab.
 */
export async function listArchivedNotifications(
  db: DbHandle,
  orgId: string,
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<NotificationWithContact[]> {
  const { limit = 50, offset = 0 } = opts
  return db
    .select({
      id: notifications.id,
      organizationId: notifications.organizationId,
      recipientUserId: notifications.recipientUserId,
      type: notifications.type,
      category: notifications.category,
      tier: notifications.tier,
      title: notifications.title,
      body: notifications.body,
      linkPath: notifications.linkPath,
      contactId: notifications.contactId,
      payload: notifications.payload,
      sourceModule: notifications.sourceModule,
      readAt: notifications.readAt,
      archivedAt: notifications.archivedAt,
      snoozedUntil: notifications.snoozedUntil,
      scheduledFor: notifications.scheduledFor,
      emailSentAt: notifications.emailSentAt,
      createdAt: notifications.createdAt,
      updatedAt: notifications.updatedAt,
      contactName: sql<string | null>`
        CASE WHEN ${contacts.id} IS NOT NULL
          THEN trim(${contacts.firstName} || ' ' || ${contacts.lastName})
          ELSE NULL
        END
      `.as("contact_name"),
    })
    .from(notifications)
    .leftJoin(contacts, eq(notifications.contactId, contacts.id))
    .where(
      and(
        eq(notifications.organizationId, orgId),
        eq(notifications.recipientUserId, userId),
        isNotNull(notifications.archivedAt),
      ),
    )
    .orderBy(desc(notifications.archivedAt))
    .limit(limit)
    .offset(offset)
}

/**
 * List currently-snoozed notifications for the given user
 * (archivedAt IS NULL AND snoozedUntil IS NOT NULL AND snoozedUntil > now()).
 * Rows whose snooze has already elapsed are NOT included (they're live again).
 * Ordered by snoozedUntil ASC (soonest-to-wake first). For the Snoozed tab.
 */
export async function listSnoozedNotifications(
  db: DbHandle,
  orgId: string,
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<NotificationWithContact[]> {
  const { limit = 50, offset = 0 } = opts
  return db
    .select({
      id: notifications.id,
      organizationId: notifications.organizationId,
      recipientUserId: notifications.recipientUserId,
      type: notifications.type,
      category: notifications.category,
      tier: notifications.tier,
      title: notifications.title,
      body: notifications.body,
      linkPath: notifications.linkPath,
      contactId: notifications.contactId,
      payload: notifications.payload,
      sourceModule: notifications.sourceModule,
      readAt: notifications.readAt,
      archivedAt: notifications.archivedAt,
      snoozedUntil: notifications.snoozedUntil,
      scheduledFor: notifications.scheduledFor,
      emailSentAt: notifications.emailSentAt,
      createdAt: notifications.createdAt,
      updatedAt: notifications.updatedAt,
      contactName: sql<string | null>`
        CASE WHEN ${contacts.id} IS NOT NULL
          THEN trim(${contacts.firstName} || ' ' || ${contacts.lastName})
          ELSE NULL
        END
      `.as("contact_name"),
    })
    .from(notifications)
    .leftJoin(contacts, eq(notifications.contactId, contacts.id))
    .where(
      and(
        eq(notifications.organizationId, orgId),
        eq(notifications.recipientUserId, userId),
        isNull(notifications.archivedAt),
        isNotNull(notifications.snoozedUntil),
        gt(notifications.snoozedUntil, sql`now()`),
      ),
    )
    .orderBy(asc(notifications.snoozedUntil))
    .limit(limit)
    .offset(offset)
}

/**
 * Mark all live read notifications as unread for the given user in the given org.
 * Targets only live rows (same predicate as markAllNotificationsRead).
 * Returns the IDs of affected rows. Caller must set up RLS context before calling.
 */
export async function markAllNotificationsUnreadForUser(
  db: DbHandle,
  orgId: string,
  userId: string,
): Promise<{ id: string }[]> {
  return db
    .update(notifications)
    .set({ readAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(notifications.organizationId, orgId),
        eq(notifications.recipientUserId, userId),
        isNotNull(notifications.readAt),
        livePredicate(),
      ),
    )
    .returning({ id: notifications.id })
}

/**
 * Return the DISTINCT contacts that appear in live notifications for the given
 * user in the given org. Used to populate the contact filter picker on the
 * /notifications page. Returns a small, recipient-scoped set — never an org-
 * wide dump. Excludes soft-deleted contacts. Ordered by display name.
 *
 * Caller is responsible for setting up RLS context before calling.
 */
export async function listNotificationContactsForUser(
  db: DbHandle,
  orgId: string,
  userId: string,
): Promise<NotificationContactOption[]> {
  const nameExpr = sql<string>`trim(${contacts.firstName} || ' ' || ${contacts.lastName})`
  const rows = await db
    .select({
      id: contacts.id,
      name: nameExpr,
    })
    .from(notifications)
    .innerJoin(contacts, eq(notifications.contactId, contacts.id))
    .where(
      and(
        eq(notifications.organizationId, orgId),
        eq(notifications.recipientUserId, userId),
        livePredicate(),
        isNull(contacts.deletedAt),
      ),
    )
    .groupBy(contacts.id, contacts.firstName, contacts.lastName)
    .orderBy(nameExpr)
  return rows
}

/**
 * Task 15F — Return all stored notification preferences for the given user.
 * Includes the `mobile` column added in Task 15F part 3. Rows not present in
 * this result have no override — callers should fall back to the registry
 * defaultChannels for those types.
 */
export async function getNotificationPreferences(
  db: DbHandle,
  orgId: string,
  userId: string,
): Promise<NotificationPreference[]> {
  return db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.organizationId, orgId),
        eq(notificationPreferences.userId, userId),
      ),
    )
}
