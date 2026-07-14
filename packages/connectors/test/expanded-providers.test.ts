import { describe, expect, it } from 'vitest'
import type { HttpRequest, HttpTransport } from '../src/http.js'
import {
  DatabricksClient, DynamicsClient, FirefliesClient, GoogleAdsAudienceClient, MarketoClient,
  MetaAdsAudienceClient, PipedriveClient, RedshiftClient, ZoomClient, ZohoCrmClient,
} from '../src/expanded-providers.js'
import { PROVIDER_CATALOG, validateProviderCredentials } from '../src/catalog.js'
import { createProviderClient } from '../src/providers.js'
import { OAUTH_PROVIDERS } from '../src/oauth.js'

class ScriptedHttp implements HttpTransport {
  requests: HttpRequest[] = []
  constructor(private readonly bodies: unknown[]) {}
  async request(request: HttpRequest) {
    this.requests.push(request)
    return { status: 200, body: this.bodies.shift() ?? {}, headers: {} }
  }
}

describe('expanded mainstream providers', () => {
  it('defines and validates every catalog entry', () => {
    expect(PROVIDER_CATALOG).toHaveLength(40)
    expect(new Set(PROVIDER_CATALOG.map((provider) => provider.id)).size).toBe(40)
    expect(() => validateProviderCredentials('databricks', { accessToken: 'x' })).toThrow('workspaceUrl')
    expect(validateProviderCredentials('fireflies', { apiKey: 'x' })).toBe('fireflies')
    expect(() => validateProviderCredentials('fireflies', { apiKey: 'x' }, 'oauth')).toThrow('does not support oauth')
    expect(validateProviderCredentials('fathom', { apiKey: 'x' }, 'api_key')).toBe('fathom')
    expect(() => validateProviderCredentials('gong', { baseUrl: 'https://x.api.gong.io' }, 'api_key')).toThrow('accessKey/accessKeySecret')
    expect(PROVIDER_CATALOG.filter((provider) => (provider.auth as readonly string[]).includes('oauth')).map((provider) => provider.id).sort())
      .toEqual([...OAUTH_PROVIDERS].sort())
  })

  it('constructs every catalog provider through the central factory', () => {
    const http = new ScriptedHttp([])
    for (const definition of PROVIDER_CATALOG) {
      const credentials = Object.fromEntries(definition.requiredCredentials.map((key) => [key, 'fake']))
      Object.assign(credentials, factoryOverrides(definition.id))
      expect(createProviderClient(definition.id, credentials, http).info.id).toBe(definition.id)
    }
  })

  it('reads Pipedrive pages without putting tokens in URLs', async () => {
    const http = new ScriptedHttp([{ data: [{ id: 1 }], additional_data: { pagination: { more_items_in_collection: true, next_start: 100 } } }])
    expect(await new PipedriveClient('fake', http).pullAccounts()).toMatchObject({ connectorId: 'pipedrive', cursor: '100', rows: [{ id: 1 }] })
    expect(http.requests[0]!.headers?.Authorization).toBe('Bearer fake')
    expect(http.requests[0]!.url).not.toContain('fake')
  })

  it('constrains Dynamics and Zoho tenant API hosts', async () => {
    const dynamicsHttp = new ScriptedHttp([{ value: [{ accountid: 'a1' }], '@odata.nextLink': 'https://acme.api.crm.dynamics.com/next' }])
    const dynamics = new DynamicsClient('https://acme.api.crm.dynamics.com', 'fake', dynamicsHttp)
    expect(await dynamics.pullAccounts()).toMatchObject({ cursor: 'https://acme.api.crm.dynamics.com/next' })
    expect(() => new DynamicsClient('https://attacker.example', 'fake', dynamicsHttp)).toThrow('dynamics.com')
    const zohoHttp = new ScriptedHttp([{ data: [{ id: 'z1' }], info: { more_records: true, next_page_token: 'next' } }])
    expect(await new ZohoCrmClient('https://www.zohoapis.com', 'fake', zohoHttp).pullLeads()).toMatchObject({ connectorId: 'zoho-crm', cursor: 'next' })
    expect(zohoHttp.requests[0]!.headers?.Authorization).toBe('Zoho-oauthtoken fake')
  })

  it('stages Marketo leads from only the configured list', async () => {
    const http = new ScriptedHttp([{ result: [{ id: 7 }], moreResult: true, nextPageToken: 'next' }])
    const client = new MarketoClient({ instanceUrl: 'https://123-ABC-456.mktorest.com', accessToken: 'fake', listId: '42' }, http)
    expect(await client.pullLeads()).toMatchObject({ object: 'lead', cursor: 'next', rows: [{ id: 7 }] })
    expect(http.requests[0]!.url).toContain('/list/42/leads.json')
  })

  it('obtains and reuses Marketo two-legged OAuth tokens without putting secrets in URLs', async () => {
    const http = new ScriptedHttp([{ access_token: 'generated', expires_in: 3600 }, { success: true, result: [] }, { success: true, result: [] }])
    const client = new MarketoClient({ instanceUrl: 'https://123-ABC-456.mktorest.com', clientId: 'client', clientSecret: 'secret', listId: '42' }, http)
    await client.pullLeads()
    await client.pullLeads()
    expect(http.requests[0]).toMatchObject({ method: 'POST', url: 'https://123-abc-456.mktorest.com/identity/oauth/token' })
    expect(http.requests[0]!.body).toContain('client_secret=secret')
    expect(http.requests.slice(1).every((request) => request.headers?.Authorization === 'Bearer generated')).toBe(true)
  })

  it('hashes Google and Meta audience emails locally', async () => {
    const googleHttp = new ScriptedHttp([{}, {}])
    await new GoogleAdsAudienceClient('fake', '123', googleHttp).syncEmails('456', [' Buyer@Example.com '], ['old@example.com'])
    expect(googleHttp.requests).toHaveLength(2)
    expect(googleHttp.requests[0]!.body).not.toContain('Buyer@Example.com')
    expect(JSON.parse(googleHttp.requests[0]!.body!).audienceMembers[0].compositeData.userData.userIdentifiers[0].emailAddress).toMatch(/^[a-f0-9]{64}$/)
    const metaHttp = new ScriptedHttp([{}, {}])
    await new MetaAdsAudienceClient('fake', 'act', metaHttp).syncEmails('audience', ['buyer@example.com'], ['old@example.com'])
    expect(JSON.parse(metaHttp.requests[0]!.body!).payload.data[0][0]).toMatch(/^[a-f0-9]{64}$/)
    expect(metaHttp.requests.map((request) => request.method)).toEqual(['POST', 'DELETE'])
  })

  it('executes Databricks SQL with named bindings', async () => {
    const http = new ScriptedHttp([
      { statement_id: 's1', status: { state: 'PENDING' } },
      { statement_id: 's1', status: { state: 'SUCCEEDED' }, result: { data_array: [[1]], row_count: 1 } },
    ])
    const result = await new DatabricksClient('https://acme.cloud.databricks.com', 'fake', 'warehouse-1', http, { maxAttempts: 2, intervalMs: 0 }).execute('SELECT :score', { score: 7 })
    expect(result).toMatchObject({ complete: true, statementHandle: 's1', rowCount: 1 })
    expect(JSON.parse(http.requests[0]!.body!).parameters).toEqual([{ name: 'score', value: '7' }])
    expect(http.requests[1]).toMatchObject({ method: 'GET', url: 'https://acme.cloud.databricks.com/api/2.0/sql/statements/s1' })
  })

  it('signs idempotent Redshift Data API requests without exposing the secret', async () => {
    const http = new ScriptedHttp([
      { Id: 'statement-1' },
      { Status: 'STARTED' },
      { Status: 'FINISHED', HasResultSet: true, ResultRows: 1 },
      { ColumnMetadata: [{ name: 'id' }], Records: [[{ longValue: 1 }]] },
    ])
    const client = new RedshiftClient({ region: 'us-west-2', accessKeyId: 'AKIATEST', secretAccessKey: 'secret', database: 'dev', workgroupName: 'wg' }, http, { maxAttempts: 2, intervalMs: 0 })
    expect(await client.execute('SELECT :id', { id: 1 })).toMatchObject({ statementHandle: 'statement-1', complete: true, rows: [{ id: 1 }] })
    expect(http.requests[0]!.headers?.Authorization).toContain('Credential=AKIATEST/')
    expect(JSON.stringify(http.requests)).not.toContain('secret')
    expect(JSON.parse(http.requests[0]!.body!).ClientToken).toMatch(/^[a-f0-9]{64}$/)
    expect(http.requests.map((request) => request.headers?.['X-Amz-Target'])).toEqual([
      'RedshiftData.ExecuteStatement', 'RedshiftData.DescribeStatement', 'RedshiftData.DescribeStatement', 'RedshiftData.GetStatementResult',
    ])
  })

  it('reads Fireflies and Zoom transcripts through scripted transports', async () => {
    const firefliesHttp = new ScriptedHttp([{ data: { transcripts: [{ id: 'f1', title: 'Call', date: 1_782_864_000_000, participants: ['a@example.com'], sentences: [{ speaker_name: 'A', text: 'Hi' }] }] } }])
    expect(await new FirefliesClient('fake', firefliesHttp).listTranscripts()).toMatchObject({ records: [{ externalId: 'f1', transcript: 'A: Hi' }] })
    const zoomHttp = new ScriptedHttp([{ meetings: [{ uuid: 'z1', topic: 'Demo', start_time: '2026-07-01T00:00:00Z', recording_files: [{ file_type: 'TRANSCRIPT', download_url: 'https://us02web.zoom.us/rec/transcript' }] }] }, 'WEBVTT transcript'])
    expect(await new ZoomClient('fake', zoomHttp).listTranscripts()).toMatchObject({ records: [{ externalId: 'z1', transcript: 'WEBVTT transcript' }] })
  })
})

function factoryOverrides(provider: string): Record<string, string> {
  const values: Record<string, Record<string, string>> = {
    salesforce: { instanceUrl: 'https://acme.my.salesforce.com' },
    dynamics: { instanceUrl: 'https://acme.crm.dynamics.com' },
    'zoho-crm': { apiDomain: 'https://www.zohoapis.com' },
    clay: { enrichmentUrl: 'https://api.clay.com/webhook' },
    gong: { baseUrl: 'https://us-1.api.gong.io', accessToken: 'fake' },
    heyreach: { enrollmentUrl: 'https://api.heyreach.io/enroll' },
    lemlist: { enrollmentUrl: 'https://api.lemlist.com/enroll' },
    mailshake: { enrollmentUrl: 'https://api.mailshake.com/enroll' },
    snowflake: { accountUrl: 'https://acme.snowflakecomputing.com' },
    databricks: { workspaceUrl: 'https://acme.cloud.databricks.com' },
    redshift: { region: 'us-west-2', database: 'dev', workgroupName: 'wg' },
    sixsense: { signalsUrl: 'https://api.6sense.com/signals' },
    g2: { signalsUrl: 'https://data.g2.com/signals' },
    clearbit: { signalsUrl: 'https://api.clearbit.com/signals' },
    koala: { signalsUrl: 'https://api.getkoala.com/signals' },
    bombora: { signalsUrl: 'https://api.bombora.com/signals' },
    qualified: { leadsUrl: 'https://api.qualified.com/leads' },
    'linkedin-leadgen': { leadsUrl: 'https://api.linkedin.com/leads' },
    typeform: { leadsUrl: 'https://api.typeform.com/responses' },
    chilipiper: { leadsUrl: 'https://api.chilipiper.com/leads' },
    marketo: { instanceUrl: 'https://123-ABC-456.mktorest.com' },
  }
  return values[provider] ?? {}
}
