import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseManifest } from '@sartre/core'
import { runDeploymentPreflight } from '../src/preflight.js'
import type { StandardRuntimeConfig } from '../src/standard-schemas.js'

const templatePath = resolve(import.meta.dirname, '../../../clients/_template/client.yaml')

function activeManifest(enabled: string[]) {
  const manifest = parseManifest(readFileSync(templatePath, 'utf8'))
  manifest.status = 'active'
  for (const [moduleId, module] of Object.entries(manifest.modules)) {
    module.enabled = enabled.includes(moduleId)
    if (!module.enabled) delete module.schedule
  }
  return manifest
}

const mapping = { object: 'account' as const, externalIdField: 'Id', fields: [], references: [] }
function runtime(): StandardRuntimeConfig {
  return {
    connections: { crm: 'salesforce', comms: 'slack' },
    destinations: { comms: 'C1' }, costs: {},
    modules: {
      crm: { namespacePrefix: 'Kiln_' },
      'revops.enrichment': { accountMapping: mapping, contactMapping: { ...mapping, object: 'contact' } },
    },
  }
}

describe('deployment preflight', () => {
  it('validates enabled configuration, schedules, and active connection references without credentials', async () => {
    const report = await runDeploymentPreflight({
      manifests: new Map([['Acme', activeManifest(['revops.enrichment', 'platform.quality'])]]),
      loadRuntime: async () => runtime(),
      listConnectionProviders: async () => ['salesforce', 'slack'],
      validateBrainContext: async () => {},
    })
    expect(report).toEqual({ ok: true, clientsChecked: 1, issues: [] })
  })

  it('reports malformed schedules, module config, destinations, and missing provider connections together', async () => {
    const manifest = activeManifest(['revops.enrichment', 'revops.lead-convert', 'platform.quality'])
    manifest.modules['platform.quality']!.schedule = 'not a cron'
    const value = runtime()
    value.connections.crm = 'hubspot'
    value.destinations = {}
    delete value.modules['revops.enrichment']
    const report = await runDeploymentPreflight({
      manifests: new Map([['Acme', manifest]]),
      loadRuntime: async () => value,
      listConnectionProviders: async () => ['hubspot'],
      validateBrainContext: async () => {},
    })
    expect(report.ok).toBe(false)
    expect(report.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid schedule'),
      expect.stringContaining('invalid module config'),
      expect.stringContaining('crm must be one of: salesforce'),
      expect.stringContaining('active slack connection is missing'),
      expect.stringContaining('comms destination is required'),
    ]))
  })

  it('checks required approved Brain context and skips non-active clients with a warning', async () => {
    const active = activeManifest(['sales.reactivation'])
    const paused = activeManifest(['sales.reactivation'])
    paused.status = 'paused'
    const report = await runDeploymentPreflight({
      manifests: new Map([['Acme', active], ['Paused', paused]]),
      loadRuntime: async () => ({ connections: { sequencer: 'outreach' }, destinations: {}, costs: {}, modules: {
        'sales.reactivation': { vocabularies: {}, reviewerRules: [], minScore: 70, defaultPlay: 'p', defaultGroup: 'g', campaignId: 'c', templates: {
          email1: { p: { subjects: ['Hi'], body: 'Body' } }, email2: { g: { subjects: ['Hi'], body: 'Body' } },
          email3: [{ subjects: ['Bye'], body: 'Body' }], slotDefaults: {}, fallbackPlay: 'p', fallbackGroup: 'g',
        } },
      } }),
      listConnectionProviders: async () => ['outreach'],
      validateBrainContext: async () => { throw new Error('grading.md is not approved') },
    })
    expect(report.ok).toBe(false)
    expect(report.clientsChecked).toBe(1)
    expect(report.issues).toMatchObject([
      { severity: 'error', clientId: 'Acme', scope: 'sales.reactivation', message: 'grading.md is not approved' },
      { severity: 'warning', clientId: 'Paused', scope: 'manifest' },
    ])
  })
})
