/**
 * Standardization rules — the cxt_hub dedup standards as the default ruleset
 * (knowledge_base/playbooks/crm-enrichment.md, "Deduplication standards").
 * Pure functions; the data package's entity-resolution waterfall keys on these.
 */

const LEGAL_SUFFIXES = [
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'plc', 'gmbh', 'ag', 'sa', 'srl', 'bv', 'nv', 'oy', 'ab', 'as',
  'pty', 'pte', 'kk', 'sas', 'holdings', 'group',
]

/** `https://www.Example.com/us/` → `example.com` */
export function normalizeDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase()
  if (s === '') return null
  // tolerate full URLs and bare domains
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  s = s.replace(/^www\./, '')
  s = s.split(/[/?#]/, 1)[0] ?? ''
  s = s.split('@').pop() ?? '' // tolerate accidental emails in domain columns
  s = s.replace(/\.+$/, '').replace(/:\d+$/, '')
  if (s === '' || !s.includes('.')) return null
  return s
}

/** `Acme, Inc.` → `acme` */
export function normalizeCompanyName(raw: string): string | null {
  let s = raw
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (s === '') return null
  let changed = true
  while (changed) {
    changed = false
    for (const suffix of LEGAL_SUFFIXES) {
      const tail = ` ${suffix}`
      if (s.endsWith(tail) && s.length > tail.length) {
        s = s.slice(0, -tail.length).trim()
        changed = true
      }
    }
  }
  return s === '' ? null : s
}

/** Lowercase exact-match key. */
export function normalizeEmail(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null
  return s
}

/** Canonical LinkedIn key: lowercase host+path, no query, no trailing slash. */
export function normalizeLinkedinUrl(raw: string): string | null {
  const domainAndPath = raw.trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .split(/[?#]/, 1)[0]
    ?.replace(/\/+$/, '')
  if (!domainAndPath || !domainAndPath.startsWith('linkedin.com/')) return null
  return domainAndPath
}
