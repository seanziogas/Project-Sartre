import { describe, expect, it } from 'vitest'
import { mapSourceRow, parseSourceMapping } from '../src/index.js'

const mapping = {
  object: 'account',
  externalIdField: 'Id',
  fields: [
    { source: 'Company', target: 'name', transform: 'trim', required: true },
    { source: 'Website', target: 'domain', transform: 'domain' },
    { source: 'AnnualRevenue', target: 'revenueUsd', transform: 'number' },
  ],
} as const

describe('source-to-canonical mapping', () => {
  it('normalizes mapped fields and attaches CRM provenance', () => {
    const candidate = mapSourceRow(
      { Id: '001-acme', Company: ' Acme, Inc. ', Website: 'https://www.Acme.com/us', AnnualRevenue: '$125,000,000' },
      mapping,
      { clientId: 'Acme', connectorId: 'salesforce', extractedAt: '2026-07-13T12:00:00Z', runId: 'run-1' },
    )

    expect(candidate).toMatchObject({
      object: 'account',
      clientId: 'Acme',
      connectorId: 'salesforce',
      observedAt: '2026-07-13T12:00:00Z',
      externalIds: { salesforce: '001-acme' },
      fields: {
        name: { value: 'Acme, Inc.', provenance: { source: 'crm', origin: 'salesforce', runId: 'run-1' } },
        domain: { value: 'acme.com' },
        revenueUsd: { value: 125000000 },
      },
      problems: [],
    })
  })

  it('surfaces missing and malformed values instead of dropping the row', () => {
    const candidate = mapSourceRow(
      { Id: null, Company: '', Website: 'not-a-domain', AnnualRevenue: 'unknown' },
      mapping,
      { clientId: 'Acme', connectorId: 'hubspot', extractedAt: '2026-07-13T12:00:00Z' },
    )

    expect(candidate.externalIds).toEqual({})
    expect(candidate.problems).toEqual(expect.arrayContaining([
      'external id field Id is missing or invalid',
      'required source field Company is missing',
      'Website → domain: invalid domain',
      'AnnualRevenue → revenueUsd: expected a finite number',
    ]))
  })

  it('rejects unknown and duplicate canonical targets before processing', () => {
    expect(() => parseSourceMapping({
      object: 'account',
      externalIdField: 'Id',
      fields: [{ source: 'X', target: 'madeUpField' }],
    })).toThrow('target is not canonical')
    expect(() => parseSourceMapping({
      object: 'contact',
      externalIdField: 'Id',
      fields: [
        { source: 'Email', target: 'email' },
        { source: 'OtherEmail', target: 'email' },
      ],
    })).toThrow('duplicate mapping target')
    expect(() => parseSourceMapping({
      object: 'contact',
      externalIdField: 'Id',
      fields: [],
      references: [{ source: 'AccountId', target: 'accountId', recordType: 'contact' }],
    })).toThrow('must resolve account')
  })
})
