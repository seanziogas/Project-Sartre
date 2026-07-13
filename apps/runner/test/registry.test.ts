import { describe, expect, it } from 'vitest'
import { EnrichmentCache, MemoryCacheStore } from '@sartre/connectors'
import type { RunnerModuleDeps } from '../src/registry.js'
import { buildRegistry } from '../src/registry.js'

function moduleDeps(): RunnerModuleDeps {
  return {
    enrichment: {
      pullAccounts: async () => [],
      pullContacts: async () => [],
      loadPreviousReport: async () => null,
      saveReport: async () => undefined,
      saveMvd: async () => undefined,
      notify: async () => undefined,
    },
    reactivation: {
      pullClosedLost: async () => [],
      graderConfig: { brainContext: '', vocabularies: {}, reviewerRules: [] },
      tokenUsdPerRow: 0.01,
      minScore: 50,
      playFor: () => ({ play: 'fallback', group: 'fallback', slots: {} }),
      templates: {
        email1: { fallback: { subjects: ['Subject'], body: 'Body' } },
        email2: { fallback: { subjects: ['Subject'], body: 'Body' } },
        email3: [{ subjects: ['Subject'], body: 'Body' }],
        slotDefaults: {},
        fallbackPlay: 'fallback',
        fallbackGroup: 'fallback',
      },
      enroll: async () => 0,
    },
    inbound: {
      pullNewLeads: async () => [],
      enrichment: { cache: new EnrichmentCache(new MemoryCacheStore()) },
      fieldsWanted: [],
      clayCreditsPerProviderCall: 1,
      routingRules: { rules: [], defaultOwner: null },
      toRoutingFields: () => ({}),
      writeAssignments: async () => 0,
    },
  }
}

describe('runner production registry', () => {
  it('registers all shipped module pipelines by stable id and module id', () => {
    const registry = buildRegistry(moduleDeps(), { complete: async () => '[]' })
    expect(registry.byId('enrichment-refresh@0.1.0')?.moduleId).toBe('revops.enrichment')
    expect(registry.byId('closed-lost-reactivation@0.1.0')?.moduleId).toBe('sales.reactivation')
    expect(registry.byId('inbound-routing@0.1.0')?.moduleId).toBe('marketing.inbound')
    expect(registry.forModule('revops.enrichment')?.id).toBe('enrichment-refresh@0.1.0')
    expect(registry.forModule('sales.reactivation')?.id).toBe('closed-lost-reactivation@0.1.0')
    expect(registry.forModule('marketing.inbound')?.id).toBe('inbound-routing@0.1.0')
  })
})
