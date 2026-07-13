import { describe, expect, it } from 'vitest'
import { IntentEvent, LeadConversionRequest, partitionNamespacedWrites, StagedBatchSchema } from '../src/contract.js'
import { EnrichmentCache, MemoryCacheStore } from '../src/enrichment-cache.js'
import type { CachedField } from '../src/enrichment-cache.js'

describe('partitionNamespacedWrites', () => {
  it('rejects any write touching fields outside the namespace', () => {
    const { allowed, rejected } = partitionNamespacedWrites(
      [
        { object: 'account', externalId: '1', fields: { Kiln_Industry__c: 'SaaS' } },
        { object: 'account', externalId: '2', fields: { Kiln_Industry__c: 'SaaS', Industry: 'SaaS' } },
      ],
      'Kiln_',
    )
    expect(allowed).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.reason).toContain('Industry')
  })

  it('never treats an empty namespace as permission to write every field', () => {
    expect(() => partitionNamespacedWrites(
      [{ object: 'account', externalId: '1', fields: { Website: 'acme.example' } }],
      '',
    )).toThrow('namespace prefix is required')
  })
})

describe('lead connector contracts', () => {
  it('accepts raw lead staging batches', () => {
    expect(StagedBatchSchema.parse({
      connectorId: 'salesforce',
      object: 'lead',
      extractedAt: '2026-07-13T12:00:00Z',
      cursor: null,
      rows: [{ Id: '00Q-1', Email: 'buyer@acme.example' }],
    }).object).toBe('lead')
  })

  it('requires each conversion to create or target exactly one account', () => {
    expect(LeadConversionRequest.parse({ leadExternalId: '00Q-1', targetAccountExternalId: '001-1', createAccount: false }))
      .toMatchObject({ targetAccountExternalId: '001-1', createAccount: false })
    expect(() => LeadConversionRequest.parse({ leadExternalId: '00Q-1', targetAccountExternalId: null, createAccount: false }))
      .toThrow('either create an account or target one existing account')
    expect(() => LeadConversionRequest.parse({ leadExternalId: '00Q-1', targetAccountExternalId: '001-1', createAccount: true }))
      .toThrow('either create an account or target one existing account')
  })
})

describe('intent connector contracts', () => {
  it('accepts raw signal staging and validates normalized intent events', () => {
    expect(StagedBatchSchema.parse({
      connectorId: 'clearbit',
      object: 'signal',
      extractedAt: '2026-07-13T12:00:00Z',
      cursor: null,
      rows: [{ id: 'sig-1', domain: 'acme.example' }],
    }).object).toBe('signal')
    expect(IntentEvent.parse({
      clientId: 'Acme', sourceSystem: 'clearbit', externalId: 'sig-1',
      companyDomain: 'acme.example', kind: 'pricing-visit', occurredAt: '2026-07-13T11:00:00Z',
    })).toMatchObject({ externalId: 'sig-1', detail: '' })
  })
})

function field(value: string | number, retrievedAt: string, confidence: 'high' | 'medium' | 'low' = 'high'): CachedField {
  return {
    value,
    provenance: { source: 'enrichment', origin: 'clay:waterfall', retrievedAt, confidence },
  }
}

const NOW = () => new Date('2026-07-09T00:00:00Z')

describe('EnrichmentCache', () => {
  it('misses on unknown domains, hits after record, normalizes keys', async () => {
    const cache = new EnrichmentCache(new MemoryCacheStore(), NOW)
    expect((await cache.lookup('acme.com')).hit).toBe(false)

    await cache.record('https://www.Acme.com/us', { employee_count: field(250, '2026-07-01T00:00:00Z') })
    const result = await cache.lookup('acme.com')
    expect(result.hit).toBe(true)
    expect(result.fresh.employee_count?.value).toBe(250)
  })

  it('separates fresh from stale by policy', async () => {
    const cache = new EnrichmentCache(new MemoryCacheStore(), NOW)
    await cache.record('acme.com', {
      employee_count: field(250, '2026-07-01T00:00:00Z'),
      revenue_range: field('$100M+', '2025-01-01T00:00:00Z'), // 1.5 years old
    })
    const result = await cache.lookup('acme.com', { maxAgeDays: 180 })
    expect(Object.keys(result.fresh)).toEqual(['employee_count'])
    expect(Object.keys(result.stale)).toEqual(['revenue_range'])
  })

  it('rejects client-derived judgments (boundary enforcement)', async () => {
    const cache = new EnrichmentCache(new MemoryCacheStore(), NOW)
    const { stored, rejected } = await cache.record('acme.com', {
      industry: field('SaaS', '2026-07-01T00:00:00Z'),
      icp_grade: field('A', '2026-07-01T00:00:00Z'),
      hologram_use_case: field('asset-tracking', '2026-07-01T00:00:00Z'),
    })
    expect(stored).toEqual(['industry'])
    expect(rejected.sort()).toEqual(['hologram_use_case', 'icp_grade'])
  })

  it('only overwrites with newer or more confident values', async () => {
    const cache = new EnrichmentCache(new MemoryCacheStore(), NOW)
    await cache.record('acme.com', { employee_count: field(250, '2026-06-01T00:00:00Z', 'high') })
    // older AND less confident → ignored
    await cache.record('acme.com', { employee_count: field(9, '2026-01-01T00:00:00Z', 'low') })
    let result = await cache.lookup('acme.com')
    expect(result.fresh.employee_count?.value).toBe(250)
    // newer → replaces
    await cache.record('acme.com', { employee_count: field(300, '2026-07-05T00:00:00Z', 'medium') })
    result = await cache.lookup('acme.com')
    expect(result.fresh.employee_count?.value).toBe(300)
  })
})
