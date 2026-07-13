import { normalizeDomain } from '@sartre/core'
import { EnrichmentCache } from '@sartre/connectors'
import type { CachedField } from '@sartre/connectors'

/**
 * List Enricher: records in → enriched, confidence-flagged records out.
 * Waterfall per row: portfolio cache → enrichment provider → web fallback.
 * Sentinel conventions from the proven Hologram skill: NEEDS REVIEW /
 * NOT APPLICABLE - {reason}. Budget-aware: provider calls stop at the cap and
 * remaining rows are flagged, never silently skipped.
 */

export const SKILL_ID = 'list-enricher@0.1.0'

export interface EnricherRow {
  id: string
  domain: string | null
  name: string | null
}

/** A provider call returns whatever fields it could find, with provenance. */
export type EnrichmentProvider = (domain: string) => Promise<Record<string, CachedField>>
/** Web fallback for thin rows (scrape/fetch), given the whole row. */
export type WebFallback = (row: EnricherRow, missingFields: string[]) => Promise<Record<string, CachedField>>

export interface EnricherDeps {
  cache: EnrichmentCache
  provider?: EnrichmentProvider
  webFallback?: WebFallback
}

export interface EnricherOptions {
  /** Fields to obtain, from the cacheable-field vocabulary. */
  fields: string[]
  /** Cache freshness policy in days (default 180). */
  maxAgeDays?: number
  /** Hard cap on provider calls this run (credit budget). null = uncapped. */
  maxProviderCalls?: number | null
}

export interface EnrichedRow {
  id: string
  values: Record<string, CachedField | null>
  /** Where each obtained field came from this run. */
  sources: Record<string, 'cache' | 'cache_stale' | 'provider' | 'web'>
  /** NEEDS REVIEW | NOT APPLICABLE - {reason} | null (clean). */
  sentinel: string | null
}

export interface EnrichListResult {
  rows: EnrichedRow[]
  providerCalls: number
  cacheHits: number
  /** Rows skipped because the provider budget ran out — remediation input. */
  budgetExhaustedRowIds: string[]
}

export async function enrichList(
  rows: EnricherRow[],
  deps: EnricherDeps,
  options: EnricherOptions,
): Promise<EnrichListResult> {
  const maxAgeDays = options.maxAgeDays ?? 180
  const budget = options.maxProviderCalls ?? null
  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) throw new Error('maxAgeDays must be a finite non-negative number')
  if (budget !== null && (!Number.isInteger(budget) || budget < 0)) {
    throw new Error('maxProviderCalls must be a non-negative integer or null')
  }
  let providerCalls = 0
  let cacheHits = 0
  const budgetExhausted: string[] = []
  const out: EnrichedRow[] = []

  for (const row of rows) {
    const values: EnrichedRow['values'] = Object.fromEntries(options.fields.map((f) => [f, null]))
    const sources: EnrichedRow['sources'] = {}
    const domain = row.domain ? normalizeDomain(row.domain) : null

    if (!domain) {
      out.push({ id: row.id, values, sources, sentinel: 'NOT APPLICABLE - no usable domain' })
      continue
    }

    // 1. Portfolio cache
    const lookup = await deps.cache.lookup(domain, { maxAgeDays })
    if (lookup.hit) cacheHits++
    let missing: string[] = []
    for (const field of options.fields) {
      const fresh = lookup.fresh[field]
      if (fresh) {
        values[field] = fresh
        sources[field] = 'cache'
      } else {
        missing.push(field)
      }
    }

    // 2. Provider (budget-gated); results feed back into the cache
    if (missing.length > 0 && deps.provider) {
      if (budget !== null && providerCalls >= budget) {
        budgetExhausted.push(row.id)
      } else {
        providerCalls++
        const found = await deps.provider(domain)
        await deps.cache.record(domain, found)
        for (const field of missing) {
          const f = found[field]
          if (f) {
            values[field] = f
            sources[field] = 'provider'
          }
        }
        missing = missing.filter((f) => values[f] === null)
      }
    }

    // 3. Web fallback for what's still thin
    if (missing.length > 0 && deps.webFallback) {
      const found = await deps.webFallback(row, missing)
      await deps.cache.record(domain, found)
      for (const field of missing) {
        const f = found[field]
        if (f) {
          values[field] = f
          sources[field] = 'web'
        }
      }
      missing = missing.filter((f) => values[f] === null)
    }

    // 4. Stale cache values beat nothing — flagged as stale
    for (const field of missing.slice()) {
      const stale = lookup.stale[field]
      if (stale) {
        values[field] = stale
        sources[field] = 'cache_stale'
        missing = missing.filter((f) => f !== field)
      }
    }

    out.push({
      id: row.id,
      values,
      sources,
      sentinel: missing.length > 0 ? 'NEEDS REVIEW' : null,
    })
  }

  return { rows: out, providerCalls, cacheHits, budgetExhaustedRowIds: budgetExhausted }
}
