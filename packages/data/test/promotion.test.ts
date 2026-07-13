import { describe, expect, it } from 'vitest'
import type { Account } from '@sartre/core'
import {
  canonicalAuditRows,
  canonicalClosedLostRows,
  canonicalDuplicateReviewGroups,
  mapSourceRow,
  promoteAccountCandidates,
  promoteContactCandidates,
  promoteOpportunityCandidates,
} from '../src/index.js'

const NOW = () => new Date('2026-07-13T14:00:00Z')

function accountCandidate(clientId: string, externalId: string, name: string, domain: string) {
  return mapSourceRow(
    { Id: externalId, Name: name, Website: domain, Industry: 'Software', OwnerId: 'rep-1', LastModifiedDate: '2026-07-01T10:00:00-07:00' },
    {
      object: 'account',
      externalIdField: 'Id',
      fields: [
        { source: 'Name', target: 'name', transform: 'trim', required: true },
        { source: 'Website', target: 'domain', transform: 'domain' },
        { source: 'Industry', target: 'industry', transform: 'trim' },
        { source: 'OwnerId', target: 'ownerRef', transform: 'trim' },
        { source: 'LastModifiedDate', target: 'sourceUpdatedAt', transform: 'datetime' },
      ],
    },
    { clientId, connectorId: 'salesforce', extractedAt: '2026-07-13T12:00:00Z' },
  )
}

describe('canonical candidate promotion', () => {
  it('creates separate golden accounts and flags duplicate groups without merging', () => {
    const ids = [
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000202',
    ]
    const promoted = promoteAccountCandidates(
      'Acme',
      [
        accountCandidate('Acme', '001', 'Acme Inc.', 'acme.com'),
        accountCandidate('Acme', '002', 'Acme Incorporated', 'https://www.acme.com'),
      ],
      [],
      { now: NOW, createId: () => ids.shift()! },
    )

    expect(promoted.records).toHaveLength(2)
    expect(promoted.records.map((record) => record.externalIds.salesforce)).toEqual(['001', '002'])
    expect(promoted.records.every((record) => record.flags.includes('duplicate'))).toBe(true)
    expect(promoted.duplicateGroups).toMatchObject([
      { matchedOn: 'domain', memberIds: expect.arrayContaining([
        '00000000-0000-4000-8000-000000000201',
        '00000000-0000-4000-8000-000000000202',
      ]) },
    ])
    expect(canonicalDuplicateReviewGroups(promoted.records, [])).toMatchObject([{
      recordType: 'account',
      matchedOn: 'domain',
      confidence: 'high',
      members: expect.arrayContaining([
        expect.objectContaining({ canonicalId: '00000000-0000-4000-8000-000000000201' }),
        expect.objectContaining({ canonicalId: '00000000-0000-4000-8000-000000000202' }),
      ]),
    }])
  })

  it('updates by external identity but does not overwrite a human-corrected field', () => {
    const first = promoteAccountCandidates(
      'Acme',
      [accountCandidate('Acme', '001', 'Acme', 'acme.com')],
      [],
      { now: NOW, createId: () => '00000000-0000-4000-8000-000000000203' },
    ).records[0]!
    const human: Account = {
      ...first,
      industry: {
        value: 'Human-corrected vertical',
        provenance: {
          source: 'human',
          origin: 'gtme@kiln',
          retrievedAt: '2026-07-13T13:00:00Z',
          confidence: 'high',
        },
      },
    }
    const incoming = accountCandidate('Acme', '001', 'Acme Updated', 'acme.com')
    incoming.fields.industry = {
      value: 'CRM vertical',
      provenance: {
        source: 'crm',
        origin: 'salesforce',
        retrievedAt: '2026-07-13T15:00:00Z',
        confidence: 'high',
      },
    }

    const promoted = promoteAccountCandidates('Acme', [incoming], [human], { now: NOW })
    expect(promoted.records).toHaveLength(1)
    expect(promoted.records[0]).toMatchObject({
      id: human.id,
      name: { value: 'Acme Updated' },
      industry: { value: 'Human-corrected vertical', provenance: { source: 'human' } },
    })
  })

  it('promotes contacts, retains tenant errors, and creates audit-ready views', () => {
    const account = promoteAccountCandidates(
      'Acme',
      [accountCandidate('Acme', '001', 'Acme', 'acme.com')],
      [],
      { now: NOW, createId: () => '00000000-0000-4000-8000-000000000204' },
    ).records[0]!
    const mapping = {
      object: 'contact',
      externalIdField: 'Id',
      fields: [
        { source: 'FirstName', target: 'firstName', transform: 'trim' },
        { source: 'LastName', target: 'lastName', transform: 'trim' },
        { source: 'Email', target: 'email', transform: 'email' },
        { source: 'OwnerId', target: 'ownerRef', transform: 'trim' },
        { source: 'LastModifiedDate', target: 'sourceUpdatedAt', transform: 'datetime' },
      ],
      references: [
        { source: 'AccountId', target: 'accountId', recordType: 'account', required: true },
      ],
    } as const
    const candidate = mapSourceRow(
      { Id: '003', FirstName: 'Jane', LastName: 'Doe', Email: 'JANE@ACME.COM', AccountId: account.id, OwnerId: 'rep-1', LastModifiedDate: '2026-07-02T00:00:00Z' },
      mapping,
      { clientId: 'Acme', connectorId: 'salesforce', extractedAt: '2026-07-13T12:00:00Z' },
    )
    candidate.fields.accountId = { value: account.id, provenance: candidate.references[0]!.provenance }
    const wrongTenant = { ...candidate, clientId: 'OtherClient' }
    const promoted = promoteContactCandidates(
      'Acme',
      [candidate, wrongTenant],
      [],
      [account],
      { now: NOW, createId: () => '00000000-0000-4000-8000-000000000205' },
    )
    const audit = canonicalAuditRows([account], promoted.records)

    expect(promoted.records).toHaveLength(1)
    expect(promoted.problems).toMatchObject([{ candidateIndex: 1, problem: expect.stringContaining('does not match') }])
    expect(audit.accounts[0]).toMatchObject({ ownerRef: 'rep-1', domain: 'acme.com' })
    expect(audit.accounts[0]?.updatedAt).toBe('2026-07-01T17:00:00.000Z')
    expect(audit.contacts[0]).toMatchObject({ email: 'jane@acme.com', accountRef: account.id, companyName: 'Acme', updatedAt: '2026-07-02T00:00:00.000Z' })
  })

  it('builds closed-lost grading rows from canonical relationships and excludes protected accounts', () => {
    const account = promoteAccountCandidates(
      'Acme',
      [accountCandidate('Acme', '001', 'Acme', 'acme.com')],
      [],
      { now: NOW, createId: () => '00000000-0000-4000-8000-000000000206' },
    ).records[0]!
    const candidate = mapSourceRow(
      {
        Id: '006', AccountId: '001', Name: 'Expansion', Stage: 'Closed Lost', Amount: 50000,
        CloseDate: '2026-06-01T00:00:00Z', IsClosed: true, IsWon: false, LossReason: 'Timing',
      },
      {
        object: 'opportunity',
        externalIdField: 'Id',
        fields: [
          { source: 'Name', target: 'name', transform: 'trim' },
          { source: 'Stage', target: 'stage', transform: 'trim' },
          { source: 'Amount', target: 'amountUsd', transform: 'number' },
          { source: 'CloseDate', target: 'closeDate', transform: 'datetime' },
          { source: 'IsClosed', target: 'isClosed', transform: 'boolean' },
          { source: 'IsWon', target: 'isWon', transform: 'boolean' },
          { source: 'LossReason', target: 'lossReason', transform: 'trim' },
        ],
        references: [{ source: 'AccountId', target: 'accountId', recordType: 'account' }],
      },
      { clientId: 'Acme', connectorId: 'salesforce', extractedAt: '2026-07-13T12:00:00Z' },
    )
    candidate.fields.accountId = { value: account.id, provenance: candidate.references[0]!.provenance }
    const opportunity = promoteOpportunityCandidates(
      'Acme',
      [candidate],
      [],
      { now: NOW, createId: () => '00000000-0000-4000-8000-000000000207' },
    ).records[0]!

    expect(canonicalClosedLostRows([account], [opportunity])).toMatchObject([{
      id: opportunity.id,
      fields: { account_name: 'Acme', opportunity_amount_usd: '50000' },
    }])
    expect(canonicalClosedLostRows([{ ...account, flags: ['excluded'] }], [opportunity])).toEqual([])
  })
})
