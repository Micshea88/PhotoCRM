import { parsePhoneInput } from "@/lib/format/phone"

/**
 * Push 4 (B1) + Push 4 followup — Duplicates detection engine.
 *
 * Pure functions: given an array of candidate records, return groups
 * of records that look like potential duplicates.
 *
 * ─── CONTACTS (Push 4 followup) ────────────────────────────────────────
 *
 * Upgraded from the V1 "3 exact-match rules" model to HubSpot-parity
 * **weighted similarity scoring** over the contact fields we have.
 * Mike's direction (supersedes the prior V1 decision): "do the same
 * as HubSpot." Detection-only change inside this module; merge UI,
 * companies matching, and the AI pipeline are untouched.
 *
 * Signals (all pure):
 *   - emailExact         any email vs any email, lowercased+trimmed
 *   - emailSameLocal     same local-part across domains
 *                        (weeeendy@yoohoo.uk vs .com)
 *   - emailFuzzy         Jaro-Winkler on the full normalized email
 *   - nameSimilarity     Jaro-Winkler on "first last"; also try
 *                        "last first" and take the max
 *   - phoneExact         any normalized 10-digit vs any
 *   - companySimilarity  Jaro-Winkler on normalized company name
 *
 * Surface rule (deterministic; thresholds below):
 *   A pair surfaces ONLY if:
 *     emailExact OR phoneExact
 *     OR ( nameSimilarity >= NAME_SIM_FLOOR
 *          AND ( emailSameLocal OR emailFuzzy OR phoneExact
 *                OR companySimilarity ) )
 *
 *   -> Name similarity alone NEVER surfaces a pair. This prevents
 *      flagging every "John Smith" against every other "John Smith".
 *
 * Per-pair human-readable reason (HubSpot-style):
 *   - "Same email"             (emailExact)
 *   - "Similar email"          (emailSameLocal or emailFuzzy without name)
 *   - "Same phone"             (phoneExact)
 *   - "Similar name and email" (nameSim + email signal)
 *   - "Similar name and phone" (nameSim + phoneExact)
 *   - "Similar name and company" (nameSim + companySim)
 *
 * Schema gap (surfaced to Mike): HubSpot's matching also uses IP
 * country + zip. The contacts table has `mailing_address` jsonb but
 * no normalized country/zip column. Omitted for V1 of this rework;
 * if we want full HubSpot parity we'd extract zip + (eventually)
 * country from the jsonb. Captured upcoming.
 *
 * ─── COMPANIES (V1, UNCHANGED) ────────────────────────────────────────
 *
 *   Rule 1 (Domain):   website host exact, case-insensitive, "www."
 *                      prefix stripped. Sufficient alone.
 *   Rule 2 (Name+Phone): name case-insensitive exact AND main_phone
 *                       parsePhoneInput match.
 *   Rule 3 (Name+Industry): name case-insensitive exact AND category
 *                           case-insensitive exact.
 *
 *   Future: extend to similarity scoring (HubSpot is also fuzzy for
 *   companies) — surfaced separately, not done here.
 *
 * ─── TRANSITIVE GROUPING ───────────────────────────────────────────────
 *
 * If A↔B match and B↔C match, {A, B, C} is one group. Union-find
 * over the surfaced pair set. Group reasons = union of pair reasons.
 */

// ─── Tunable thresholds (top-of-file so Mike can adjust post-smoke) ─

/** Minimum Jaro-Winkler on the "first last" token for the name+other
 *  composite rule to fire. 0.92 keeps "Wendy Feldposh" vs "Wendy
 *  Feldposh f" together while rejecting "John Smith" vs "John Doe". */
export const NAME_SIM_FLOOR = 0.92
/** Minimum Jaro-Winkler on the full normalized email when the local-
 *  parts differ. 0.90 catches "wendy@a.com" vs "wendyf@a.com". */
export const EMAIL_FUZZY_FLOOR = 0.9
/** Minimum Jaro-Winkler on the normalized company name. 0.9 keeps
 *  "K&K Photography" vs "K & K Photography Inc". */
export const COMPANY_SIM_FLOOR = 0.9

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

/**
 * HubSpot-style reasons. The 3 legacy values
 * (`email` / `phone` / `name_and_company`) are preserved for
 * backwards-compat with the UI label map; the 3 new values are added
 * by the similarity scorer.
 */
export type ContactMatchReason =
  | "email"
  | "phone"
  | "name_and_company"
  | "similar_email"
  | "similar_name_and_email"
  | "similar_name_and_phone"

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

function normalizeForSimilarity(s: string | null | undefined): string | null {
  if (!s) return null
  const cleaned = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9@. ]+/g, " ") // strip punctuation except @ and .
    .replace(/\s+/g, " ")
    .trim()
  return cleaned.length > 0 ? cleaned : null
}

function splitEmail(email: string): { local: string; domain: string } | null {
  const at = email.lastIndexOf("@")
  if (at <= 0 || at === email.length - 1) return null
  return { local: email.slice(0, at), domain: email.slice(at + 1) }
}

export function normalizeDomain(website: string | null | undefined): string | null {
  if (!website) return null
  const raw = website.trim()
  if (raw.length === 0) return null
  let host: string | null = null
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`)
    host = parsed.hostname
  } catch {
    host = raw.replace(/^[a-z]+:\/\//i, "").split("/")[0] ?? null
  }
  if (!host) return null
  host = host.toLowerCase()
  if (host.startsWith("www.")) host = host.slice(4)
  host = host.split(":")[0] ?? host
  return host.length > 0 ? host : null
}

// ─── Jaro / Jaro-Winkler (pure) ────────────────────────────────────

/**
 * Jaro similarity. Returns 0..1.
 * Reference: standard implementation; no dependency added.
 */
export function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1
  const len1 = s1.length
  const len2 = s2.length
  if (len1 === 0 || len2 === 0) return 0
  const matchDistance = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0)
  const s1Matches = new Array<boolean>(len1).fill(false)
  const s2Matches = new Array<boolean>(len2).fill(false)
  let matches = 0
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance)
    const end = Math.min(i + matchDistance + 1, len2)
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue
      if (s1[i] !== s2[j]) continue
      s1Matches[i] = true
      s2Matches[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0
  let transpositions = 0
  let k = 0
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue
    while (!s2Matches[k]) k++
    if (s1[i] !== s2[k]) transpositions++
    k++
  }
  const m = matches
  return (m / len1 + m / len2 + (m - transpositions / 2) / m) / 3
}

/**
 * Jaro-Winkler boosts the Jaro score when the strings share a common
 * prefix (up to 4 chars), favoring names that agree on the first few
 * letters. Standard p=0.1 scaling factor.
 */
export function jaroWinkler(s1: string, s2: string): number {
  const j = jaro(s1, s2)
  if (j === 0) return 0
  let l = 0
  const maxPrefix = Math.min(4, s1.length, s2.length)
  while (l < maxPrefix && s1[l] === s2[l]) l++
  return j + l * 0.1 * (1 - j)
}

// ─── Per-pair similarity scorer ─────────────────────────────────────

interface ContactSignals {
  emailExact: boolean
  emailSameLocal: boolean
  emailFuzzy: boolean
  nameSimilarity: number
  phoneExact: boolean
  companySimilarity: number
}

interface NormalizedContact {
  id: string
  emails: string[]
  emailParts: { local: string; domain: string }[]
  phones: string[]
  nameTokens: string[]
  companyToken: string | null
}

function normalizeContact(c: ContactCandidate): NormalizedContact {
  const emails: string[] = []
  const emailParts: { local: string; domain: string }[] = []
  for (const e of [c.primaryEmail, c.secondaryEmail]) {
    const v = lower(e)
    if (!v) continue
    emails.push(v)
    const parts = splitEmail(v)
    if (parts) emailParts.push(parts)
  }
  const phones: string[] = []
  for (const p of [c.primaryPhone, c.secondaryPhone]) {
    const v = parsePhoneInput(p)
    if (v) phones.push(v)
  }
  const first = normalizeForSimilarity(c.firstName)
  const last = normalizeForSimilarity(c.lastName)
  const nameTokens: string[] = []
  if (first || last) {
    const forward = [first ?? "", last ?? ""].join(" ").trim()
    const inverted = [last ?? "", first ?? ""].join(" ").trim()
    if (forward) nameTokens.push(forward)
    if (inverted && inverted !== forward) nameTokens.push(inverted)
  }
  return {
    id: c.id,
    emails,
    emailParts,
    phones,
    nameTokens,
    companyToken: normalizeForSimilarity(c.primaryCompanyName),
  }
}

function computeSignals(a: NormalizedContact, b: NormalizedContact): ContactSignals {
  // emailExact: any pair of emails matches verbatim.
  let emailExact = false
  let emailSameLocal = false
  let emailFuzzy = false
  for (const ea of a.emails) {
    for (const eb of b.emails) {
      if (ea === eb) {
        emailExact = true
      } else if (!emailFuzzy && jaroWinkler(ea, eb) >= EMAIL_FUZZY_FLOOR) {
        emailFuzzy = true
      }
    }
  }
  if (!emailExact) {
    for (const pa of a.emailParts) {
      for (const pb of b.emailParts) {
        if (pa.local === pb.local && pa.domain !== pb.domain) {
          emailSameLocal = true
          break
        }
      }
      if (emailSameLocal) break
    }
  }
  // phoneExact: any normalized phone shared.
  let phoneExact = false
  if (a.phones.length > 0 && b.phones.length > 0) {
    const sa = new Set(a.phones)
    for (const p of b.phones) {
      if (sa.has(p)) {
        phoneExact = true
        break
      }
    }
  }
  // nameSimilarity: max across forward / inverted tokens.
  let nameSimilarity = 0
  for (const na of a.nameTokens) {
    for (const nb of b.nameTokens) {
      const score = jaroWinkler(na, nb)
      if (score > nameSimilarity) nameSimilarity = score
    }
  }
  // companySimilarity.
  const companySimilarity =
    a.companyToken && b.companyToken ? jaroWinkler(a.companyToken, b.companyToken) : 0
  return {
    emailExact,
    emailSameLocal,
    emailFuzzy,
    nameSimilarity,
    phoneExact,
    companySimilarity,
  }
}

/**
 * Surface decision + per-pair reasons + composite score for ranking.
 * Returns null when the pair should not surface.
 */
function decidePair(s: ContactSignals): { reasons: ContactMatchReason[]; score: number } | null {
  const reasons: ContactMatchReason[] = []
  // Strongest signals fire alone.
  if (s.emailExact) reasons.push("email")
  if (s.phoneExact) reasons.push("phone")
  const nameStrong = s.nameSimilarity >= NAME_SIM_FLOOR
  const hasEmailSimilar = s.emailSameLocal || s.emailFuzzy
  if (nameStrong) {
    if (s.emailExact || hasEmailSimilar) reasons.push("similar_name_and_email")
    if (s.phoneExact) reasons.push("similar_name_and_phone")
    if (s.companySimilarity >= COMPANY_SIM_FLOOR) reasons.push("name_and_company")
  } else if (hasEmailSimilar && !s.emailExact && !s.phoneExact) {
    // Similar email without name strength only surfaces as a weaker
    // standalone reason. HubSpot calls these out under "Similar email".
    // BUT per the locked surface rule, name-only never surfaces; here
    // we suppress so the only path to surface from a non-exact email
    // is via the name+similar-email composite above.
    return null
  }
  if (reasons.length === 0) return null
  // Composite score for ranking: higher = more confident. Weight
  // exact-key signals heavily; similarity components add fractional
  // confidence. Score is internal — UI does not display it.
  let score = 0
  if (s.emailExact) score += 100
  if (s.phoneExact) score += 80
  if (s.emailSameLocal) score += 30
  if (s.emailFuzzy) score += 20
  if (nameStrong) score += 50 * s.nameSimilarity
  if (s.companySimilarity >= COMPANY_SIM_FLOOR) score += 25 * s.companySimilarity
  // Tie-break boost when multiple reasons stack.
  score += reasons.length * 2
  return { reasons, score }
}

// ─── Public: contact grouping ───────────────────────────────────────

export function findDuplicateContactGroups(
  candidates: ContactCandidate[],
): DuplicateGroup<ContactMatchReason>[] {
  const uf = new UnionFind()
  const reasonsByPair = new Map<string, Set<ContactMatchReason>>()
  const scoreByPair = new Map<string, number>()
  function pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`
  }
  function recordPair(a: string, b: string, reasons: ContactMatchReason[], score: number) {
    if (a === b) return
    uf.union(a, b)
    const key = pairKey(a, b)
    let set = reasonsByPair.get(key)
    if (!set) {
      set = new Set()
      reasonsByPair.set(key, set)
    }
    for (const r of reasons) set.add(r)
    const prev = scoreByPair.get(key) ?? 0
    if (score > prev) scoreByPair.set(key, score)
  }

  // Pre-normalize.
  const normalized = candidates.map(normalizeContact)
  // O(N^2) pairwise — V1 datasets stay well under 10k contacts; this
  // matches the cost of the prior bucket-based approach in practice
  // and lets the similarity signals trade no algorithmic complexity
  // for substantially better recall.
  for (let i = 0; i < normalized.length; i++) {
    const a = normalized[i]
    if (!a) continue
    for (let j = i + 1; j < normalized.length; j++) {
      const b = normalized[j]
      if (!b) continue
      const signals = computeSignals(a, b)
      const decision = decidePair(signals)
      if (!decision) continue
      recordPair(a.id, b.id, decision.reasons, decision.score)
    }
  }

  return collectContactGroups(
    candidates.map((c) => c.id),
    uf,
    reasonsByPair,
    scoreByPair,
  )
}

// ─── Public: company grouping (UNCHANGED from V1) ───────────────────

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

  return collectCompanyGroups(
    candidates.map((c) => c.id),
    uf,
    reasonsByPair,
  )
}

// ─── Internal: union-find → DuplicateGroup[] ────────────────────────

function collectContactGroups(
  allIds: string[],
  uf: UnionFind,
  reasonsByPair: Map<string, Set<ContactMatchReason>>,
  scoreByPair: Map<string, number>,
): DuplicateGroup<ContactMatchReason>[] {
  const buckets = uf.groups(allIds)
  const out: { ids: string[]; reasons: ContactMatchReason[]; topScore: number }[] = []
  for (const ids of buckets.values()) {
    if (ids.length < 2) continue
    const reasons = new Set<ContactMatchReason>()
    let topScore = 0
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]
        const b = ids[j]
        if (!a || !b) continue
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        const s = reasonsByPair.get(key)
        if (s) for (const r of s) reasons.add(r)
        const score = scoreByPair.get(key) ?? 0
        if (score > topScore) topScore = score
      }
    }
    if (reasons.size === 0) continue
    out.push({
      ids: [...ids].sort(),
      reasons: [...reasons].sort(),
      topScore,
    })
  }
  // Rank by topScore desc (most-likely-duplicate first); break ties
  // with larger group first then lex on first id (deterministic).
  out.sort(
    (a, b) =>
      b.topScore - a.topScore ||
      b.ids.length - a.ids.length ||
      (a.ids[0] ?? "").localeCompare(b.ids[0] ?? ""),
  )
  return out.map((g) => ({ ids: g.ids, reasons: g.reasons }))
}

function collectCompanyGroups(
  allIds: string[],
  uf: UnionFind,
  reasonsByPair: Map<string, Set<CompanyMatchReason>>,
): DuplicateGroup<CompanyMatchReason>[] {
  const buckets = uf.groups(allIds)
  const out: DuplicateGroup<CompanyMatchReason>[] = []
  for (const ids of buckets.values()) {
    if (ids.length < 2) continue
    const reasons = new Set<CompanyMatchReason>()
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
    const sortedReasons: CompanyMatchReason[] = [...reasons].sort()
    out.push({ ids: [...ids].sort(), reasons: sortedReasons })
  }
  out.sort((a, b) => b.ids.length - a.ids.length || (a.ids[0] ?? "").localeCompare(b.ids[0] ?? ""))
  return out
}
