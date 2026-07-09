import { normalizeDomain, Provenance } from '@sartre/core'
import { z } from 'zod'

/**
 * Portfolio-wide enrichment cache (Layer 2): no company is ever enriched
 * twice across the portfolio. Keyed by normalized domain; values carry full
 * per-field provenance (source, date, confidence) so consumers can apply
 * their own freshness and trust policies.
 *
 * Tenancy note: the cache stores COMPANY-level facts only (firmographics —
 * inherently public/vendor data). Client-derived judgments (grades, notes,
 * classifications grounded in a client brain) must never enter the cache —
 * that would cross the client boundary. Enforced via the field allowlist.
 */

export const CachedField = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  provenance: Provenance,
})
export type CachedField = z.infer<typeof CachedField>

export const CacheEntry = z.object({
  domain: z.string().min(1),
  fields: z.record(z.string(), CachedField),
  firstCachedAt: z.string().datetime(),
  lastUpdatedAt: z.string().datetime(),
})
export type CacheEntry = z.infer<typeof CacheEntry>

/** Company-level facts only. Extend deliberately; never add client-derived judgments. */
export const CACHEABLE_FIELDS = new Set([
  'company_name',
  'company_linkedin_url',
  'employee_count',
  'employee_range',
  'revenue_usd',
  'revenue_range',
  'industry',
  'sub_industry',
  'hq_country',
  'hq_state',
  'hq_city',
  'founded_year',
  'funding_stage',
  'total_funding_usd',
  'last_funding_date',
  'tech_stack',
  'description',
])

export interface CacheStore {
  get(domain: string): Promise<CacheEntry | null>
  put(entry: CacheEntry): Promise<void>
}

/** Simple in-memory store; Postgres adapter replaces this in Phase 2. */
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry>()
  async get(domain: string): Promise<CacheEntry | null> {
    return this.entries.get(domain) ?? null
  }
  async put(entry: CacheEntry): Promise<void> {
    this.entries.set(entry.domain, entry)
  }
}

export interface LookupResult {
  hit: boolean
  entry: CacheEntry | null
  /** Fields present and fresh enough per the caller's policy. */
  fresh: Record<string, CachedField>
  /** Fields present but older than maxAgeDays — usable as fallback, flagged. */
  stale: Record<string, CachedField>
}

export interface CachePolicy {
  /** Fields older than this are reported as stale. Default 180. */
  maxAgeDays?: number
}

export class EnrichmentCache {
  constructor(
    private readonly store: CacheStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async lookup(rawDomain: string, policy: CachePolicy = {}): Promise<LookupResult> {
    const domain = normalizeDomain(rawDomain)
    if (!domain) return { hit: false, entry: null, fresh: {}, stale: {} }
    const entry = await this.store.get(domain)
    if (!entry) return { hit: false, entry: null, fresh: {}, stale: {} }

    const maxAgeMs = (policy.maxAgeDays ?? 180) * 86_400_000
    const cutoff = this.now().getTime() - maxAgeMs
    const fresh: Record<string, CachedField> = {}
    const stale: Record<string, CachedField> = {}
    for (const [name, field] of Object.entries(entry.fields)) {
      if (new Date(field.provenance.retrievedAt).getTime() >= cutoff) fresh[name] = field
      else stale[name] = field
    }
    return { hit: true, entry, fresh, stale }
  }

  /**
   * Merge newly-enriched fields into the cache. Rejects non-allowlisted
   * fields (client-derived judgments must not cross the boundary). An
   * incoming field only overwrites an existing one when it is newer OR
   * strictly more confident.
   */
  async record(rawDomain: string, fields: Record<string, CachedField>): Promise<{ stored: string[]; rejected: string[] }> {
    const domain = normalizeDomain(rawDomain)
    if (!domain) return { stored: [], rejected: Object.keys(fields) }

    const stored: string[] = []
    const rejected: string[] = []
    const nowIso = this.now().toISOString()
    const existing = await this.store.get(domain)
    const merged: CacheEntry = existing ?? { domain, fields: {}, firstCachedAt: nowIso, lastUpdatedAt: nowIso }

    for (const [name, field] of Object.entries(fields)) {
      if (!CACHEABLE_FIELDS.has(name)) {
        rejected.push(name)
        continue
      }
      const current = merged.fields[name]
      if (current && !shouldReplace(current, field)) continue
      merged.fields[name] = field
      stored.push(name)
    }
    if (stored.length > 0) {
      merged.lastUpdatedAt = nowIso
      await this.store.put(merged)
    }
    return { stored, rejected }
  }
}

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1, needs_review: 0 } as const

function shouldReplace(current: CachedField, incoming: CachedField): boolean {
  const newer = new Date(incoming.provenance.retrievedAt).getTime() > new Date(current.provenance.retrievedAt).getTime()
  const moreConfident = CONFIDENCE_RANK[incoming.provenance.confidence] > CONFIDENCE_RANK[current.provenance.confidence]
  return newer || moreConfident
}
