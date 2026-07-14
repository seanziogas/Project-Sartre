import { Buffer } from 'node:buffer'
import type {
  ConnectionHealth,
  ConnectionTester,
  ConnectorInfo,
  ConnectorSnapshotStore,
  CrmReader,
  CrmWriter,
  EmailReceipt,
  EmailSender,
  InboundReader,
  IntentReader,
  NamespacedWrite,
  SequenceEnrollmentReceipt,
  SequenceLead,
  SequencerClient,
  StagedBatch,
  TranscriptReader,
  TranscriptRecord,
  WarehouseClient,
  WarehouseQueryReceipt,
  WriteReceipt,
} from './contract.js'
import { partitionNamespacedWrites } from './contract.js'
import { bearer, requestJson } from './http.js'
import type { HttpTransport } from './http.js'

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

export interface MainstreamCrmWriteOptions { namespacePrefix: string; snapshots: ConnectorSnapshotStore }

/** Attio standard objects projected into Sartre's staging contract. */
export class AttioClient implements CrmReader, CrmWriter, ConnectionTester {
  readonly info: ConnectorInfo
  private readonly base = 'https://api.attio.com/v2'
  constructor(private readonly accessToken: string, private readonly http: HttpTransport, private readonly writes?: MainstreamCrmWriteOptions) {
    this.info = { id: 'attio', kind: 'crm', capabilities: [
      'read_accounts', 'read_contacts', 'read_opportunities', 'read_activities', 'read_leads', 'test_connection',
      ...(writes ? ['snapshot', 'write_namespaced_fields'] as const : []),
    ] }
  }
  private headers() { return bearer(this.accessToken) }
  async testConnection(): Promise<ConnectionHealth> {
    const value = await requestJson<{ workspace_id?: string }>(this.http, { method: 'GET', url: `${this.base}/self`, headers: this.headers() })
    return { ok: true, provider: 'attio', accountRef: value.workspace_id ?? null, detail: 'Attio API reachable' }
  }
  pullAccounts(cursor?: string): Promise<StagedBatch> { return this.pullRecords('account', 'companies', cursor) }
  pullContacts(cursor?: string): Promise<StagedBatch> { return this.pullRecords('contact', 'people', cursor) }
  pullOpportunities(cursor?: string): Promise<StagedBatch> { return this.pullRecords('opportunity', 'deals', cursor) }
  pullLeads(cursor?: string): Promise<StagedBatch> { return this.pullRecords('lead', 'people', cursor) }
  async pullActivities(cursor?: string): Promise<StagedBatch> {
    const params = new URLSearchParams({ limit: '100' })
    if (cursor) params.set('cursor', cursor)
    const value = await requestJson<{ data?: unknown[]; pagination?: { next_cursor?: string } }>(this.http, {
      method: 'GET', url: `${this.base}/meetings?${params}`, headers: this.headers(),
    })
    return { connectorId: 'attio', object: 'activity', extractedAt: now(), cursor: value.pagination?.next_cursor ?? null, rows: rows(value.data) }
  }
  async snapshot(writes: NamespacedWrite[]): Promise<string> {
    const options = this.requireWrites()
    const partitioned = partitionNamespacedWrites(writes, options.namespacePrefix)
    if (partitioned.rejected.length) throw new Error(partitioned.rejected[0]!.reason)
    const sourceValues = await Promise.all(partitioned.allowed.map((write) => requestJson(this.http, {
      method: 'GET', url: `${this.base}/objects/${attioObject(write.object)}/records/${encodeURIComponent(write.externalId)}`,
      headers: this.headers(),
    })))
    return options.snapshots.capture('attio', partitioned.allowed, sourceValues)
  }
  async writeNamespaced(writes: NamespacedWrite[], snapshotRef: string): Promise<WriteReceipt> {
    const options = this.requireWrites()
    if (!await options.snapshots.exists('attio', snapshotRef)) throw new Error('valid Attio snapshot is required before write')
    const partitioned = partitionNamespacedWrites(writes, options.namespacePrefix)
    for (const write of partitioned.allowed) await requestJson(this.http, {
      method: 'PATCH', url: `${this.base}/objects/${attioObject(write.object)}/records/${encodeURIComponent(write.externalId)}`,
      headers: this.headers(), body: JSON.stringify({ data: { values: write.fields } }),
    })
    return { written: partitioned.allowed.length, rejected: partitioned.rejected, snapshotRef }
  }
  private requireWrites(): MainstreamCrmWriteOptions {
    if (!this.writes) throw new Error('Attio writes require snapshot storage and a namespace prefix')
    return this.writes
  }
  private async pullRecords(object: StagedBatch['object'], attioType: string, cursor?: string): Promise<StagedBatch> {
    const offset = cursor ? Number(cursor) : 0
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Attio cursor must be a nonnegative offset')
    const value = await requestJson<{ data?: unknown[] }>(this.http, {
      method: 'POST', url: `${this.base}/objects/${attioType}/records/query`, headers: this.headers(),
      body: JSON.stringify({ limit: 500, offset }),
    })
    const batch = rows(value.data)
    return { connectorId: 'attio', object, extractedAt: now(), cursor: batch.length === 500 ? String(offset + 500) : null, rows: batch }
  }
}

function attioObject(object: NamespacedWrite['object']): string {
  return { account: 'companies', contact: 'people', opportunity: 'deals' }[object]
}

export class OutreachClient implements SequencerClient, ConnectionTester {
  readonly info = { id: 'outreach', kind: 'sequencer' as const, capabilities: ['enroll_sequence', 'test_connection'] as const }
  private readonly base = 'https://api.outreach.io/api/v2'
  constructor(private readonly accessToken: string, private readonly mailboxId: string, private readonly http: HttpTransport) {}
  private headers() { return { ...bearer(this.accessToken), Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json' } }
  async testConnection(): Promise<ConnectionHealth> {
    await requestJson(this.http, { method: 'GET', url: `${this.base}/users?page[limit]=1`, headers: this.headers() })
    return { ok: true, provider: 'outreach', accountRef: null, detail: 'Outreach API reachable' }
  }
  async enroll(campaignId: string, leads: SequenceLead[]): Promise<SequenceEnrollmentReceipt> {
    required(campaignId, 'Outreach sequence id')
    let enrolled = 0
    for (const lead of leads) {
      const prospectId = stringField(lead.customFields, 'outreachProspectId') ?? await this.createProspect(lead)
      await requestJson(this.http, {
        method: 'POST', url: `${this.base}/sequenceStates`, headers: this.headers(),
        body: JSON.stringify({ data: { type: 'sequenceState', relationships: {
          prospect: { data: { type: 'prospect', id: prospectId } },
          sequence: { data: { type: 'sequence', id: campaignId } },
          mailbox: { data: { type: 'mailbox', id: this.mailboxId } },
        } } }),
      })
      enrolled++
    }
    return { provider: 'outreach', campaignId, enrolled, skipped: leads.length - enrolled }
  }
  private async createProspect(lead: SequenceLead): Promise<string> {
    const value = await requestJson<{ data?: { id?: string | number } }>(this.http, {
      method: 'POST', url: `${this.base}/prospects`, headers: this.headers(),
      body: JSON.stringify({ data: { type: 'prospect', attributes: {
        emails: [lead.email], firstName: lead.firstName, lastName: lead.lastName, company: lead.companyName,
      } } }),
    })
    return required(String(value.data?.id ?? ''), 'Outreach prospect id')
  }
}

export class SalesloftClient implements SequencerClient, ConnectionTester {
  readonly info = { id: 'salesloft', kind: 'sequencer' as const, capabilities: ['enroll_sequence', 'test_connection'] as const }
  private readonly base = 'https://api.salesloft.com/v2'
  constructor(private readonly accessToken: string, private readonly http: HttpTransport) {}
  private headers() { return bearer(this.accessToken) }
  async testConnection(): Promise<ConnectionHealth> {
    const value = await requestJson<{ data?: { id?: number } }>(this.http, { method: 'GET', url: `${this.base}/me.json`, headers: this.headers() })
    return { ok: true, provider: 'salesloft', accountRef: value.data?.id === undefined ? null : String(value.data.id), detail: 'Salesloft API reachable' }
  }
  async enroll(campaignId: string, leads: SequenceLead[]): Promise<SequenceEnrollmentReceipt> {
    required(campaignId, 'Salesloft cadence id')
    let enrolled = 0
    for (const lead of leads) {
      const personId = stringField(lead.customFields, 'salesloftPersonId') ?? await this.createPerson(lead)
      const params = new URLSearchParams({ person_id: personId, cadence_id: campaignId })
      await requestJson(this.http, { method: 'POST', url: `${this.base}/cadence_memberships.json?${params}`, headers: this.headers(), body: '{}' })
      enrolled++
    }
    return { provider: 'salesloft', campaignId, enrolled, skipped: leads.length - enrolled }
  }
  private async createPerson(lead: SequenceLead): Promise<string> {
    const value = await requestJson<{ data?: { id?: number } }>(this.http, {
      method: 'POST', url: `${this.base}/people.json`, headers: this.headers(),
      body: JSON.stringify({ email_address: lead.email, first_name: lead.firstName, last_name: lead.lastName, custom_fields: lead.customFields }),
    })
    return required(value.data?.id === undefined ? '' : String(value.data.id), 'Salesloft person id')
  }
}

export class ApolloClient implements SequencerClient, ConnectionTester {
  readonly info = { id: 'apollo', kind: 'sequencer' as const, capabilities: ['enroll_sequence', 'test_connection'] as const }
  private readonly base = 'https://api.apollo.io/api/v1'
  constructor(private readonly apiKey: string, private readonly http: HttpTransport) {}
  private headers() { return { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' } }
  async testConnection(): Promise<ConnectionHealth> {
    await requestJson(this.http, { method: 'GET', url: 'https://api.apollo.io/v1/auth/health', headers: this.headers() })
    return { ok: true, provider: 'apollo', accountRef: null, detail: 'Apollo API reachable' }
  }
  async enroll(campaignId: string, leads: SequenceLead[]): Promise<SequenceEnrollmentReceipt> {
    const contactIds: string[] = []
    for (const lead of leads) {
      const existing = stringField(lead.customFields, 'apolloContactId')
      if (existing) contactIds.push(existing)
      else {
        const value = await requestJson<{ contact?: { id?: string } }>(this.http, {
          method: 'POST', url: `${this.base}/contacts`, headers: this.headers(),
          body: JSON.stringify({ email: lead.email, first_name: lead.firstName, last_name: lead.lastName, organization_name: lead.companyName }),
        })
        contactIds.push(required(value.contact?.id, 'Apollo contact id'))
      }
    }
    if (contactIds.length) await requestJson(this.http, {
      method: 'POST', url: `${this.base}/emailer_campaigns/${encodeURIComponent(campaignId)}/add_contact_ids`, headers: this.headers(),
      body: JSON.stringify({ contact_ids: contactIds, send_email_from_email_account_id: null }),
    })
    return { provider: 'apollo', campaignId, enrolled: contactIds.length, skipped: leads.length - contactIds.length }
  }
}

/** Partner APIs with tenant-specific routes can still use a provider-host-only enrollment URL. */
export class PartnerSequencerClient implements SequencerClient, ConnectionTester {
  readonly info: ConnectorInfo
  private readonly url: URL
  constructor(readonly provider: 'heyreach' | 'lemlist' | 'mailshake', enrollmentUrl: string, private readonly apiKey: string, private readonly http: HttpTransport) {
    const hosts = { heyreach: ['heyreach.io'], lemlist: ['lemlist.com'], mailshake: ['mailshake.com'] }[provider]
    this.url = safeHttps(enrollmentUrl, hosts, `${provider} enrollmentUrl`)
    this.info = { id: provider, kind: 'sequencer', capabilities: ['enroll_sequence', 'test_connection'] }
  }
  async testConnection(): Promise<ConnectionHealth> {
    return { ok: true, provider: this.provider, accountRef: null, detail: `${this.provider} provider-host enrollment URL validated` }
  }
  async enroll(campaignId: string, leads: SequenceLead[]): Promise<SequenceEnrollmentReceipt> {
    const value = await requestJson<{ enrolled?: number; skipped?: number }>(this.http, {
      method: 'POST', url: this.url.toString(), headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId, leads }),
    })
    return { provider: this.provider, campaignId, enrolled: value.enrolled ?? leads.length, skipped: value.skipped ?? 0 }
  }
}

export class GongClient implements TranscriptReader, ConnectionTester {
  readonly info = { id: 'gong', kind: 'meetings' as const, capabilities: ['read_transcripts', 'test_connection'] as const }
  private readonly base: string
  private readonly authorization: string
  constructor(credentials: { accessToken?: string; accessKey?: string; accessKeySecret?: string; baseUrl: string; lookbackDays?: string }, private readonly http: HttpTransport) {
    this.base = safeHttps(credentials.baseUrl, ['api.gong.io'], 'Gong baseUrl').origin
    this.authorization = credentials.accessToken
      ? `Bearer ${credentials.accessToken}`
      : `Basic ${Buffer.from(`${required(credentials.accessKey, 'accessKey')}:${required(credentials.accessKeySecret, 'accessKeySecret')}`).toString('base64')}`
    this.lookbackDays = Number(credentials.lookbackDays ?? 30)
    if (!Number.isInteger(this.lookbackDays) || this.lookbackDays < 1 || this.lookbackDays > 365) throw new Error('Gong lookbackDays must be 1-365')
  }
  private readonly lookbackDays: number
  private headers() { return { Authorization: this.authorization, 'Content-Type': 'application/json' } }
  async testConnection(): Promise<ConnectionHealth> {
    await requestJson(this.http, { method: 'GET', url: `${this.base}/v2/users`, headers: this.headers() })
    return { ok: true, provider: 'gong', accountRef: null, detail: 'Gong API reachable' }
  }
  async listTranscripts(cursor?: string): Promise<{ records: TranscriptRecord[]; cursor: string | null }> {
    const to = new Date()
    const from = new Date(to.getTime() - this.lookbackDays * 86_400_000)
    const value = await requestJson<{ records?: { cursor?: string }; callTranscripts?: unknown[] }>(this.http, {
      method: 'POST', url: `${this.base}/v2/calls/transcript`, headers: this.headers(),
      body: JSON.stringify({ filter: { fromDateTime: from.toISOString(), toDateTime: to.toISOString() }, ...(cursor ? { cursor } : {}) }),
    })
    return {
      records: rows(value.callTranscripts).map((call) => gongTranscript(call)),
      cursor: value.records?.cursor ?? null,
    }
  }
}

function gongTranscript(call: Record<string, unknown>): TranscriptRecord {
  const monologues = rows(call.transcript)
  return {
    externalId: String(call.callId ?? ''), title: String(call.title ?? `Gong call ${String(call.callId ?? '')}`),
    occurredAt: String(call.started ?? call.occurredAt ?? now()),
    transcript: monologues.flatMap((monologue) => rows(monologue.sentences).map((sentence) => `${String(monologue.speakerId ?? 'Speaker')}: ${String(sentence.text ?? '')}`)).join('\n'),
    participants: [...new Set(monologues.map((monologue) => String(monologue.speakerId ?? '')).filter(Boolean))],
  }
}

export class SnowflakeClient implements WarehouseClient, ConnectionTester {
  readonly info = { id: 'snowflake', kind: 'warehouse' as const, capabilities: ['execute_sql', 'test_connection'] as const }
  private readonly base: string
  constructor(
    private readonly credentials: { accountUrl: string; token: string; warehouse?: string; database?: string; schema?: string; role?: string },
    private readonly http: HttpTransport,
    private readonly polling = { maxAttempts: 20, intervalMs: 500 },
  ) {
    this.base = safeHttps(credentials.accountUrl, ['snowflakecomputing.com'], 'Snowflake accountUrl').origin
  }
  private headers() { return { Authorization: `Bearer ${this.credentials.token}`, 'Content-Type': 'application/json', Accept: 'application/json' } }
  async testConnection(): Promise<ConnectionHealth> {
    await this.execute('SELECT CURRENT_ACCOUNT()')
    return { ok: true, provider: 'snowflake', accountRef: null, detail: 'Snowflake SQL API reachable' }
  }
  async execute(statement: string, bindings: Record<string, string | number | boolean | null> = {}): Promise<WarehouseQueryReceipt> {
    if (!statement.trim()) throw new Error('Snowflake statement is required')
    let value = await requestJson<SnowflakeStatement>(this.http, {
      method: 'POST', url: `${this.base}/api/v2/statements`, headers: this.headers(),
      body: JSON.stringify({ statement, bindings: snowflakeBindings(bindings), warehouse: this.credentials.warehouse, database: this.credentials.database, schema: this.credentials.schema, role: this.credentials.role }),
    })
    const statementHandle = value.statementHandle
    for (let attempt = 0; !value.data && statementHandle && attempt < this.polling.maxAttempts; attempt++) {
      await delay(this.polling.intervalMs)
      value = await requestJson<SnowflakeStatement>(this.http, {
        method: 'GET', url: `${this.base}/api/v2/statements/${encodeURIComponent(statementHandle)}`, headers: this.headers(),
      })
    }
    if (!value.data) return { provider: 'snowflake', statementHandle: statementHandle ?? null, rows: [], rowCount: 0, complete: false }
    const resultRows = [...value.data]
    const partitions = value.resultSetMetaData?.partitionInfo?.length ?? 1
    if (partitions > 1 && !statementHandle) throw new Error('Snowflake partitioned result is missing a statement handle')
    for (let partition = 1; partition < partitions; partition++) {
      const page = await requestJson<SnowflakeStatement>(this.http, {
        method: 'GET', url: `${this.base}/api/v2/statements/${encodeURIComponent(statementHandle!)}?partition=${partition}`, headers: this.headers(),
      })
      resultRows.push(...(page.data ?? []))
    }
    return { provider: 'snowflake', statementHandle: statementHandle ?? null, rows: resultRows, rowCount: value.resultSetMetaData?.numRows ?? resultRows.length, complete: true }
  }
}

interface SnowflakeStatement {
  statementHandle?: string
  data?: unknown[]
  message?: string
  resultSetMetaData?: { numRows?: number; partitionInfo?: Array<{ rowCount?: number }> }
}

function snowflakeBindings(bindings: Record<string, string | number | boolean | null>) {
  return Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key, {
    type: typeof value === 'number' ? 'FIXED' : typeof value === 'boolean' ? 'BOOLEAN' : 'TEXT',
    value: value === null ? null : String(value),
  }]))
}

export class BigQueryClient implements WarehouseClient, ConnectionTester {
  readonly info = { id: 'bigquery', kind: 'warehouse' as const, capabilities: ['execute_sql', 'test_connection'] as const }
  constructor(
    private readonly projectId: string,
    private readonly accessToken: string,
    private readonly http: HttpTransport,
    private readonly location?: string,
    private readonly polling = { maxAttempts: 20, intervalMs: 500 },
  ) {}
  private headers() { return bearer(this.accessToken) }
  async testConnection(): Promise<ConnectionHealth> {
    await this.execute('SELECT 1')
    return { ok: true, provider: 'bigquery', accountRef: this.projectId, detail: 'BigQuery API reachable' }
  }
  async execute(statement: string, bindings: Record<string, string | number | boolean | null> = {}): Promise<WarehouseQueryReceipt> {
    if (!statement.trim()) throw new Error('BigQuery statement is required')
    let value = await requestJson<BigQueryResult>(this.http, {
      method: 'POST', url: `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(this.projectId)}/queries`, headers: this.headers(),
      body: JSON.stringify({ query: statement, useLegacySql: false, ...(this.location ? { location: this.location } : {}), parameterMode: 'NAMED', queryParameters: bigQueryParameters(bindings) }),
    })
    const jobId = value.jobReference?.jobId
    for (let attempt = 0; value.jobComplete === false && jobId && attempt < this.polling.maxAttempts; attempt++) {
      await delay(this.polling.intervalMs)
      value = await this.results(jobId)
    }
    if (value.jobComplete === false) return { provider: 'bigquery', statementHandle: jobId ?? null, rows: [], rowCount: 0, complete: false }
    if (value.errors?.length) throw new Error(`BigQuery query failed: ${value.errors.map((error) => error.message ?? error.reason ?? 'unknown error').join('; ')}`)
    const resultRows = [...(value.rows ?? [])]
    let pageToken = value.pageToken
    for (let page = 0; pageToken && jobId && page < 100; page++) {
      const next = await this.results(jobId, pageToken)
      if (next.errors?.length) throw new Error(`BigQuery result page failed: ${next.errors.map((error) => error.message ?? error.reason ?? 'unknown error').join('; ')}`)
      resultRows.push(...(next.rows ?? []))
      pageToken = next.pageToken
      if (page === 99 && pageToken) throw new Error('BigQuery results exceeded 100 pages')
    }
    return { provider: 'bigquery', statementHandle: jobId ?? null, rows: resultRows, rowCount: Number(value.totalRows ?? resultRows.length), complete: true }
  }

  private results(jobId: string, pageToken?: string): Promise<BigQueryResult> {
    const params = new URLSearchParams({ timeoutMs: '10000', ...(this.location ? { location: this.location } : {}), ...(pageToken ? { pageToken } : {}) })
    return requestJson<BigQueryResult>(this.http, {
      method: 'GET', url: `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(this.projectId)}/queries/${encodeURIComponent(jobId)}?${params}`, headers: this.headers(),
    })
  }
}

interface BigQueryResult {
  jobComplete?: boolean
  jobReference?: { jobId?: string }
  rows?: unknown[]
  totalRows?: string
  pageToken?: string
  errors?: Array<{ message?: string; reason?: string }>
}

function bigQueryParameters(bindings: Record<string, string | number | boolean | null>) {
  return Object.entries(bindings).map(([name, value]) => ({
    name,
    parameterType: { type: typeof value === 'number' ? 'FLOAT64' : typeof value === 'boolean' ? 'BOOL' : 'STRING' },
    parameterValue: { value: value === null ? null : String(value) },
  }))
}

function delay(milliseconds: number): Promise<void> { return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve() }

export type HostedIntentProvider = 'sixsense' | 'g2' | 'clearbit' | 'koala' | 'bombora'
const intentHosts: Record<HostedIntentProvider, string[]> = {
  sixsense: ['6sense.com'], g2: ['g2.com'], clearbit: ['clearbit.com'], koala: ['getkoala.com'], bombora: ['bombora.com'],
}

/** Contract-specific partner endpoints remain provider-host constrained and tenant configured. */
export class HostedIntentClient implements IntentReader, ConnectionTester {
  readonly info: ConnectorInfo
  private readonly url: URL
  constructor(readonly provider: HostedIntentProvider, signalsUrl: string, private readonly apiKey: string, private readonly http: HttpTransport) {
    this.url = safeHttps(signalsUrl, intentHosts[provider], `${provider} signalsUrl`)
    this.info = { id: provider, kind: 'intent', capabilities: ['read_intent_signals', 'test_connection'] }
  }
  async testConnection(): Promise<ConnectionHealth> {
    await this.pullSignals()
    return { ok: true, provider: this.provider, accountRef: null, detail: `${this.provider} intent endpoint reachable` }
  }
  async pullSignals(cursor?: string): Promise<StagedBatch> {
    const url = new URL(this.url)
    if (cursor) url.searchParams.set('cursor', cursor)
    const value = await requestJson<{ data?: unknown[]; results?: unknown[]; items?: unknown[]; next_cursor?: string; cursor?: string }>(this.http, {
      method: 'GET', url: url.toString(), headers: { Authorization: `Bearer ${this.apiKey}`, 'X-Api-Key': this.apiKey },
    })
    return { connectorId: this.provider, object: 'signal', extractedAt: now(), cursor: value.next_cursor ?? value.cursor ?? null, rows: rows(value.data ?? value.results ?? value.items) }
  }
}

export type HostedInboundProvider = 'qualified' | 'linkedin-leadgen' | 'typeform' | 'chilipiper'
const inboundHosts: Record<HostedInboundProvider, string[]> = {
  qualified: ['qualified.com'], 'linkedin-leadgen': ['linkedin.com'], typeform: ['typeform.com'], chilipiper: ['chilipiper.com'],
}
export class HostedInboundClient implements InboundReader, ConnectionTester {
  readonly info: ConnectorInfo
  private readonly url: URL
  constructor(readonly provider: HostedInboundProvider, leadsUrl: string, private readonly accessToken: string, private readonly http: HttpTransport) {
    this.url = safeHttps(leadsUrl, inboundHosts[provider], `${provider} leadsUrl`)
    this.info = { id: provider, kind: 'inbound', capabilities: ['read_inbound_leads', 'read_leads', 'test_connection'] }
  }
  async testConnection(): Promise<ConnectionHealth> {
    await this.pullLeads()
    return { ok: true, provider: this.provider, accountRef: null, detail: `${this.provider} inbound endpoint reachable` }
  }
  async pullLeads(cursor?: string): Promise<StagedBatch> {
    const url = new URL(this.url)
    if (cursor) url.searchParams.set('cursor', cursor)
    const value = await requestJson<{ items?: unknown[]; responses?: unknown[]; data?: unknown[]; next_cursor?: string; cursor?: string }>(this.http, {
      method: 'GET', url: url.toString(), headers: bearer(this.accessToken),
    })
    return { connectorId: this.provider, object: 'lead', extractedAt: now(), cursor: value.next_cursor ?? value.cursor ?? null, rows: rows(value.items ?? value.responses ?? value.data) }
  }
}

export class GmailClient implements EmailSender, ConnectionTester {
  readonly info = { id: 'gmail', kind: 'comms' as const, capabilities: ['send_email', 'test_connection'] as const }
  constructor(private readonly accessToken: string, private readonly http: HttpTransport) {}
  private headers() { return bearer(this.accessToken) }
  async testConnection(): Promise<ConnectionHealth> {
    const value = await requestJson<{ emailAddress?: string }>(this.http, { method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/profile', headers: this.headers() })
    return { ok: true, provider: 'gmail', accountRef: value.emailAddress ?? null, detail: 'Gmail API reachable' }
  }
  async sendEmail(input: { to: string[]; subject: string; text: string; replyTo?: string }): Promise<EmailReceipt> {
    validateEmailInput(input)
    const raw = Buffer.from([`To: ${input.to.join(', ')}`, `Subject: ${input.subject}`, ...(input.replyTo ? [`Reply-To: ${input.replyTo}`] : []), 'Content-Type: text/plain; charset=utf-8', '', input.text].join('\r\n')).toString('base64url')
    const value = await requestJson<{ id?: string }>(this.http, { method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', headers: this.headers(), body: JSON.stringify({ raw }) })
    return { provider: 'gmail', messageId: required(value.id, 'Gmail message id'), recipients: input.to }
  }
}

export class MicrosoftEmailClient implements EmailSender, ConnectionTester {
  readonly info = { id: 'microsoft-email', kind: 'comms' as const, capabilities: ['send_email', 'test_connection'] as const }
  constructor(private readonly accessToken: string, private readonly http: HttpTransport) {}
  private headers() { return bearer(this.accessToken) }
  async testConnection(): Promise<ConnectionHealth> {
    const value = await requestJson<{ mail?: string; userPrincipalName?: string }>(this.http, { method: 'GET', url: 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', headers: this.headers() })
    return { ok: true, provider: 'microsoft-email', accountRef: value.mail ?? value.userPrincipalName ?? null, detail: 'Microsoft Graph mail reachable' }
  }
  async sendEmail(input: { to: string[]; subject: string; text: string; replyTo?: string }): Promise<EmailReceipt> {
    validateEmailInput(input)
    await requestJson(this.http, {
      method: 'POST', url: 'https://graph.microsoft.com/v1.0/me/sendMail', headers: this.headers(),
      body: JSON.stringify({ message: { subject: input.subject, body: { contentType: 'Text', content: input.text }, toRecipients: input.to.map((address) => ({ emailAddress: { address } })), ...(input.replyTo ? { replyTo: [{ emailAddress: { address: input.replyTo } }] } : {}) }, saveToSentItems: true }),
    })
    return { provider: 'microsoft-email', messageId: 'accepted', recipients: input.to }
  }
}

function validateEmailInput(input: { to: string[]; subject: string; text: string }) {
  if (!input.to.length || input.to.some((email) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) throw new Error('valid email recipients are required')
  if (!input.subject.trim() || !input.text.trim()) throw new Error('email subject and text are required')
}

function stringField(fields: SequenceLead['customFields'], key: string): string | null {
  const value = fields?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}
