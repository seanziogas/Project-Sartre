import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EnrichmentCache, MemoryCacheStore } from '@sartre/connectors'
import { parseManifest } from '@sartre/core'
import type { InboundRoutingDeps } from '@sartre/modules'
import { MemoryRunStore, PipelineEngine } from '@sartre/pipelines'
import type { RunnerModuleDeps } from '../src/registry.js'
import { buildRegistry } from '../src/registry.js'

const templatePath = resolve(import.meta.dirname, '../../../clients/_template/client.yaml')

function moduleDeps(): RunnerModuleDeps {
  const enrichment = {
    pullAccounts: async () => [],
    pullContacts: async () => [],
    refreshCanonical: async () => ({ accounts: [], contacts: [] }),
    loadPreviousReport: async () => null,
    saveReport: async () => undefined,
    saveMvd: async () => undefined,
    notify: async () => undefined,
  }
  const reactivation = {
    loadCanonicalClosedLost: async () => [],
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
  }
  const inbound = {
    pullNewLeads: async () => [],
    enrichment: { cache: new EnrichmentCache(new MemoryCacheStore()) },
    fieldsWanted: [],
    clayCreditsPerProviderCall: 1,
    routingRules: { rules: [], defaultOwner: null },
    toRoutingFields: () => ({}),
    writeAssignments: async () => 0,
  }
  return {
    enrichment: async () => enrichment,
    reactivation: async () => reactivation,
    inbound: async () => inbound,
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

  it('resolves connector and brain-derived dependencies for the run client', async () => {
    const deps = moduleDeps()
    const baseInbound = await deps.inbound('fixture') as InboundRoutingDeps
    const resolved: string[] = []
    deps.inbound = (clientId) => {
      resolved.push(clientId)
      return {
        ...baseInbound,
        pullNewLeads: async () => [{ id: `${clientId}-lead`, domain: null, name: clientId, raw: {} }],
      }
    }
    const pipeline = buildRegistry(deps, { complete: async () => '[]' }).byId('inbound-routing@0.1.0')!
    const manifest = parseManifest(readFileSync(templatePath, 'utf8'))
    manifest.status = 'active'
    manifest.modules['marketing.inbound'] = { enabled: true, always_on: false, thresholds: {} }
    manifest.mvd['marketing.inbound'] = { status: 'green', as_of: '2026-07-13', blocking_gaps: [] }
    const store = new MemoryRunStore()

    const acme = await new PipelineEngine(store, { runId: 'acme-run' }).start(pipeline, manifest, 'Acme')
    const beta = await new PipelineEngine(store, { runId: 'beta-run' }).start(pipeline, manifest, 'Beta')

    expect(acme.checkpoints.pull).toMatchObject([{ id: 'Acme-lead' }])
    expect(beta.checkpoints.pull).toMatchObject([{ id: 'Beta-lead' }])
    expect(new Set(resolved)).toEqual(new Set(['Acme', 'Beta']))
    expect(acme.status).toBe('awaiting_approval')
    expect(beta.status).toBe('awaiting_approval')
  })
})
