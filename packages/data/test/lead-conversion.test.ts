import { describe, expect, it } from 'vitest'
import type { Account, Contact } from '@sartre/core'
import {
  mapSourceRow,
  planLeadConversions,
  promoteAccountCandidates,
  promoteContactCandidates,
} from '../src/index.js'

const NOW = () => new Date('2026-07-13T12:00:00Z')

function account(clientId: string, id: string, externalId: string, domain: string): Account {
  const candidate = mapSourceRow(
    { Id: externalId, Name: `Account ${externalId}`, Website: domain },
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
  return promoteAccountCandidates(clientId, [candidate], [], { now: NOW, createId: () => id }).records[0]!
}

function contact(clientId: string, id: string, externalId: string, email: string, parent: Account): Contact {
  const candidate = mapSourceRow(
    { Id: externalId, FirstName: 'Existing', LastName: 'Buyer', Email: email, AccountId: parent.externalIds.salesforce },
    {
      object: 'contact',
      externalIdField: 'Id',
      fields: [
        { source: 'FirstName', target: 'firstName', transform: 'trim' },
        { source: 'LastName', target: 'lastName', transform: 'trim' },
        { source: 'Email', target: 'email', transform: 'email' },
      ],
      references: [{ source: 'AccountId', target: 'accountId', recordType: 'account' }],
    },
    { clientId, connectorId: 'salesforce', extractedAt: '2026-07-13T10:00:00Z' },
  )
  candidate.fields.accountId = { value: parent.id, provenance: candidate.references[0]!.provenance }
  return promoteContactCandidates(clientId, [candidate], [], [parent], { now: NOW, createId: () => id }).records[0]!
}

const ACME = account('Acme', '00000000-0000-4000-8000-000000000601', '001-acme', 'acme.example')
const BUYER = contact('Acme', '00000000-0000-4000-8000-000000000602', '003-buyer', 'buyer@acme.example', ACME)

describe('lead conversion planning', () => {
  it('converts exact accounts, creates only well-identified accounts, and surfaces unsafe leads', () => {
    const plan = planLeadConversions(
      'Acme',
      [
        { clientId: 'Acme', sourceSystem: 'salesforce', externalId: '00Q-existing-account', firstName: 'New', lastName: 'Lead', email: 'new@acme.example', companyName: 'Acme', companyDomain: 'www.acme.example', doNotConvert: false },
        { clientId: 'Acme', sourceSystem: 'salesforce', externalId: '00Q-new-account', firstName: 'A', lastName: 'B', email: 'a@newco.example', companyName: 'NewCo', companyDomain: 'newco.example', doNotConvert: false },
        { clientId: 'Acme', sourceSystem: 'salesforce', externalId: '00Q-existing-contact', firstName: 'Existing', lastName: 'Buyer', email: 'BUYER@ACME.EXAMPLE', companyName: 'Acme', companyDomain: 'acme.example', doNotConvert: false },
        { clientId: 'Acme', sourceSystem: 'salesforce', externalId: '00Q-no-email', firstName: null, lastName: null, email: null, companyName: 'Unknown', companyDomain: 'unknown.example', doNotConvert: false },
        { clientId: 'Acme', sourceSystem: 'salesforce', externalId: '00Q-opted-out', firstName: 'No', lastName: 'Touch', email: 'no@touch.example', companyName: 'Touch', companyDomain: 'touch.example', doNotConvert: true },
        { clientId: 'Acme', sourceSystem: 'salesforce', externalId: '00Q-consumer-domain', firstName: 'Personal', lastName: 'Lead', email: 'person@gmail.com', companyName: 'Unknown', companyDomain: 'gmail.com', doNotConvert: false },
      ],
      [ACME],
      [BUYER],
    )

    expect(plan.decisions.map((decision) => decision.action)).toEqual([
      'convert_existing_account',
      'convert_new_account',
      'skip_existing_contact',
      'manual_review',
      'skip_opted_out',
      'manual_review',
    ])
    expect(plan.requests).toEqual([
      { leadExternalId: '00Q-existing-account', targetAccountExternalId: '001-acme', createAccount: false },
      { leadExternalId: '00Q-new-account', targetAccountExternalId: null, createAccount: true },
    ])
  })

  it('never uses canonical records from another tenant', () => {
    const foreign = account('OtherClient', '00000000-0000-4000-8000-000000000603', '001-other', 'other.example')
    expect(() => planLeadConversions('Acme', [], [foreign], [])).toThrow('cross the client boundary')
    expect(() => planLeadConversions('Acme', [{
      clientId: 'OtherClient', sourceSystem: 'salesforce', externalId: '00Q-foreign', firstName: null,
      lastName: null, email: 'a@other.example', companyName: 'Other', companyDomain: 'other.example', doNotConvert: false,
    }], [], [])).toThrow('crosses the client boundary')
  })

  it('never mixes conversion requests for different CRM systems', () => {
    expect(() => planLeadConversions('Acme', [
      { clientId: 'Acme', sourceSystem: 'salesforce', externalId: '00Q-1', firstName: null, lastName: null, email: 'a@one.example', companyName: 'One', companyDomain: 'one.example', doNotConvert: false },
      { clientId: 'Acme', sourceSystem: 'hubspot', externalId: 'lead-2', firstName: null, lastName: null, email: 'b@two.example', companyName: 'Two', companyDomain: 'two.example', doNotConvert: false },
    ], [], [])).toThrow('cannot mix source systems')
  })
})
