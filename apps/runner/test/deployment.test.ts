import { describe, expect, it } from 'vitest'
import { loadModuleDeps } from '../src/deployment.js'
import { buildRegistry } from '../src/registry.js'

describe('runner deployment loading', () => {
  const db = { query: async () => ({ rows: [] }) }
  it('starts with the first-party 23-module deployment bundle when no override is configured', async () => {
    const deps = await loadModuleDeps(undefined, { db, brains: {}, connections: {}, tools: {} } as never)
    const registry = buildRegistry(deps, { complete: async () => '[]' })
    expect(registry.forModule('platform.learning')?.id).toBe('learning-loop@0.1.0')
    expect(Object.values(deps)).toHaveLength(23)
    expect(Object.values(deps).every((resolver) => typeof resolver === 'function')).toBe(true)
  })

  it('constructs every first-party resolver from one approved tenant runtime', async () => {
    const templates = { email1: { play: { subjects: ['Hi'], body: 'Body' } }, email2: { group: { subjects: ['Hi'], body: 'Body' } }, email3: [{ subjects: ['Bye'], body: 'Body' }], slotDefaults: {}, fallbackPlay: 'play', fallbackGroup: 'group' }
    const mapping = { object: 'account', externalIdField: 'Id', fields: [], references: [] }
    const runtime = {
      connections: { crm: 'salesforce', sequencer: 'outreach', comms: 'slack', email: 'gmail', audience: 'linkedin-ads', warehouse: 'snowflake' },
      destinations: { comms: 'C1', email: 'ops@example.com' }, costs: {},
      modules: {
        crm: { namespacePrefix: 'Kiln_' },
        'revops.enrichment': { accountMapping: mapping, contactMapping: { ...mapping, object: 'contact' } },
        'sales.reactivation': { vocabularies: {}, reviewerRules: [], minScore: 70, defaultPlay: 'play', defaultGroup: 'group', campaignId: 'c1', templates },
        'marketing.inbound': { provider: 'typeform', idField: 'id', domainField: 'domain', nameField: 'name', fieldsWanted: [], clayCreditsPerCall: 1, routingRules: { rules: [], defaultOwner: null }, ownerField: 'Kiln_Owner', reasoningField: 'Kiln_Reason' },
        'marketing.deanon': { provider: 'g2', idField: 'id', domainField: 'domain', kindField: 'kind', occurredAtField: 'at', detailField: 'detail' },
        'revops.dedup': { flagField: 'Kiln_Duplicate' },
        'sales.outbound': { campaignId: 'c1', templates }, 'marketing.copy-factory': { templates },
        'revops.routing': { rules: { rules: [], defaultOwner: null }, ownerField: 'Kiln_Owner', reasoningField: 'Kiln_Reason' },
        'revops.tam': { scoreField: 'Kiln_Score', tierField: 'Kiln_Tier', defaultScore: 0, defaultTier: 'review' },
        'platform.signals': { rules: [] },
      },
    }
    const tool = new Proxy({}, { get: () => async () => ({}) })
    const deps = await loadModuleDeps(undefined, {
      db, connections: {}, brains: { loadApprovedConfig: async () => runtime, loadContext: async () => 'approved brain' }, tools: tool,
    } as never)
    for (const resolver of Object.values(deps)) await expect(resolver('Acme')).resolves.toBeTruthy()
  })

  it('binds reviewed event delivery to the tenant email connection', async () => {
    const sent: unknown[] = []
    const deps = await loadModuleDeps(undefined, {
      db, connections: {},
      brains: { loadApprovedConfig: async () => ({ connections: { email: 'gmail' }, destinations: {}, costs: {}, modules: {} }) },
      tools: { email: async (_clientId: string, provider: string) => ({
        sendEmail: async (message: unknown) => { sent.push({ provider, message }); return { provider, messageId: 'm1' } },
      }) },
    } as never)
    const events = await deps.events('Acme')
    expect(await events.send('Acme', [{ attendeeId: 'a1', email: 'buyer@example.com', event: 'Summit', play: 'attendee', draft: 'Thanks for joining.' }]))
      .toMatchObject({ affected: 1, detail: 'gmail event follow-up delivery' })
    expect(sent).toEqual([{ provider: 'gmail', message: { to: ['buyer@example.com'], subject: 'Following up on Summit', text: 'Thanks for joining.' } }])
  })

  it('uses the latest human-promoted production runtime instead of mutable working files', async () => {
    const production = {
      releaseId: 'bc51cff5-917a-4bd5-8db6-5a46ddc1841c', clientId: 'Acme', version: 2, digest: 'a'.repeat(64),
      files: { 'brain/config/standard-runtime.yaml': [
        'version: 1', 'status: active', 'updated: 2026-07-14', 'approved_by: approver@kiln.example', 'config:',
        '  connections: { email: gmail }', '  destinations: {}', '  costs: {}', '  modules: {}',
      ].join('\n') },
      stage: 'production', status: 'active', targetStage: null, createdBy: 'creator', createdAt: '2026-07-14T12:00:00Z',
      requestedBy: 'requester', requestedAt: '2026-07-14T12:10:00Z', decidedBy: 'approver', decidedAt: '2026-07-14T12:20:00Z',
    }
    const sent: unknown[] = []
    const deps = await loadModuleDeps(undefined, {
      db: { query: async (sql: string) => ({ rows: sql.includes('config_releases') ? [{ doc: production }] : [] }) }, connections: {},
      brains: { loadApprovedConfig: async () => { throw new Error('working file must not load') } },
      tools: { email: async () => ({ sendEmail: async (message: unknown) => { sent.push(message); return { provider: 'gmail', messageId: 'm1' } } }) },
    } as never)
    const events = await deps.events('Acme')
    await events.send('Acme', [{ attendeeId: 'a1', email: 'buyer@example.com', event: 'Summit', play: 'attendee', draft: 'Hello' }])
    expect(sent).toHaveLength(1)
  })

  it('collects every inbound cursor page before routing', async () => {
    const cursors: Array<string | undefined> = []
    const runtime = {
      connections: {}, destinations: {}, costs: {}, modules: {
        'marketing.inbound': { provider: 'typeform', idField: 'id', domainField: 'domain', nameField: 'name', fieldsWanted: [], clayCreditsPerCall: 0, routingRules: { rules: [], defaultOwner: null }, ownerField: 'Kiln_Owner', reasoningField: 'Kiln_Reason' },
      },
    }
    const deps = await loadModuleDeps(undefined, {
      db, connections: {}, brains: { loadApprovedConfig: async () => runtime },
      tools: {
        inbound: async () => ({ pullLeads: async (cursor?: string) => {
          cursors.push(cursor)
          return { connectorId: 'typeform', object: 'lead', extractedAt: '2026-07-14T00:00:00Z', cursor: cursor ? null : 'next', rows: [{ id: cursor ? '2' : '1', domain: 'acme.com', name: 'Buyer' }] }
        } }),
        enrichment: async () => ({}),
      },
    } as never)
    const inbound = await deps.inbound('Acme')
    expect((await inbound.pullNewLeads()).map((lead) => lead.id)).toEqual(['1', '2'])
    expect(cursors).toEqual([undefined, 'next'])
  })
})
