import { describe, expect, it } from 'vitest'
import { EnrichmentCache, MemoryCacheStore } from '@sartre/connectors'
import type { CachedField } from '@sartre/connectors'
import { enrichList } from '../src/list-enricher.js'

const NOW = () => new Date('2026-07-09T00:00:00Z')

function field(value: string | number, retrievedAt = '2026-07-01T00:00:00Z'): CachedField {
  return { value, provenance: { source: 'enrichment', origin: 'clay', retrievedAt, confidence: 'high' } }
}

describe('enrichList — eval set', () => {
  it('serves from cache without touching the provider', async () => {
    const cache = new EnrichmentCache(new MemoryCacheStore(), NOW)
    await cache.record('acme.com', { industry: field('SaaS'), employee_count: field(200) })
    let providerCalls = 0

    const result = await enrichList(
      [{ id: '1', domain: 'https://www.acme.com', name: 'Acme' }],
      { cache, provider: async () => { providerCalls++; return {} } },
      { fields: ['industry', 'employee_count'] },
    )
    expect(providerCalls).toBe(0)
    expect(result.cacheHits).toBe(1)
    expect(result.rows[0]!.values.industry?.value).toBe('SaaS')
    expect(result.rows[0]!.sources.industry).toBe('cache')
    expect(result.rows[0]!.sentinel).toBeNull()
  })

  it('falls through cache → provider → web, caching provider results', async () => {
    const cache = new EnrichmentCache(new MemoryCacheStore(), NOW)
    const result = await enrichList(
      [{ id: '1', domain: 'new.io', name: 'New' }],
      {
        cache,
        provider: async () => ({ industry: field('Fintech') }),
        webFallback: async (_row, missing) =>
          missing.includes('employee_count') ? { employee_count: field(50) } : {},
      },
      { fields: ['industry', 'employee_count'] },
    )
    expect(result.rows[0]!.sources).toEqual({ industry: 'provider', employee_count: 'web' })
    expect(result.rows[0]!.sentinel).toBeNull()
    // provider result landed in the portfolio cache
    expect((await cache.lookup('new.io')).fresh.industry?.value).toBe('Fintech')
  })

  it('flags rows without a usable domain as NOT APPLICABLE', async () => {
    const cache = new EnrichmentCache(new MemoryCacheStore(), NOW)
    const result = await enrichList(
      [{ id: '1', domain: 'not a domain', name: 'X' }],
      { cache },
      { fields: ['industry'] },
    )
    expect(result.rows[0]!.sentinel).toContain('NOT APPLICABLE')
  })

  it('flags unresolved fields NEEDS REVIEW and honors the credit budget', async () => {
    const cache = new EnrichmentCache(new MemoryCacheStore(), NOW)
    const result = await enrichList(
      [
        { id: '1', domain: 'a.io', name: 'A' },
        { id: '2', domain: 'b.io', name: 'B' },
      ],
      { cache, provider: async () => ({}) }, // provider finds nothing
      { fields: ['industry'], maxProviderCalls: 1 },
    )
    expect(result.providerCalls).toBe(1)
    expect(result.budgetExhaustedRowIds).toEqual(['2'])
    expect(result.rows.every((r) => r.sentinel === 'NEEDS REVIEW')).toBe(true)
  })

  it('uses stale cache values as a flagged fallback', async () => {
    const cache = new EnrichmentCache(new MemoryCacheStore(), NOW)
    await cache.record('old.io', { industry: field('Logistics', '2024-01-01T00:00:00Z') })
    const result = await enrichList(
      [{ id: '1', domain: 'old.io', name: 'Old' }],
      { cache },
      { fields: ['industry'], maxAgeDays: 180 },
    )
    expect(result.rows[0]!.values.industry?.value).toBe('Logistics')
    expect(result.rows[0]!.sources.industry).toBe('cache_stale')
    expect(result.rows[0]!.sentinel).toBeNull()
  })
})
