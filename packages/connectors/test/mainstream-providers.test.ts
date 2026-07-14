import { describe, expect, it } from 'vitest'
import type { HttpRequest, HttpTransport } from '../src/http.js'
import {
  ApolloClient,
  AttioClient,
  BigQueryClient,
  GmailClient,
  GongClient,
  HostedInboundClient,
  HostedIntentClient,
  MicrosoftEmailClient,
  OutreachClient,
  PartnerSequencerClient,
  SalesloftClient,
  SnowflakeClient,
} from '../src/mainstream-providers.js'
import { createProviderClient, isSupportedProvider, SUPPORTED_PROVIDERS } from '../src/providers.js'

class ScriptedHttp implements HttpTransport {
  requests: HttpRequest[] = []
  constructor(private readonly bodies: unknown[]) {}
  async request(request: HttpRequest) {
    this.requests.push(request)
    return { status: 200, body: this.bodies.shift() ?? {}, headers: {} }
  }
}

describe('mainstream provider clients (scripted HTTP)', () => {
  it('publishes one testable registry for every supported provider', () => {
    expect(SUPPORTED_PROVIDERS).toHaveLength(40)
    expect(new Set(SUPPORTED_PROVIDERS).size).toBe(SUPPORTED_PROVIDERS.length)
    expect(isSupportedProvider('attio')).toBe(true)
    expect(isSupportedProvider('arbitrary-host')).toBe(false)
  })

  it('reads Attio records and keeps CRM writes snapshot-backed and namespaced', async () => {
    const captured = new Set<string>()
    const http = new ScriptedHttp([
      { data: [{ id: 'company-1' }] },
      { data: { values: { kiln_score: 12 } } },
      {},
    ])
    const attio = new AttioClient('fake-token', http, {
      namespacePrefix: 'kiln_',
      snapshots: {
        capture: async () => { captured.add('snapshot-1'); return 'snapshot-1' },
        exists: async (_provider, ref) => captured.has(ref),
      },
    })
    expect(await attio.pullAccounts()).toMatchObject({ connectorId: 'attio', rows: [{ id: 'company-1' }] })
    const writes = [{ object: 'account' as const, externalId: 'company-1', fields: { kiln_score: 90 } }]
    const snapshot = await attio.snapshot(writes)
    expect((await attio.writeNamespaced(writes, snapshot)).written).toBe(1)
    await expect(attio.snapshot([{ object: 'account', externalId: 'company-1', fields: { name: 'No' } }])).rejects.toThrow('outside namespace')
  })

  it('enrolls reviewed leads in Outreach, Salesloft, and Apollo', async () => {
    const outreachHttp = new ScriptedHttp([{}])
    const outreach = new OutreachClient('fake', 'mailbox-1', outreachHttp)
    expect(await outreach.enroll('sequence-1', [{ email: 'a@example.com', customFields: { outreachProspectId: '42' } }]))
      .toMatchObject({ provider: 'outreach', enrolled: 1 })
    expect(outreachHttp.requests[0]!.url).toContain('/sequenceStates')

    const salesloftHttp = new ScriptedHttp([{}])
    const salesloft = new SalesloftClient('fake', salesloftHttp)
    expect(await salesloft.enroll('cadence-1', [{ email: 'a@example.com', customFields: { salesloftPersonId: '7' } }]))
      .toMatchObject({ provider: 'salesloft', enrolled: 1 })
    expect(salesloftHttp.requests[0]!.url).toContain('person_id=7')

    const apolloHttp = new ScriptedHttp([{}, {}])
    const apollo = new ApolloClient('fake', apolloHttp)
    expect((await apollo.testConnection()).ok).toBe(true)
    expect(apolloHttp.requests[0]).toMatchObject({ method: 'GET', url: 'https://api.apollo.io/v1/auth/health' })
    expect(await apollo.enroll('campaign-1', [{ email: 'a@example.com', customFields: { apolloContactId: 'contact-1' } }]))
      .toMatchObject({ provider: 'apollo', enrolled: 1 })
  })

  it('constrains tenant-configured partner routes to the provider host', async () => {
    expect(() => new PartnerSequencerClient('lemlist', 'http://127.0.0.1/private', 'fake', new ScriptedHttp([]))).toThrow('lemlist.com')
    const http = new ScriptedHttp([{ enrolled: 1 }])
    const client = new PartnerSequencerClient('lemlist', 'https://api.lemlist.com/v1/enroll', 'fake', http)
    expect(await client.enroll('campaign', [{ email: 'a@example.com' }])).toMatchObject({ enrolled: 1 })
  })

  it('reads Gong transcripts using a tenant-specific Gong API host', async () => {
    const http = new ScriptedHttp([{ records: { cursor: 'next' }, callTranscripts: [{ callId: 'c1', title: 'Demo', started: '2026-07-01T00:00:00Z', transcript: [{ speakerId: 's1', sentences: [{ text: 'Hello' }] }] }] }])
    const gong = new GongClient({ baseUrl: 'https://us-12345.api.gong.io', accessKey: 'key', accessKeySecret: 'secret' }, http)
    expect(await gong.listTranscripts()).toMatchObject({ cursor: 'next', records: [{ externalId: 'c1', transcript: 's1: Hello' }] })
    expect(http.requests[0]!.url).not.toContain('secret')
    expect(http.requests[0]!.headers?.Authorization).toMatch(/^Basic /)
    expect(() => new GongClient({ baseUrl: 'https://example.com', accessToken: 'fake' }, http)).toThrow('api.gong.io')
  })

  it('executes parameterized Snowflake and BigQuery statements', async () => {
    const snowflakeHttp = new ScriptedHttp([{ statementHandle: 'h1', data: [[1]], resultSetMetaData: { numRows: 1 } }])
    const snowflake = new SnowflakeClient({ accountUrl: 'https://acme.snowflakecomputing.com', token: 'fake', warehouse: 'COMPUTE_WH' }, snowflakeHttp)
    expect(await snowflake.execute('SELECT :1', { 1: 7 })).toMatchObject({ provider: 'snowflake', rowCount: 1, complete: true })
    expect(JSON.parse(snowflakeHttp.requests[0]!.body!).bindings['1']).toEqual({ type: 'FIXED', value: '7' })

    const bigQueryHttp = new ScriptedHttp([{ jobComplete: true, jobReference: { jobId: 'job-1' }, rows: [{ f: [{ v: '1' }] }], totalRows: '1' }])
    const bigQuery = new BigQueryClient('project-1', 'fake', bigQueryHttp, 'US')
    expect(await bigQuery.execute('SELECT @score', { score: 7 })).toMatchObject({ provider: 'bigquery', statementHandle: 'job-1', complete: true })
    expect(JSON.parse(bigQueryHttp.requests[0]!.body!).queryParameters[0].name).toBe('score')
  })

  it('stages provider-hosted intent signals and inbound leads', async () => {
    const intentHttp = new ScriptedHttp([{ data: [{ id: 'signal-1' }], next_cursor: 'next' }])
    const intent = new HostedIntentClient('sixsense', 'https://api.6sense.com/v1/signals', 'fake', intentHttp)
    expect(await intent.pullSignals()).toMatchObject({ connectorId: 'sixsense', object: 'signal', cursor: 'next' })

    const inboundHttp = new ScriptedHttp([{ responses: [{ id: 'lead-1' }] }])
    const inbound = new HostedInboundClient('typeform', 'https://api.typeform.com/forms/form-1/responses', 'fake', inboundHttp)
    expect(await inbound.pullLeads()).toMatchObject({ connectorId: 'typeform', object: 'lead', rows: [{ id: 'lead-1' }] })
    expect(() => new HostedInboundClient('typeform', 'https://attacker.example/leads', 'fake', inboundHttp)).toThrow('typeform.com')
  })

  it('builds valid Gmail and Microsoft mail requests without sending live mail', async () => {
    const gmailHttp = new ScriptedHttp([{ id: 'gmail-1' }])
    expect(await new GmailClient('fake', gmailHttp).sendEmail({ to: ['a@example.com'], subject: 'Approved', text: 'Body' }))
      .toMatchObject({ messageId: 'gmail-1' })
    expect(JSON.parse(gmailHttp.requests[0]!.body!).raw).toMatch(/^[A-Za-z0-9_-]+$/)

    const microsoftHttp = new ScriptedHttp([{}])
    expect(await new MicrosoftEmailClient('fake', microsoftHttp).sendEmail({ to: ['a@example.com'], subject: 'Approved', text: 'Body' }))
      .toMatchObject({ messageId: 'accepted' })
    await expect(new GmailClient('fake', gmailHttp).sendEmail({ to: ['bad'], subject: 'Approved', text: 'Body' })).rejects.toThrow('valid email')
  })

  it('constructs every hosted class through the central factory', () => {
    const http = new ScriptedHttp([])
    expect(createProviderClient('attio', { accessToken: 'fake' }, http).info.id).toBe('attio')
    expect(createProviderClient('snowflake', { accountUrl: 'https://acme.snowflakecomputing.com', token: 'fake' }, http).info.id).toBe('snowflake')
    expect(createProviderClient('g2', { signalsUrl: 'https://data.g2.com/signals', apiKey: 'fake' }, http).info.id).toBe('g2')
  })
})
