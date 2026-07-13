import { describe, expect, it } from 'vitest'
import type { Account } from '@sartre/core'
import { buildCanonicalSignals, mapSourceRow, planDeanonMatches, promoteAccountCandidates } from '../src/index.js'

function account(clientId: string, id: string, externalId: string, domain: string): Account {
  const candidate = mapSourceRow(
    { Id: externalId, Name: externalId, Website: domain },
    {
      object: 'account',
      externalIdField: 'Id',
      fields: [
        { source: 'Name', target: 'name', transform: 'trim' },
        { source: 'Website', target: 'domain', transform: 'domain' },
      ],
    },
    { clientId, connectorId: 'salesforce', extractedAt: '2026-07-13T10:00:00Z' },
  )
  return promoteAccountCandidates(clientId, [candidate], [], {
    now: () => new Date('2026-07-13T11:00:00Z'),
    createId: () => id,
  }).records[0]!
}

const ACME = account('Acme', '00000000-0000-4000-8000-000000000701', '001-acme', 'acme.example')

describe('website de-anonymization planning', () => {
  it('matches exact domains and keeps weak or unknown evidence in review', () => {
    const plan = planDeanonMatches('Acme', [
      { clientId: 'Acme', sourceSystem: 'clearbit', externalId: 'sig-1', companyDomain: 'https://www.ACME.example/path', companyName: 'Acme', kind: 'pricing-visit', occurredAt: '2026-07-13T09:00:00Z', detail: 'Visited pricing' },
      { clientId: 'Acme', sourceSystem: 'clearbit', externalId: 'sig-2', companyDomain: 'unknown.example', companyName: 'Unknown', kind: 'web-visit', occurredAt: '2026-07-13T09:01:00Z', detail: '' },
      { clientId: 'Acme', sourceSystem: 'clearbit', externalId: 'sig-3', companyDomain: null, companyName: 'Name only', kind: 'web-visit', occurredAt: '2026-07-13T09:02:00Z', detail: '' },
      { clientId: 'Acme', sourceSystem: 'clearbit', externalId: 'sig-4', companyDomain: 'gmail.com', companyName: null, kind: 'web-visit', occurredAt: '2026-07-13T09:03:00Z', detail: '' },
    ], [ACME])

    expect(plan.decisions.map((decision) => decision.action)).toEqual([
      'match_account', 'unmatched', 'manual_review', 'manual_review',
    ])
    expect(plan.decisions[0]).toMatchObject({ accountId: ACME.id, normalizedDomain: 'acme.example' })

    const signals = buildCanonicalSignals('Acme', plan, {
      runId: 'deanon-r1',
      now: () => new Date('2026-07-13T12:00:00Z'),
      createId: () => '00000000-0000-4000-8000-000000000702',
    })
    expect(signals).toMatchObject([{
      clientId: 'Acme',
      accountId: ACME.id,
      externalIds: { clearbit: 'sig-1' },
      kind: 'pricing-visit',
      provenance: { source: 'web', origin: 'clearbit', runId: 'deanon-r1' },
    }])
  })

  it('refuses ambiguous, duplicate-source, mixed-source, and cross-tenant associations', () => {
    const duplicateAccount = { ...ACME, id: '00000000-0000-4000-8000-000000000703', flags: ['duplicate' as const] }
    const event = { clientId: 'Acme', sourceSystem: 'clearbit', externalId: 'sig-1', companyDomain: 'acme.example', companyName: 'Acme', kind: 'visit', occurredAt: '2026-07-13T09:00:00Z', detail: '' }
    expect(planDeanonMatches('Acme', [event], [duplicateAccount]).decisions[0]!.action).toBe('manual_review')
    expect(planDeanonMatches('Acme', [event, event], [ACME]).decisions.every((decision) => decision.action === 'manual_review')).toBe(true)
    expect(() => planDeanonMatches('Acme', [event, { ...event, externalId: 'sig-2', sourceSystem: 'sixsense' }], [ACME]))
      .toThrow('cannot mix source systems')
    expect(() => planDeanonMatches('Acme', [{ ...event, clientId: 'OtherClient' }], [ACME]))
      .toThrow('crosses the client boundary')
    expect(() => planDeanonMatches('Acme', [], [{ ...ACME, clientId: 'OtherClient' }]))
      .toThrow('cross the client boundary')
  })
})
