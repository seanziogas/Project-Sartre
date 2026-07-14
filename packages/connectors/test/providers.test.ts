import { describe, expect, it } from 'vitest'
import type { HttpRequest, HttpTransport } from '../src/http.js'
import { ClayClient, FathomClient, HubSpotClient, InstantlyClient, LinkedInAdsClient, SalesforceClient, SlackClient, SmartleadClient, TeamsClient } from '../src/providers.js'

class ScriptedHttp implements HttpTransport {
  requests: HttpRequest[] = []
  constructor(private readonly bodies: unknown[]) {}
  async request(request: HttpRequest) {
    this.requests.push(request)
    return { status: 200, body: this.bodies.shift() ?? {}, headers: {} }
  }
}

describe('production provider clients (scripted HTTP)', () => {
  it('pulls tenant CRM rows from Salesforce and HubSpot with cursors', async () => {
    const sfHttp = new ScriptedHttp([{ records: [{ Id: '001' }], nextRecordsUrl: '/next' }])
    const sf = new SalesforceClient({ accessToken: 'fake', instanceUrl: 'https://acme.my.salesforce.com' }, sfHttp)
    expect(await sf.pullAccounts()).toMatchObject({ connectorId: 'salesforce', object: 'account', cursor: '/next', rows: [{ Id: '001' }] })
    expect(sfHttp.requests[0]!.url).toContain('/services/data/v67.0/query?q=')

    const hsHttp = new ScriptedHttp([{ results: [{ id: '1' }], paging: { next: { after: '2' } } }])
    const hs = new HubSpotClient({ accessToken: 'fake' }, hsHttp)
    expect(await hs.pullContacts()).toMatchObject({ connectorId: 'hubspot', object: 'contact', cursor: '2', rows: [{ id: '1' }] })
    expect(hsHttp.requests[0]!.url).toContain('/crm/v3/objects/contacts')
  })

  it('calls the client-owned Clay webhook and returns only its data payload', async () => {
    const http = new ScriptedHttp([{ data: { industry: 'Software' } }])
    const clay = new ClayClient({ apiKey: 'fake', enrichmentUrl: 'https://api.clay.com/webhook' }, http)
    expect(await clay.enrich('acme.example', ['industry'])).toEqual({ industry: 'Software' })
    expect(JSON.parse(http.requests[0]!.body!)).toEqual({ domain: 'acme.example', fields: ['industry'] })
  })

  it('tests a client-owned Clay health endpoint when configured', async () => {
    const http = new ScriptedHttp([{}])
    const clay = new ClayClient({
      apiKey: 'fake', enrichmentUrl: 'https://api.clay.com/webhook', healthcheckUrl: 'https://api.clay.com/health',
    }, http)
    expect(await clay.testConnection()).toMatchObject({ ok: true, detail: 'Clay healthcheck reachable' })
    expect(http.requests[0]).toMatchObject({ method: 'GET', url: 'https://api.clay.com/health' })
  })

  it('rejects arbitrary Clay webhook hosts to prevent tenant-triggered SSRF', () => {
    expect(() => new ClayClient({ apiKey: 'fake', enrichmentUrl: 'http://127.0.0.1/admin' }, new ScriptedHttp([]))).toThrow('clay.com')
  })

  it('rejects arbitrary Salesforce instance hosts to prevent tenant-triggered SSRF', () => {
    expect(() => new SalesforceClient({ accessToken: 'fake', instanceUrl: 'https://127.0.0.1' }, new ScriptedHttp([]))).toThrow('salesforce.com')
  })

  it('rejects Salesforce pagination cursors that leave the configured tenant host', async () => {
    const salesforce = new SalesforceClient({ accessToken: 'fake', instanceUrl: 'https://acme.my.salesforce.com' }, new ScriptedHttp([]))
    await expect(salesforce.pullAccounts('https://attacker.example/next')).rejects.toThrow('configured instance')
  })

  it('sends through Slack and Teams only when explicitly invoked after a gate', async () => {
    const slackHttp = new ScriptedHttp([{ ok: true, ts: '123.4' }])
    expect((await new SlackClient('fake', slackHttp).sendMessage('C1', 'Approved')).externalId).toBe('123.4')
    const teamsHttp = new ScriptedHttp([{ id: 'message-1' }])
    expect((await new TeamsClient('fake', teamsHttp).sendMessage('team:channel', 'Approved')).externalId).toBe('message-1')
  })

  it('reads Fathom transcripts without leaking credentials into URLs', async () => {
    const http = new ScriptedHttp([{ items: [{ recording_id: 7, meeting_title: 'Call', created_at: '2026-07-01T00:00:00Z', transcript: [{ speaker: { display_name: 'A' }, text: 'Hello' }], calendar_invitees: [{ email: 'a@example.com' }] }], next_cursor: 'next' }])
    const result = await new FathomClient('fake-key', http).listTranscripts()
    expect(result).toMatchObject({ cursor: 'next', records: [{ externalId: '7', transcript: 'A: Hello' }] })
    expect(http.requests[0]!.url).not.toContain('fake-key')
    expect(http.requests[0]!.headers).toEqual({ 'X-Api-Key': 'fake-key' })
  })

  it('enrolls only explicitly supplied leads through Smartlead and Instantly', async () => {
    const smartleadHttp = new ScriptedHttp([{ added_count: 1, skipped_count: 0 }])
    const smartlead = new SmartleadClient('fake-key', smartleadHttp)
    expect(await smartlead.enroll('campaign-1', [{ email: 'buyer@example.com', customFields: { approved: true } }]))
      .toMatchObject({ provider: 'smartlead', campaignId: 'campaign-1', enrolled: 1 })
    expect(smartleadHttp.requests[0]!.url).toContain('/campaigns/campaign-1/leads')

    const instantlyHttp = new ScriptedHttp([{ uploaded: 1, skipped: 0 }])
    const instantly = new InstantlyClient('fake-key', instantlyHttp)
    expect(await instantly.enroll('campaign-2', [{ email: 'buyer@example.com' }]))
      .toMatchObject({ provider: 'instantly', campaignId: 'campaign-2', enrolled: 1 })
    expect(instantlyHttp.requests[0]!.headers?.Authorization).toBe('Bearer fake-key')
  })

  it('hashes audience emails before sending LinkedIn audience mutations', async () => {
    const http = new ScriptedHttp([{}])
    const receipt = await new LinkedInAdsClient('fake-token', http).syncEmails('10804', [' Buyer@Example.com '], [])
    expect(receipt).toMatchObject({ added: 1, removed: 0 })
    expect(http.requests[0]!.body).not.toContain('Buyer@Example.com')
    expect(JSON.parse(http.requests[0]!.body!).elements[0].userIds[0].idValue).toMatch(/^[a-f0-9]{64}$/)
  })

  it('requires a persisted source snapshot and namespace before CRM writes', async () => {
    const captured = new Set<string>()
    const snapshots = {
      capture: async () => { captured.add('snapshot-1'); return 'snapshot-1' },
      exists: async (_provider: string, ref: string) => captured.has(ref),
    }
    const http = new ScriptedHttp([{ Id: '001', Kiln_Score__c: 10 }, {}])
    const salesforce = new SalesforceClient(
      { accessToken: 'fake', instanceUrl: 'https://acme.my.salesforce.com' },
      http,
      { namespacePrefix: 'Kiln_', snapshots },
    )
    const writes = [{ object: 'account' as const, externalId: '001', fields: { Kiln_Score__c: 90 } }]
    const snapshotRef = await salesforce.snapshot(writes)
    expect((await salesforce.writeNamespaced(writes, snapshotRef)).written).toBe(1)
    expect(http.requests.map((request) => request.method)).toEqual(['GET', 'PATCH'])
    await expect(salesforce.snapshot([{ object: 'account', externalId: '001', fields: { Name: 'Changed' } }])).rejects.toThrow('outside namespace')
    await expect(salesforce.writeNamespaced(writes, 'missing')).rejects.toThrow('snapshot is required')
  })

  it('requires a source snapshot and configured converted status before Salesforce lead conversion', async () => {
    const captured = new Set<string>()
    const snapshots = {
      capture: async (provider: string) => { captured.add(`${provider}:lead-snapshot`); return 'lead-snapshot' },
      exists: async (provider: string, ref: string) => captured.has(`${provider}:${ref}`),
    }
    const http = new ScriptedHttp([
      { Id: '00Q1', Status: 'Qualified' },
      { compositeResponse: [{ httpStatusCode: 200, body: { outputValues: { contactId: '0031' } } }] },
    ])
    const salesforce = new SalesforceClient(
      { accessToken: 'fake', instanceUrl: 'https://acme.my.salesforce.com', convertedLeadStatus: 'Qualified' },
      http,
      { namespacePrefix: 'Kiln_', snapshots },
    )
    const requests = [{ leadExternalId: '00Q1', targetAccountExternalId: '0011' }]
    const snapshot = await salesforce.snapshotLeads(requests)
    expect(await salesforce.convertLeads(requests, snapshot)).toMatchObject({ converted: 1, snapshotRef: 'lead-snapshot' })
    expect(JSON.parse(http.requests[1]!.body!).compositeRequest[0].body.inputs[0]).toMatchObject({
      leadId: '00Q1', accountId: '0011', convertedStatus: 'Qualified',
    })
    await expect(salesforce.convertLeads(requests, 'missing')).rejects.toThrow('snapshot is required')
  })
})
