import { createHash, createHmac } from 'node:crypto'
import type {
  AudienceSyncClient,
  AudienceSyncReceipt,
  ConnectionHealth,
  ConnectionTester,
  ConnectorInfo,
  CrmReader,
  InboundReader,
  StagedBatch,
  TranscriptReader,
  TranscriptRecord,
  WarehouseClient,
  WarehouseQueryReceipt,
} from './contract.js'
import { bearer, requestJson } from './http.js'
import type { HttpRequest, HttpTransport } from './http.js'

function now(): string { return new Date().toISOString() }
function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object') : []
}
function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`)
  return value
}
function safeHttps(value: string, suffixes: string[], label: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !suffixes.some((suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`))) {
    throw new Error(`${label} must be an HTTPS endpoint on ${suffixes.join(' or ')}`)
  }
  return url
}
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }
function staged(connectorId: string, object: StagedBatch['object'], data: unknown, cursor: string | null): StagedBatch {
  return { connectorId, object, extractedAt: now(), cursor, rows: rows(data) }
}

export class PipedriveClient implements CrmReader, ConnectionTester {
  readonly info = { id: 'pipedrive', kind: 'crm' as const, capabilities: ['read_accounts', 'read_contacts', 'read_opportunities', 'read_activities', 'read_leads', 'test_connection'] as const }
  private readonly base = 'https://api.pipedrive.com/api/v1'
  constructor(private readonly accessToken: string, private readonly http: HttpTransport) {}
  private headers() { return bearer(this.accessToken) }
  async testConnection(): Promise<ConnectionHealth> {
    const value = await requestJson<{ data?: { id?: number; company_id?: number } }>(this.http, { method: 'GET', url: `${this.base}/users/me`, headers: this.headers() })
    return { ok: true, provider: 'pipedrive', accountRef: value.data?.company_id === undefined ? null : String(value.data.company_id), detail: 'Pipedrive API reachable' }
  }
  pullAccounts(cursor?: string) { return this.pull('account', 'organizations', cursor) }
  pullContacts(cursor?: string) { return this.pull('contact', 'persons', cursor) }
  pullOpportunities(cursor?: string) { return this.pull('opportunity', 'deals', cursor) }
  pullActivities(cursor?: string) { return this.pull('activity', 'activities', cursor) }
  pullLeads(cursor?: string) { return this.pull('lead', 'leads', cursor) }
  private async pull(object: StagedBatch['object'], resource: string, cursor?: string): Promise<StagedBatch> {
    const params = new URLSearchParams({ limit: '100', start: cursor ?? '0' })
    const value = await requestJson<{ data?: unknown[]; additional_data?: { pagination?: { more_items_in_collection?: boolean; next_start?: number } } }>(this.http, {
      method: 'GET', url: `${this.base}/${resource}?${params}`, headers: this.headers(),
    })
    const page = value.additional_data?.pagination
    return staged('pipedrive', object, value.data, page?.more_items_in_collection && page.next_start !== undefined ? String(page.next_start) : null)
  }
}

export class DynamicsClient implements CrmReader, ConnectionTester {
  readonly info = { id: 'dynamics', kind: 'crm' as const, capabilities: ['read_accounts', 'read_contacts', 'read_opportunities', 'read_activities', 'read_leads', 'test_connection'] as const }
  private readonly base: string
  constructor(instanceUrl: string, private readonly accessToken: string, private readonly http: HttpTransport, apiVersion = 'v9.2') {
    const url = safeHttps(instanceUrl, ['dynamics.com'], 'Dynamics instanceUrl')
    this.base = `${url.origin}/api/data/${apiVersion}`
  }
  private headers() { return { ...bearer(this.accessToken), 'OData-Version': '4.0', 'OData-MaxVersion': '4.0' } }
  async testConnection(): Promise<ConnectionHealth> {
    await requestJson(this.http, { method: 'GET', url: `${this.base}/WhoAmI`, headers: this.headers() })
    return { ok: true, provider: 'dynamics', accountRef: null, detail: 'Microsoft Dataverse API reachable' }
  }
  pullAccounts(cursor?: string) { return this.pull('account', 'accounts', cursor) }
  pullContacts(cursor?: string) { return this.pull('contact', 'contacts', cursor) }
  pullOpportunities(cursor?: string) { return this.pull('opportunity', 'opportunities', cursor) }
  pullActivities(cursor?: string) { return this.pull('activity', 'activitypointers', cursor) }
  pullLeads(cursor?: string) { return this.pull('lead', 'leads', cursor) }
  private async pull(object: StagedBatch['object'], resource: string, cursor?: string): Promise<StagedBatch> {
    const url = cursor ? safeHttps(cursor, ['dynamics.com'], 'Dynamics cursor').toString() : `${this.base}/${resource}?$top=5000`
    const value = await requestJson<{ value?: unknown[]; '@odata.nextLink'?: string }>(this.http, { method: 'GET', url, headers: this.headers() })
    return staged('dynamics', object, value.value, value['@odata.nextLink'] ?? null)
  }
}

export class ZohoCrmClient implements CrmReader, ConnectionTester {
  readonly info = { id: 'zoho-crm', kind: 'crm' as const, capabilities: ['read_accounts', 'read_contacts', 'read_opportunities', 'read_activities', 'read_leads', 'test_connection'] as const }
  private readonly base: string
  constructor(apiDomain: string, private readonly accessToken: string, private readonly http: HttpTransport) {
    this.base = `${safeHttps(apiDomain, ['zohoapis.com', 'zohoapis.eu', 'zohoapis.com.au', 'zohoapis.in', 'zohoapis.jp', 'zohoapis.ca'], 'Zoho apiDomain').origin}/crm/v8`
  }
  private headers() { return { Authorization: `Zoho-oauthtoken ${this.accessToken}` } }
  async testConnection(): Promise<ConnectionHealth> {
    await requestJson(this.http, { method: 'GET', url: `${this.base}/users?type=CurrentUser`, headers: this.headers() })
    return { ok: true, provider: 'zoho-crm', accountRef: null, detail: 'Zoho CRM API reachable' }
  }
  pullAccounts(cursor?: string) { return this.pull('account', 'Accounts', 'id,Account_Name,Website,Industry,Employees,Owner,Modified_Time', cursor) }
  pullContacts(cursor?: string) { return this.pull('contact', 'Contacts', 'id,First_Name,Last_Name,Full_Name,Email,Account_Name,Title,Owner,Modified_Time', cursor) }
  pullOpportunities(cursor?: string) { return this.pull('opportunity', 'Deals', 'id,Deal_Name,Account_Name,Stage,Amount,Closing_Date,Owner,Modified_Time', cursor) }
  pullActivities(cursor?: string) { return this.pull('activity', 'Tasks', 'id,Subject,Who_Id,What_Id,Due_Date,Owner,Modified_Time', cursor) }
  pullLeads(cursor?: string) { return this.pull('lead', 'Leads', 'id,First_Name,Last_Name,Full_Name,Email,Company,Website,Lead_Status,Owner,Modified_Time', cursor) }
  private async pull(object: StagedBatch['object'], module: string, fields: string, cursor?: string): Promise<StagedBatch> {
    const params = new URLSearchParams({ fields, per_page: '200' })
    if (cursor) params.set('page_token', cursor)
    const value = await requestJson<{ data?: unknown[]; info?: { next_page_token?: string | null; more_records?: boolean } }>(this.http, {
      method: 'GET', url: `${this.base}/${module}?${params}`, headers: this.headers(),
    })
    return staged('zoho-crm', object, value.data, value.info?.more_records ? value.info.next_page_token ?? null : null)
  }
}

export class MarketoClient implements InboundReader, ConnectionTester {
  readonly info = { id: 'marketo', kind: 'inbound' as const, capabilities: ['read_inbound_leads', 'read_leads', 'test_connection'] as const }
  private readonly base: string
  constructor(instanceUrl: string, private readonly accessToken: string, private readonly listId: string, private readonly http: HttpTransport) {
    this.base = safeHttps(instanceUrl, ['mktorest.com'], 'Marketo instanceUrl').origin
  }
  private headers() { return bearer(this.accessToken) }
  async testConnection(): Promise<ConnectionHealth> {
    await requestJson(this.http, { method: 'GET', url: `${this.base}/rest/v1/leads/describe.json`, headers: this.headers() })
    return { ok: true, provider: 'marketo', accountRef: null, detail: 'Marketo REST API reachable' }
  }
  async pullLeads(cursor?: string): Promise<StagedBatch> {
    const params = new URLSearchParams({ batchSize: '300' })
    if (cursor) params.set('nextPageToken', cursor)
    const value = await requestJson<{ result?: unknown[]; moreResult?: boolean; nextPageToken?: string }>(this.http, {
      method: 'GET', url: `${this.base}/rest/v1/list/${encodeURIComponent(this.listId)}/leads.json?${params}`, headers: this.headers(),
    })
    return staged('marketo', 'lead', value.result, value.moreResult ? value.nextPageToken ?? null : null)
  }
}

export class GoogleAdsAudienceClient implements AudienceSyncClient, ConnectionTester {
  readonly info = { id: 'google-ads', kind: 'ads' as const, capabilities: ['sync_audience', 'test_connection'] as const }
  constructor(private readonly accessToken: string, private readonly customerId: string, private readonly http: HttpTransport) {}
  private headers() { return bearer(this.accessToken) }
  async testConnection(): Promise<ConnectionHealth> {
    await requestJson(this.http, { method: 'GET', url: 'https://datamanager.googleapis.com/v1/userLists?pageSize=1', headers: this.headers() })
    return { ok: true, provider: 'google-ads', accountRef: this.customerId, detail: 'Google Data Manager API reachable' }
  }
  async syncEmails(audienceId: string, add: string[], remove: string[]): Promise<AudienceSyncReceipt> {
    if (add.length) await this.mutate('ingest', audienceId, add)
    if (remove.length) await this.mutate('remove', audienceId, remove)
    return { provider: 'google-ads', audienceId, added: add.length, removed: remove.length }
  }
  private async mutate(action: 'ingest' | 'remove', audienceId: string, emails: string[]): Promise<void> {
    const audienceMembers = emails.map((email) => ({ compositeData: { userData: { userIdentifiers: [{ emailAddress: hashEmail(email) }] } } }))
    await requestJson(this.http, {
      method: 'POST', url: `https://datamanager.googleapis.com/v1/audienceMembers:${action}`, headers: this.headers(),
      body: JSON.stringify({
        destinations: [{ operatingAccount: { accountType: 'GOOGLE_ADS', accountId: this.customerId }, productDestinationId: audienceId }],
        audienceMembers, encoding: 'HEX', consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' },
        termsOfService: { customerMatchTermsOfServiceStatus: 'ACCEPTED' },
      }),
    })
  }
}

export class MetaAdsAudienceClient implements AudienceSyncClient, ConnectionTester {
  readonly info = { id: 'meta-ads', kind: 'ads' as const, capabilities: ['sync_audience', 'test_connection'] as const }
  constructor(private readonly accessToken: string, private readonly adAccountId: string, private readonly http: HttpTransport, private readonly apiVersion = 'v24.0') {}
  private headers() { return bearer(this.accessToken) }
  async testConnection(): Promise<ConnectionHealth> {
    await requestJson(this.http, { method: 'GET', url: `https://graph.facebook.com/${this.apiVersion}/act_${encodeURIComponent(this.adAccountId)}?fields=id,name`, headers: this.headers() })
    return { ok: true, provider: 'meta-ads', accountRef: this.adAccountId, detail: 'Meta Marketing API reachable' }
  }
  async syncEmails(audienceId: string, add: string[], remove: string[]): Promise<AudienceSyncReceipt> {
    if (add.length) await this.mutate(audienceId, add, 'add')
    if (remove.length) await this.mutate(audienceId, remove, 'remove')
    return { provider: 'meta-ads', audienceId, added: add.length, removed: remove.length }
  }
  private async mutate(audienceId: string, emails: string[], action: 'add' | 'remove'): Promise<void> {
    await requestJson(this.http, {
      method: action === 'add' ? 'POST' : 'DELETE', url: `https://graph.facebook.com/${this.apiVersion}/${encodeURIComponent(audienceId)}/users`, headers: this.headers(),
      body: JSON.stringify({ payload: { schema: 'EMAIL_SHA256', data: emails.map((email) => [hashEmail(email)]) } }),
    })
  }
}

function hashEmail(email: string): string {
  const normalized = email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new Error(`invalid audience email: ${email}`)
  return sha256(normalized)
}

export class DatabricksClient implements WarehouseClient, ConnectionTester {
  readonly info = { id: 'databricks', kind: 'warehouse' as const, capabilities: ['execute_sql', 'test_connection'] as const }
  private readonly base: string
  constructor(
    workspaceUrl: string,
    private readonly accessToken: string,
    private readonly warehouseId: string,
    private readonly http: HttpTransport,
    private readonly polling = { maxAttempts: 20, intervalMs: 500 },
  ) {
    this.base = safeHttps(workspaceUrl, ['databricks.com', 'azuredatabricks.net'], 'Databricks workspaceUrl').origin
  }
  private headers() { return bearer(this.accessToken) }
  async testConnection(): Promise<ConnectionHealth> {
    await this.execute('SELECT 1')
    return { ok: true, provider: 'databricks', accountRef: this.warehouseId, detail: 'Databricks SQL Statement API reachable' }
  }
  async execute(statement: string, bindings: Record<string, string | number | boolean | null> = {}): Promise<WarehouseQueryReceipt> {
    if (!statement.trim()) throw new Error('Databricks statement is required')
    let value = await requestJson<DatabricksStatement>(this.http, {
      method: 'POST', url: `${this.base}/api/2.0/sql/statements`, headers: this.headers(),
      body: JSON.stringify({ statement, warehouse_id: this.warehouseId, wait_timeout: '30s', disposition: 'INLINE', format: 'JSON_ARRAY', parameters: Object.entries(bindings).map(([name, value]) => ({ name, value: value === null ? null : String(value) })) }),
    })
    for (let attempt = 0; isPending(value.status?.state) && value.statement_id && attempt < this.polling.maxAttempts; attempt++) {
      await delay(this.polling.intervalMs)
      value = await requestJson<DatabricksStatement>(this.http, {
        method: 'GET', url: `${this.base}/api/2.0/sql/statements/${encodeURIComponent(value.statement_id)}`, headers: this.headers(),
      })
    }
    if (value.status?.state && ['FAILED', 'CANCELED', 'CLOSED'].includes(value.status.state)) {
      throw new Error(`Databricks statement ${value.status.state.toLowerCase()}: ${value.status.error?.message ?? 'no provider detail'}`)
    }
    const resultRows = value.result?.data_array ?? []
    return { provider: 'databricks', statementHandle: value.statement_id ?? null, rows: resultRows, rowCount: value.result?.row_count ?? resultRows.length, complete: value.status?.state === 'SUCCEEDED' }
  }
}

interface DatabricksStatement {
  statement_id?: string
  status?: { state?: string; error?: { message?: string } }
  result?: { data_array?: unknown[]; row_count?: number }
}

function isPending(state: string | undefined): boolean {
  return state === 'PENDING' || state === 'RUNNING'
}

export class RedshiftClient implements WarehouseClient, ConnectionTester {
  readonly info = { id: 'redshift', kind: 'warehouse' as const, capabilities: ['execute_sql', 'test_connection'] as const }
  constructor(
    private readonly credentials: { region: string; accessKeyId: string; secretAccessKey: string; sessionToken?: string; database: string; clusterIdentifier?: string; workgroupName?: string; secretArn?: string; dbUser?: string },
    private readonly http: HttpTransport,
    private readonly polling = { maxAttempts: 20, intervalMs: 500 },
  ) {
    if (!credentials.clusterIdentifier && !credentials.workgroupName) throw new Error('Redshift clusterIdentifier or workgroupName is required')
  }
  async testConnection(): Promise<ConnectionHealth> {
    await this.execute('SELECT 1')
    return { ok: true, provider: 'redshift', accountRef: this.credentials.clusterIdentifier ?? this.credentials.workgroupName ?? null, detail: 'Amazon Redshift Data API reachable' }
  }
  async execute(statement: string, bindings: Record<string, string | number | boolean | null> = {}): Promise<WarehouseQueryReceipt> {
    if (!statement.trim()) throw new Error('Redshift statement is required')
    const body = JSON.stringify({
      Sql: statement, Database: this.credentials.database,
      ...(this.credentials.clusterIdentifier ? { ClusterIdentifier: this.credentials.clusterIdentifier } : {}),
      ...(this.credentials.workgroupName ? { WorkgroupName: this.credentials.workgroupName } : {}),
      ...(this.credentials.secretArn ? { SecretArn: this.credentials.secretArn } : {}),
      ...(this.credentials.dbUser ? { DbUser: this.credentials.dbUser } : {}),
      Parameters: Object.entries(bindings).map(([name, value]) => ({ name, value: value === null ? '' : String(value) })),
      ClientToken: sha256(`${statement}:${JSON.stringify(bindings)}`).slice(0, 64),
    })
    const value = await this.aws<{ Id?: string }>('ExecuteStatement', body)
    if (!value.Id) throw new Error('Redshift Data API did not return a statement id')
    let status: { Status?: string; Error?: string; HasResultSet?: boolean; ResultRows?: number } = {}
    for (let attempt = 0; attempt <= this.polling.maxAttempts; attempt++) {
      status = await this.aws('DescribeStatement', JSON.stringify({ Id: value.Id }))
      if (!['SUBMITTED', 'PICKED', 'STARTED'].includes(status.Status ?? '')) break
      if (attempt < this.polling.maxAttempts) await delay(this.polling.intervalMs)
    }
    if (status.Status === 'FAILED' || status.Status === 'ABORTED') throw new Error(`Redshift statement ${status.Status.toLowerCase()}: ${status.Error ?? 'no provider detail'}`)
    if (status.Status !== 'FINISHED') return { provider: 'redshift', statementHandle: value.Id, rows: [], rowCount: status.ResultRows ?? 0, complete: false }
    const rows = status.HasResultSet ? await this.results(value.Id) : []
    return { provider: 'redshift', statementHandle: value.Id, rows, rowCount: status.ResultRows ?? rows.length, complete: true }
  }

  private aws<T>(operation: string, body: string): Promise<T> {
    const request = signAwsRequest({
      method: 'POST', url: `https://redshift-data.${this.credentials.region}.amazonaws.com/`, body,
      headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `RedshiftData.${operation}` },
    }, this.credentials)
    return requestJson<T>(this.http, request)
  }

  private async results(id: string): Promise<Record<string, unknown>[]> {
    const output: Record<string, unknown>[] = []
    let nextToken: string | undefined
    do {
      const page: RedshiftResultPage = await this.aws('GetStatementResult', JSON.stringify({ Id: id, ...(nextToken ? { NextToken: nextToken } : {}) }))
      const names = (page.ColumnMetadata ?? []).map((column, index) => column.name ?? `column_${index + 1}`)
      for (const record of page.Records ?? []) output.push(Object.fromEntries(record.map((field, index) => [names[index]!, redshiftField(field)])))
      nextToken = page.NextToken
    } while (nextToken)
    return output
  }
}

interface RedshiftResultPage {
  ColumnMetadata?: Array<{ name?: string }>
  Records?: Array<Array<{ stringValue?: string; longValue?: number; doubleValue?: number; booleanValue?: boolean; blobValue?: string; isNull?: boolean }>>
  NextToken?: string
}

function redshiftField(field: NonNullable<RedshiftResultPage['Records']>[number][number]): unknown {
  if (field.isNull) return null
  return field.stringValue ?? field.longValue ?? field.doubleValue ?? field.booleanValue ?? field.blobValue ?? null
}

function signAwsRequest(request: HttpRequest, credentials: { region: string; accessKeyId: string; secretAccessKey: string; sessionToken?: string }): HttpRequest {
  const url = new URL(request.url)
  const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = timestamp.slice(0, 8)
  const headers: Record<string, string> = { ...request.headers, Host: url.host, 'X-Amz-Date': timestamp }
  if (credentials.sessionToken) headers['X-Amz-Security-Token'] = credentials.sessionToken
  const signedNames = Object.keys(headers).map((name) => name.toLowerCase()).sort()
  const canonicalHeaders = signedNames.map((name) => `${name}:${headers[Object.keys(headers).find((key) => key.toLowerCase() === name)!]!.trim()}\n`).join('')
  const canonical = [request.method, url.pathname, url.searchParams.toString(), canonicalHeaders, signedNames.join(';'), sha256(request.body ?? '')].join('\n')
  const scope = `${date}/${credentials.region}/redshift-data/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, sha256(canonical)].join('\n')
  const dateKey = hmac(`AWS4${credentials.secretAccessKey}`, date)
  const regionKey = hmac(dateKey, credentials.region)
  const serviceKey = hmac(regionKey, 'redshift-data')
  const signingKey = hmac(serviceKey, 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedNames.join(';')}, Signature=${signature}`
  return { ...request, headers }
}
function hmac(key: string | Buffer, value: string): Buffer { return createHmac('sha256', key).update(value).digest() }
function delay(milliseconds: number): Promise<void> { return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve() }

export class FirefliesClient implements TranscriptReader, ConnectionTester {
  readonly info = { id: 'fireflies', kind: 'meetings' as const, capabilities: ['read_transcripts', 'test_connection'] as const }
  constructor(private readonly apiKey: string, private readonly http: HttpTransport) {}
  private headers() { return bearer(this.apiKey) }
  async testConnection(): Promise<ConnectionHealth> {
    await this.graphql('query { user { user_id email } }', {})
    return { ok: true, provider: 'fireflies', accountRef: null, detail: 'Fireflies GraphQL API reachable' }
  }
  async listTranscripts(cursor?: string): Promise<{ records: TranscriptRecord[]; cursor: string | null }> {
    const skip = cursor ? Number(cursor) : 0
    if (!Number.isInteger(skip) || skip < 0) throw new Error('Fireflies cursor must be a nonnegative offset')
    const value = await this.graphql<{ data?: { transcripts?: unknown[] }; errors?: unknown[] }>(
      'query Transcripts($skip: Int!, $limit: Int!) { transcripts(skip: $skip, limit: $limit) { id title date participants sentences { speaker_name text } } }',
      { skip, limit: 50 },
    )
    if (value.errors?.length) throw new Error('Fireflies GraphQL request failed')
    const items = rows(value.data?.transcripts)
    return { records: items.map(firefliesTranscript), cursor: items.length === 50 ? String(skip + 50) : null }
  }
  private graphql<T = unknown>(query: string, variables: Record<string, unknown>): Promise<T> {
    return requestJson<T>(this.http, { method: 'POST', url: 'https://api.fireflies.ai/graphql', headers: this.headers(), body: JSON.stringify({ query, variables }) })
  }
}

function firefliesTranscript(item: Record<string, unknown>): TranscriptRecord {
  return {
    externalId: String(item.id ?? ''), title: String(item.title ?? 'Fireflies meeting'),
    occurredAt: new Date(Number(item.date ?? Date.now())).toISOString(),
    transcript: rows(item.sentences).map((sentence) => `${String(sentence.speaker_name ?? 'Speaker')}: ${String(sentence.text ?? '')}`).join('\n'),
    participants: Array.isArray(item.participants) ? item.participants.map(String) : [],
  }
}

export class ZoomClient implements TranscriptReader, ConnectionTester {
  readonly info = { id: 'zoom', kind: 'meetings' as const, capabilities: ['read_transcripts', 'test_connection'] as const }
  constructor(private readonly accessToken: string, private readonly http: HttpTransport) {}
  private headers() { return bearer(this.accessToken) }
  async testConnection(): Promise<ConnectionHealth> {
    const value = await requestJson<{ id?: string }>(this.http, { method: 'GET', url: 'https://api.zoom.us/v2/users/me', headers: this.headers() })
    return { ok: true, provider: 'zoom', accountRef: value.id ?? null, detail: 'Zoom API reachable' }
  }
  async listTranscripts(cursor?: string): Promise<{ records: TranscriptRecord[]; cursor: string | null }> {
    const params = new URLSearchParams({ page_size: '30' })
    if (cursor) params.set('next_page_token', cursor)
    const value = await requestJson<{ meetings?: unknown[]; next_page_token?: string }>(this.http, { method: 'GET', url: `https://api.zoom.us/v2/users/me/recordings?${params}`, headers: this.headers() })
    const records: TranscriptRecord[] = []
    for (const meeting of rows(value.meetings)) {
      const transcriptFile = rows(meeting.recording_files).find((file) => file.file_type === 'TRANSCRIPT' || file.recording_type === 'audio_transcript')
      if (!transcriptFile?.download_url) continue
      const download = safeHttps(String(transcriptFile.download_url), ['zoom.us'], 'Zoom transcript URL')
      const transcript = await requestJson<unknown>(this.http, { method: 'GET', url: download.toString(), headers: this.headers() })
      records.push({
        externalId: String(meeting.uuid ?? meeting.id ?? ''), title: String(meeting.topic ?? 'Zoom meeting'),
        occurredAt: String(meeting.start_time ?? now()), transcript: typeof transcript === 'string' ? transcript : JSON.stringify(transcript),
        participants: [],
      })
    }
    return { records, cursor: value.next_page_token || null }
  }
}
