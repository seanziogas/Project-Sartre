import { describe, expect, it } from 'vitest'
import type { HttpRequest, HttpTransport } from '../src/http.js'
import { ClayClient, FathomClient, HubSpotClient, SalesforceClient, SlackClient, TeamsClient } from '../src/providers.js'

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
  })

  it('calls the client-owned Clay webhook and returns only its data payload', async () => {
    const http = new ScriptedHttp([{ data: { industry: 'Software' } }])
    const clay = new ClayClient({ apiKey: 'fake', enrichmentUrl: 'https://api.clay.com/webhook' }, http)
    expect(await clay.enrich('acme.example', ['industry'])).toEqual({ industry: 'Software' })
    expect(JSON.parse(http.requests[0]!.body!)).toEqual({ domain: 'acme.example', fields: ['industry'] })
  })

  it('rejects arbitrary Clay webhook hosts to prevent tenant-triggered SSRF', () => {
    expect(() => new ClayClient({ apiKey: 'fake', enrichmentUrl: 'http://127.0.0.1/admin' }, new ScriptedHttp([]))).toThrow('clay.com')
  })

  it('rejects arbitrary Salesforce instance hosts to prevent tenant-triggered SSRF', () => {
    expect(() => new SalesforceClient({ accessToken: 'fake', instanceUrl: 'https://127.0.0.1' }, new ScriptedHttp([]))).toThrow('salesforce.com')
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
})
