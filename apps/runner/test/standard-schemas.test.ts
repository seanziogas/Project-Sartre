import { describe, expect, it } from 'vitest'
import { StandardInputSchemas, StandardModuleConfigSchemas, StandardRuntimeConfigSchema } from '../src/standard-schemas.js'

const templates = {
  email1: { play: { subjects: ['Hello'], body: 'Body' } },
  email2: { group: { subjects: ['Follow up'], body: 'Body' } },
  email3: [{ subjects: ['Close loop'], body: 'Body' }],
  slotDefaults: {}, fallbackPlay: 'play', fallbackGroup: 'group',
}
const routing = { rules: [], defaultOwner: null }

describe('standard deployment runtime schemas', () => {
  it('rejects malformed top-level and module configuration before connector use', () => {
    expect(() => StandardRuntimeConfigSchema.parse({ connections: {}, destinations: {}, costs: { row: -1 }, modules: {} })).toThrow()
    expect(() => StandardModuleConfigSchemas.crm.parse({ namespacePrefix: '' })).toThrow()
    expect(() => StandardModuleConfigSchemas['marketing.inbound'].parse({ provider: 'typeform' })).toThrow()
    expect(() => StandardModuleConfigSchemas['platform.signals'].parse({ rules: [{ id: 'x', kinds: ['visit'], minStrength: 101, play: 'call' }] })).toThrow()
  })

  it('accepts every supported module configuration block', () => {
    const mapping = { object: 'account', externalIdField: 'Id', fields: [], references: [] }
    const contactMapping = { ...mapping, object: 'contact' }
    const values: Record<keyof typeof StandardModuleConfigSchemas, unknown> = {
      crm: { namespacePrefix: 'Kiln_' },
      'revops.enrichment': { accountMapping: mapping, contactMapping },
      'sales.reactivation': { vocabularies: {}, reviewerRules: [], minScore: 70, defaultPlay: 'play', defaultGroup: 'group', campaignId: 'c1', templates },
      'marketing.inbound': { provider: 'typeform', idField: 'id', domainField: 'domain', nameField: 'name', fieldsWanted: [], clayCreditsPerCall: 1, routingRules: routing, ownerField: 'Kiln_Owner', reasoningField: 'Kiln_Reason' },
      'marketing.deanon': { provider: 'g2', idField: 'id', domainField: 'domain', kindField: 'kind', occurredAtField: 'at', detailField: 'detail' },
      'revops.dedup': { flagField: 'Kiln_Duplicate' },
      'sales.outbound': { campaignId: 'c1', templates },
      'marketing.copy-factory': { templates },
      'revops.routing': { rules: routing, ownerField: 'Kiln_Owner', reasoningField: 'Kiln_Reason' },
      'revops.tam': { scoreField: 'Kiln_Score', tierField: 'Kiln_Tier' },
      'platform.signals': { rules: [] },
    }
    for (const [key, schema] of Object.entries(StandardModuleConfigSchemas)) expect(schema.parse(values[key as keyof typeof values])).toBeTruthy()
  })

  it('validates every tenant runtime artifact shape', () => {
    const uuid = '00000000-0000-4000-8000-000000000001'
    const examples: Record<keyof typeof StandardInputSchemas, unknown> = {
      'sequence-leads': { lead: { email: 'buyer@example.com' } },
      'revops.remediation': [{ object: 'account', externalId: 'a1', fields: { Kiln_Score: 1 } }],
      'revops.lead-convert': [{ clientId: 'Acme', sourceSystem: 'salesforce', externalId: 'l1' }],
      'platform.learning': { outcomes: [{ kind: 'outcome', id: uuid, clientId: 'Acme', occurredAt: '2026-07-14T00:00:00Z', outcome: 'meeting_booked', accountId: null, contactId: null, opportunityId: null }], variantByEventId: { [uuid]: 'a' }, gradedOutcomes: [{ id: 'g1', score: 90, converted: true }] },
      'sales.outbound': { rows: [{ id: 'r1', play: 'play', group: 'group', slots: {} }] },
      'sales.abm': { accounts: [{ id: 'a1', name: 'Acme', fields: {} }] },
      'sales.takeout': [{ accountId: 'a1', accountName: 'Acme', competitor: 'Other', evidence: ['CRM note'] }],
      'sales.rep-workflows': { replies: [{ id: 'r1', sender: 'buyer@example.com', message: 'Interested' }], crmActions: [] },
      'marketing.events': [{ id: 'e1', email: 'buyer@example.com', event: 'Summit', attended: true, segment: 'enterprise' }],
      'marketing.copy-factory': { rows: [{ id: 'r1', play: 'play', group: 'group', slots: {} }] },
      'marketing.ads-sync': [{ audience: 'a1', add: ['buyer@example.com'], remove: [], reason: 'approved segment' }],
      'revops.routing': { records: [{ id: 'c1', fields: { country: 'US' } }] },
      'revops.tam': [{ id: 'a1', name: 'Acme', fields: { score: 90 } }],
      'revops.etl': [{ destination: 'warehouse', object: 'account', externalId: 'a1', fields: { sql: 'SELECT 1' } }],
      'platform.signals': { signals: [{ id: 's1', accountId: 'a1', kind: 'visit', strength: 90, occurredAt: '2026-07-14T00:00:00Z' }] },
      'platform.digests': { title: 'Weekly', markdown: 'Summary', sourceRefs: ['run:r1'] },
      'platform.metrics': { kind: 'qbr', sourceContext: '=== run:r1 ===\nEvidence', allowedSources: ['run:r1'], metrics: { meetings: 1 } },
    }
    for (const [key, schema] of Object.entries(StandardInputSchemas)) expect(schema.parse(examples[key as keyof typeof examples])).toBeTruthy()
    expect(() => StandardInputSchemas['marketing.ads-sync'].parse([{ audience: 'a1', add: ['not-email'], remove: [], reason: 'x' }])).toThrow()
  })
})
