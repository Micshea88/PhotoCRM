import { parsePhoneInput } from "@/lib/format/phone"

/**
 * Push 4 (B1) — Duplicates detection engine. Pure functions: given
 * an array of records, return groups of records that look like
 * potential duplicates.
 *
 * Two record types ship in this push: Contacts and Companies.
 *
 * ─── CONTACTS RULES (V1) ───────────────────────────────────────────────
 *
 *   Rule 1 (Email):   primary_email OR secondary_email exact
 *                     case-insensitive; null/empty ignored.
 *   Rule 2 (Phone):   primary_phone OR secondary_phone exact via
 *                     parsePhoneInput's 10-digit normalization; null /
 *                     empty / un-parseable ignored.
 *   Rule 3 (Name+Co): first_name + last_name + primary_company_name
 *                     all three present, case-insensitive exact.
 *
 *   Tertiary phone is not in the contacts schema; spec was adjusted
 *   to match what's available.
 *
 * ─── COMPANIES RULES (HubSpot configuration; V1) ───────────────────────
 *
 *   Rule 1 (Domain):  website host exact, case-insensitive, "www."
 *                     prefix stripped. Sufficient alone.
 *   Rule 2 (Name+Phone): name case-insensitive exact AND main_phone
 *                       parsePhoneInput match.
 *   Rule 3 (Name+Industry): name case-insensitive exact AND category
 *                          case-insensitive exact. The `category`
 *                          column is the V1 industry-equivalent per
 *                          the companies schema comment.
 *
 *   TODO P4.x — restore the HubSpot Name+Country rule when companies
 *   gains an address surface. Mirror this file's rule shape: introduce
 *   a `country` normalization step + add to the company match-pairs
 *   loop.
 *
 * ─── TRANSITIVE GROUPING ───────────────────────────────────────────────
 *
 * If A↔B match by one rule and B↔C match by another, {A, B, C} is one
 * group. Built via union-find over the match-pair set.
 *
 * The output preserves the SET of matching reasons that contributed to
 * each pair so the merge UI can label them (one group can carry
 * multiple reasons across its internal edges).
 */

// ─── Public types ───────────────────────────────────────────────────

export interface ContactCandidate {
  id: string
  firstName: string | null
  lastName: string | null
  primaryEmail: string | null
  secondaryEmail: string | null
  primaryPhone: string | null
  secondaryPhone: string | null
  /** Normalised company name from the join (lowercased) — null when
   * the contact has no primary company. */
  primaryCompanyName: string | null
}

export interface CompanyCandidate {
  id: string
  name: string
  website: string | null
  mainPhone: string | null
  /** V1 industry = `companies.category` per the schema comment. */
  category: string | null
}

export type ContactMatchReason = "email" | "phone" | "name_and_company"
export type CompanyMatchReason = "domain" | "name_and_phone" | "name_and_industry"

export interface DuplicateGroup<R extends string> {
  ids: string[]
  reasons: R[]
}

// ─── Internal: union-find ────────────────────────────────────────────

class UnionFind {
  private parent = new Map<string, string>()

  private find(x: string): string {
    const cur = this.parent.get(x) ?? x
    if (cur === x) return x
    const root = this.find(cur)
    this.parent.set(x, root)
    return root
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }

  /**
   * Groups all known ids by their representative root. Ids never
   * touched by a `union` call form singleton groups; the caller
   * filters those out.
   */
  groups(allIds: Iterable<string>): Map<string, string[]> {
    const out = new Map<string, string[]>()
    for (const id of allIds) {
      const root = this.find(id)
      let arr = out.get(root)
      if (!arr) {
        arr = []
        out.set(root, arr)
      }
      arr.push(id)
    }
    return out
  }
}

// ─── Normalisers ────────────────────────────────────────────────────

function lower(s: string | null | undefined): string | null {
  if (!s) return null
  const trimmed = s.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Extract a normalized comparable token from a company website
 * column. Strips protocol, leading `www.`, anything after the first
 * slash, port. Defensive against malformed URLs: returns null on
 * parse failure.
 */
export function normalizeDomain(website: string | null | undefined): string | null {
  if (!website) return null
  const raw = website.trim()
  if (raw.length === 0) return null
  // Try the URL parser first — handles "https://www.example.com/path?q=1".
  let host: string | null = null
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`)
    host = parsed.hostname
  } catch {
    // Fall back: take the substring up to the first slash.
    host = raw.replace(/^[a-z]+:\/\//i, "").split("/")[0] ?? null
  }
  if (!host) return null
  host = host.toLowerCase()
  if (host.startsWith("www.")) host = host.slice(4)
  // Strip a trailing port if any.
  host = host.split(":")[0] ?? host
  return host.length > 0 ? host : null
}

// ─── Public: contact grouping ───────────────────────────────────────

export function findDuplicateContactGroups(
  candidates: ContactCandidate[],
): DuplicateGroup<ContactMatchReason>[] {
  const uf = new UnionFind()
  const reasonsByPair = new Map<string, Set<ContactMatchReason>>()
  function pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`
  }
  function recordPair(a: string, b: string, reason: ContactMatchReason) {
    if (a === b) return
    uf.union(a, b)
    const key = pairKey(a, b)
    let set = reasonsByPair.get(key)
    if (!set) {
      set = new Set()
      reasonsByPair.set(key, set)
    }
    set.add(reason)
  }

  // Email index: any non-null email → ids that share it.
  const byEmail = new Map<string, string[]>()
  const byPhone = new Map<string, string[]>()
  const byNameCompany = new Map<string, string[]>()

  for (const c of candidates) {
    for (const e of [c.primaryEmail, c.secondaryEmail]) {
      const norm = lower(e)
      if (!norm) continue
      let arr = byEmail.get(norm)
      if (!arr) {
        arr = []
        byEmail.set(norm, arr)
      }
      arr.push(c.id)
    }
    for (const p of [c.primaryPhone, c.secondaryPhone]) {
      const norm = parsePhoneInput(p)
      if (!norm) continue
      let arr = byPhone.get(norm)
      if (!arr) {
        arr = []
        byPhone.set(norm, arr)
      }
      arr.push(c.id)
    }
    const first = lower(c.firstName)
    const last = lower(c.lastName)
    const company = lower(c.primaryCompanyName)
    if (first && last && company) {
      const key = `${first}|${last}|${company}`
      let arr = byNameCompany.get(key)
      if (!arr) {
        arr = []
        byNameCompany.set(key, arr)
      }
      arr.push(c.id)
    }
  }

  function flushBucket(bucket: Map<string, string[]>, reason: ContactMatchReason) {
    for (const ids of bucket.values()) {
      if (ids.length < 2) continue
      // Dedupe ids within the bucket — same contact id may appear
      // twice if both emails / phones share a normalized form.
      const distinct = [...new Set(ids)]
      if (distinct.length < 2) continue
      const head = distinct[0]
      if (!head) continue
      for (let i = 1; i < distinct.length; i++) {
        const other = distinct[i]
        if (!other) continue
        recordPair(head, other, reason)
      }
      // Also pair the rest with each other (transitively handled by
      // union-find, but pairs need their reason recorded for the
      // display label set).
      for (let i = 0; i < distinct.length; i++) {
        for (let j = i + 1; j < distinct.length; j++) {
          const a = distinct[i]
          const b = distinct[j]
          if (a && b) recordPair(a, b, reason)
        }
      }
    }
  }

  flushBucket(byEmail, "email")
  flushBucket(byPhone, "phone")
  flushBucket(byNameCompany, "name_and_company")

  return collectGroups(
    candidates.map((c) => c.id),
    uf,
    reasonsByPair,
  )
}

// ─── Public: company grouping ───────────────────────────────────────

export function findDuplicateCompanyGroups(
  candidates: CompanyCandidate[],
): DuplicateGroup<CompanyMatchReason>[] {
  const uf = new UnionFind()
  const reasonsByPair = new Map<string, Set<CompanyMatchReason>>()
  function pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`
  }
  function recordPair(a: string, b: string, reason: CompanyMatchReason) {
    if (a === b) return
    uf.union(a, b)
    const key = pairKey(a, b)
    let set = reasonsByPair.get(key)
    if (!set) {
      set = new Set()
      reasonsByPair.set(key, set)
    }
    set.add(reason)
  }

  const byDomain = new Map<string, string[]>()
  const byNamePhone = new Map<string, string[]>()
  const byNameIndustry = new Map<string, string[]>()

  for (const c of candidates) {
    const domain = normalizeDomain(c.website)
    if (domain) {
      let arr = byDomain.get(domain)
      if (!arr) {
        arr = []
        byDomain.set(domain, arr)
      }
      arr.push(c.id)
    }
    const name = lower(c.name)
    const phone = parsePhoneInput(c.mainPhone)
    if (name && phone) {
      const key = `${name}|${phone}`
      let arr = byNamePhone.get(key)
      if (!arr) {
        arr = []
        byNamePhone.set(key, arr)
      }
      arr.push(c.id)
    }
    const industry = lower(c.category)
    if (name && industry) {
      const key = `${name}|${industry}`
      let arr = byNameIndustry.get(key)
      if (!arr) {
        arr = []
        byNameIndustry.set(key, arr)
      }
      arr.push(c.id)
    }
  }

  function flushBucket(bucket: Map<string, string[]>, reason: CompanyMatchReason) {
    for (const ids of bucket.values()) {
      const distinct = [...new Set(ids)]
      if (distinct.length < 2) continue
      for (let i = 0; i < distinct.length; i++) {
        for (let j = i + 1; j < distinct.length; j++) {
          const a = distinct[i]
          const b = distinct[j]
          if (a && b) recordPair(a, b, reason)
        }
      }
    }
  }

  flushBucket(byDomain, "domain")
  flushBucket(byNamePhone, "name_and_phone")
  flushBucket(byNameIndustry, "name_and_industry")

  return collectGroups(
    candidates.map((c) => c.id),
    uf,
    reasonsByPair,
  )
}

// ─── Internal: union-find → DuplicateGroup[] ────────────────────────

function collectGroups<R extends string>(
  allIds: string[],
  uf: UnionFind,
  reasonsByPair: Map<string, Set<R>>,
): DuplicateGroup<R>[] {
  const buckets = uf.groups(allIds)
  const out: DuplicateGroup<R>[] = []
  for (const ids of buckets.values()) {
    if (ids.length < 2) continue
    const reasons = new Set<R>()
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]
        const b = ids[j]
        if (!a || !b) continue
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        const s = reasonsByPair.get(key)
        if (s) for (const r of s) reasons.add(r)
      }
    }
    if (reasons.size === 0) continue
    const sortedReasons: R[] = [...reasons].sort()
    out.push({ ids: [...ids].sort(), reasons: sortedReasons })
  }
  // Stable sort: largest groups first; ties broken by lexicographic
  // first id so output is deterministic for tests.
  out.sort((a, b) => b.ids.length - a.ids.length || (a.ids[0] ?? "").localeCompare(b.ids[0] ?? ""))
  return out
}
