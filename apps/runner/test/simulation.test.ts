import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseManifest } from '@sartre/core'
import { simulateClient } from '../src/simulation.js'
import type { StandardRuntimeConfig } from '../src/standard-schemas.js'

const templatePath = resolve(import.meta.dirname, '../../../clients/_template/client.yaml')

describe('deployment simulation', () => {
  it('reports gates, effects, destinations, costs, fields, inputs, and connection readiness without executing anything', () => {
    const manifest = parseManifest(readFileSync(templatePath, 'utf8'))
    manifest.status = 'active'
    for (const module of Object.values(manifest.modules)) module.enabled = false
    for (const moduleId of ['marketing.ads-sync', 'revops.etl', 'revops.routing']) {
      manifest.modules[moduleId]!.enabled = true
      manifest.mvd[moduleId] = { status: 'green', as_of: '2026-07-14', blocking_gaps: [] }
    }
    const runtime: StandardRuntimeConfig = {
      connections: { audience: 'linkedin-ads', warehouse: 'snowflake', crm: 'salesforce' },
      destinations: { comms: 'channel-1', warehouse: 'analytics' },
      costs: { 'linkedin-ads': 0.2, snowflake: 0.01 },
      modules: {
        crm: { namespacePrefix: 'Kiln_' },
        'revops.routing': { ownerField: 'Kiln_Owner__c', reasoningField: 'Kiln_Routing_Reason__c' },
      },
    }

    const report = simulateClient('Acme', manifest, runtime, ['linkedin-ads', 'salesforce'], {
      'marketing.ads-sync': [{ audience: 'enterprise', add: ['a@example.com'], remove: ['b@example.com', 'c@example.com'], reason: 'tier changed' }],
      'revops.etl': [{ destination: 'analytics', object: 'account', externalId: 'A1', fields: { name: 'Acme', score: 90 } }],
      'revops.routing': { records: [{ id: 'L1', fields: {} }] },
    }, new Date('2026-07-14T12:00:00Z'))

    expect(report).toMatchObject({
      clientId: 'Acme', generatedAt: '2026-07-14T12:00:00.000Z', noEffects: true,
      destinations: { comms: 'channel-1', warehouse: 'analytics' },
      configuredUnitCosts: { 'linkedin-ads': 0.2, snowflake: 0.01 },
      crmFields: ['Kiln_', 'Kiln_Owner__c', 'Kiln_Routing_Reason__c'],
    })
    expect(report.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        moduleId: 'marketing.ads-sync', runnable: true, gates: ['outbound_send'], effects: ['audience mutation'],
        connections: [{ logical: 'audience', provider: 'linkedin-ads', active: true }],
        inputPreview: { present: true, audiences: [{ audience: 'enterprise', add: 1, remove: 2 }] },
      }),
      expect.objectContaining({
        moduleId: 'revops.etl', runnable: true,
        connections: [{ logical: 'warehouse', provider: 'snowflake', active: false }],
        inputPreview: { present: true, statements: [{ destination: 'analytics', object: 'account', externalId: 'A1', fields: ['name', 'score'] }] },
      }),
      expect.objectContaining({ moduleId: 'revops.routing', inputPreview: { present: true, keys: ['records'], counts: { records: 1 } } }),
    ]))
  })

  it('shows commercial and MVD blockers while remaining connector-free', () => {
    const manifest = parseManifest(readFileSync(templatePath, 'utf8'))
    for (const module of Object.values(manifest.modules)) module.enabled = false
    manifest.modules['platform.metrics']!.enabled = true
    manifest.mvd['platform.metrics'] = { status: 'red', as_of: '2026-07-14', blocking_gaps: [] }
    const report = simulateClient('Draft', manifest, null, [], {})
    expect(report.modules[0]).toMatchObject({ moduleId: 'platform.metrics', runnable: false })
    expect(report.modules[0]!.connections).toEqual([{ logical: 'comms', provider: null, active: false }])
  })
})
