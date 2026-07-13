import {
  normalizeCompanyName,
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedinUrl,
} from '@sartre/core'

/**
 * Entity resolution v1 (Layer 7): deterministic waterfall first, fuzzy
 * fallback second. Output is duplicate GROUPS — flag-don't-delete means we
 * never merge; the client's RevOps owns destructive actions.
 *
 * Waterfall order (cxt_hub dedup standards):
 *   accounts: domain exact → normalized-name exact → fuzzy name (Levenshtein)
 *   contacts: linkedin exact → email exact → fuzzy (name + company) fallback
 */

export interface AccountLike {
  id: string
  name: string | null
  domain: string | null
  protected?: boolean // Do_Not_Touch = TRUE → excluded from grouping
}

export interface ContactLike {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  linkedinUrl: string | null
  companyName: string | null
  protected?: boolean // excluded records never enter a duplicate review group
}

export interface DuplicateGroup {
  /** Stable key describing why the group exists, e.g. "domain:acme.com". */
  key: string
  matchedOn: 'domain' | 'name' | 'linkedin' | 'email' | 'fuzzy'
  memberIds: string[]
  confidence: 'high' | 'medium' | 'low'
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = curr
  }
  return prev[b.length] ?? 0
}

/** Similarity in [0,1]; 1 = identical after normalization. */
export function nameSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

const FUZZY_NAME_THRESHOLD = 0.85

function groupBy<T>(items: T[], keyOf: (item: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    if (key === null) continue
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return map
}

export function resolveAccountDuplicates(accounts: AccountLike[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = []
  const grouped = new Set<string>()
  const eligible = accounts.filter((a) => !a.protected)

  // Tier 1: exact normalized domain
  for (const [key, members] of groupBy(eligible, (a) => (a.domain ? normalizeDomain(a.domain) : null))) {
    if (members.length < 2) continue
    groups.push({ key: `domain:${key}`, matchedOn: 'domain', memberIds: members.map((m) => m.id), confidence: 'high' })
    for (const m of members) grouped.add(m.id)
  }

  // Tier 2: exact normalized name, only among the not-yet-grouped.
  // A distinct valid domain is DISQUALIFYING evidence: same-named companies on
  // different domains are different companies (Mercury the bank vs Mercury the
  // insurer). So within a name group, members with conflicting domains split;
  // domainless members only join when the group has at most one known domain.
  const rest = eligible.filter((a) => !grouped.has(a.id))
  for (const [key, members] of groupBy(rest, (a) => (a.name ? normalizeCompanyName(a.name) : null))) {
    if (members.length < 2) continue
    const domains = new Set(
      members.map((m) => (m.domain ? normalizeDomain(m.domain) : null)).filter((d): d is string => d !== null),
    )
    if (domains.size > 1) continue // conflicting identities — not duplicates
    groups.push({ key: `name:${key}`, matchedOn: 'name', memberIds: members.map((m) => m.id), confidence: 'medium' })
    for (const m of members) grouped.add(m.id)
  }

  // Tier 3: fuzzy name among the remainder (O(n²) — fine at v1 scale; Zingg is
  // the upgrade path). Two records that BOTH carry valid domains are never
  // fuzzy-grouped: tier 1 already proved their domains differ.
  const fuzzyPool = eligible
    .filter((a) => !grouped.has(a.id) && a.name)
    .map((a) => ({
      id: a.id,
      norm: normalizeCompanyName(a.name as string),
      domain: a.domain ? normalizeDomain(a.domain) : null,
    }))
    .filter((a): a is { id: string; norm: string; domain: string | null } => a.norm !== null)
  for (let i = 0; i < fuzzyPool.length; i++) {
    const a = fuzzyPool[i]!
    if (grouped.has(a.id)) continue
    const members = [a.id]
    for (let j = i + 1; j < fuzzyPool.length; j++) {
      const b = fuzzyPool[j]!
      if (grouped.has(b.id)) continue
      if (a.domain !== null && b.domain !== null) continue // proven-distinct identities
      if (nameSimilarity(a.norm, b.norm) >= FUZZY_NAME_THRESHOLD) {
        members.push(b.id)
        grouped.add(b.id)
      }
    }
    if (members.length > 1) {
      grouped.add(a.id)
      groups.push({ key: `fuzzy:${a.norm}`, matchedOn: 'fuzzy', memberIds: members, confidence: 'low' })
    }
  }

  return groups
}

export function resolveContactDuplicates(contacts: ContactLike[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = []
  const grouped = new Set<string>()
  const eligible = contacts.filter((contact) => !contact.protected)

  // Tier 1: LinkedIn exact
  for (const [key, members] of groupBy(eligible, (c) => (c.linkedinUrl ? normalizeLinkedinUrl(c.linkedinUrl) : null))) {
    if (members.length < 2) continue
    groups.push({ key: `linkedin:${key}`, matchedOn: 'linkedin', memberIds: members.map((m) => m.id), confidence: 'high' })
    for (const m of members) grouped.add(m.id)
  }

  // Tier 2: email exact
  const rest = eligible.filter((c) => !grouped.has(c.id))
  for (const [key, members] of groupBy(rest, (c) => (c.email ? normalizeEmail(c.email) : null))) {
    if (members.length < 2) continue
    groups.push({ key: `email:${key}`, matchedOn: 'email', memberIds: members.map((m) => m.id), confidence: 'high' })
    for (const m of members) grouped.add(m.id)
  }

  // Tier 3: fuzzy fallback — full name + company, only when neither identifier exists
  const fuzzyPool = eligible
    .filter((c) => !grouped.has(c.id) && !c.linkedinUrl && !c.email)
    .map((c) => ({
      id: c.id,
      key: `${(c.firstName ?? '').toLowerCase().trim()} ${(c.lastName ?? '').toLowerCase().trim()}|${
        c.companyName ? (normalizeCompanyName(c.companyName) ?? '') : ''
      }`,
    }))
    .filter((c) => !c.key.startsWith(' |'))
  for (let i = 0; i < fuzzyPool.length; i++) {
    const a = fuzzyPool[i]!
    if (grouped.has(a.id)) continue
    const members = [a.id]
    for (let j = i + 1; j < fuzzyPool.length; j++) {
      const b = fuzzyPool[j]!
      if (grouped.has(b.id)) continue
      if (nameSimilarity(a.key, b.key) >= FUZZY_NAME_THRESHOLD) {
        members.push(b.id)
        grouped.add(b.id)
      }
    }
    if (members.length > 1) {
      grouped.add(a.id)
      groups.push({ key: `fuzzy:${a.key}`, matchedOn: 'fuzzy', memberIds: members, confidence: 'low' })
    }
  }

  return groups
}
