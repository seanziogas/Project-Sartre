import { createHash } from 'node:crypto'
import type {
  AudienceSyncClient,
  AudienceSyncReceipt,
  ConnectionHealth,
  ConnectionTester,
  ConnectorInfo,
  CrmReader,
  CrmWriter,
  ConnectorSnapshotStore,
  EnrichmentProvider,
  MessageReceipt,
  MessageSender,
  StagedBatch,
  TranscriptReader,
  TranscriptRecord,
  NamespacedWrite,
  SequenceLead,
  SequenceEnrollmentReceipt,
  SequencerClient,
  WriteReceipt,
} from './contract.js'
import { partitionNamespacedWrites } from './contract.js'
import { bearer, requestJson } from './http.js'
import type { HttpTransport } from './http.js'
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
} from './mainstream-providers.js'

export * from './mainstream-providers.js'

function now(): string { return new Date().toISOString() }
function objectRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object') : []
}

abstract class BearerProvider implements ConnectionTester {
  abstract readonly info: ConnectionTester['info']
  constructor(protected readonly accessToken: string, protected readonly http: HttpTransport) {}
  protected headers(): Record<string, string> { return bearer(this.accessToken) }
  abstract testConnection(): Promise<ConnectionHealth>
}

export interface SalesforceCredentials { accessToken: string; instanceUrl: string; apiVersion?: string }
export interface CrmWriteOptions { namespacePrefix: string; snapshots: ConnectorSnapshotStore }

export class SalesforceClient extends BearerProvider implements CrmReader, CrmWriter {
  readonly info: ConnectorInfo
  private readonly base: string
  constructor(private readonly credentials: SalesforceCredentials, http: HttpTransport, private readonly writeOptions?: CrmWriteOptions) {
    super(credentials.accessToken, http)
    const instanceUrl = new URL(credentials.instanceUrl)
    if (instanceUrl.protocol !== 'https:' || (instanceUrl.hostname !== 'salesforce.com' && !instanceUrl.hostname.endsWith('.salesforce.com'))) {
      throw new Error('Salesforce instanceUrl must be an HTTPS endpoint on salesforce.com')
    }
    this.info = {
      id: 'salesforce', kind: 'crm',
      capabilities: [
        'read_accounts', 'read_contacts', 'read_opportunities', 'read_activities', 'read_leads', 'test_connection',
        ...(writeOptions ? ['snapshot', 'write_namespaced_fields'] as const : []),
      ],
    }
    this.base = `${instanceUrl.origin}/services/data/v${credentials.apiVersion ?? '67.0'}`
  }
  async testConnection(): Promise<ConnectionHealth> {
    const value = await requestJson<{ Identity?: { orgId?: string } }>(this.http, { method: 'GET', url: `${this.base}/limits`, headers: this.headers() })
    return { ok: true, provider: 'salesforce', accountRef: value.Identity?.orgId ?? null, detail: 'Salesforce API reachable' }
  }
  pullAccounts(cursor?: string): Promise<StagedBatch> { return this.query('account', 'SELECT Id,Name,Website,Industry,NumberOfEmployees,OwnerId,LastModifiedDate FROM Account', cursor) }
  pullContacts(cursor?: string): Promise<StagedBatch> { return this.query('contact', 'SELECT Id,FirstName,LastName,Email,AccountId,Title,OwnerId,LastModifiedDate FROM Contact', cursor) }
  pullOpportunities(cursor?: string): Promise<StagedBatch> { return this.query('opportunity', 'SELECT Id,Name,AccountId,StageName,Amount,CloseDate,OwnerId,LastModifiedDate FROM Opportunity', cursor) }
  pullActivities(cursor?: string): Promise<StagedBatch> { return this.query('activity', 'SELECT Id,Subject,WhoId,WhatId,ActivityDate,OwnerId,LastModifiedDate FROM Task', cursor) }
  pullLeads(cursor?: string): Promise<StagedBatch> { return this.query('lead', 'SELECT Id,FirstName,LastName,Email,Company,Website,Status,OwnerId,LastModifiedDate FROM Lead', cursor) }
  async snapshot(writes: NamespacedWrite[]): Promise<string> {
    const options = this.requireWriteOptions()
    const { allowed, rejected } = partitionNamespacedWrites(writes, options.namespacePrefix)
    if (rejected.length) throw new Error(rejected[0]!.reason)
    const sourceValues = await Promise.all(allowed.map((write) => requestJson<unknown>(this.http, {
      method: 'GET',
      url: `${this.base}/sobjects/${salesforceObject(write.object)}/${encodeURIComponent(write.externalId)}?fields=${encodeURIComponent(Object.keys(write.fields).join(','))}`,
      headers: this.headers(),
    })))
    return options.snapshots.capture('salesforce', allowed, sourceValues)
  }
  async writeNamespaced(writes: NamespacedWrite[], snapshotRef: string): Promise<WriteReceipt> {
    const options = this.requireWriteOptions()
    if (!await options.snapshots.exists('salesforce', snapshotRef)) throw new Error('valid Salesforce snapshot is required before write')
    const { allowed, rejected } = partitionNamespacedWrites(writes, options.namespacePrefix)
    for (const write of allowed) await requestJson(this.http, {
      method: 'PATCH', url: `${this.base}/sobjects/${salesforceObject(write.object)}/${encodeURIComponent(write.externalId)}`,
      headers: this.headers(), body: JSON.stringify(write.fields),
    })
    return { written: allowed.length, rejected, snapshotRef }
  }
  private requireWriteOptions(): CrmWriteOptions {
    if (!this.writeOptions) throw new Error('Salesforce writes require snapshot storage and a namespace prefix')
    return this.writeOptions
  }
  private async query(object: StagedBatch['object'], soql: string, cursor?: string): Promise<StagedBatch> {
    const url = cursor ? new URL(cursor, this.credentials.instanceUrl).toString() : `${this.base}/query?q=${encodeURIComponent(soql)}`
    const value = await requestJson<{ records?: unknown[]; nextRecordsUrl?: string }>(this.http, { method: 'GET', url, headers: this.headers() })
    return { connectorId: 'salesforce', object, extractedAt: now(), cursor: value.nextRecordsUrl ?? null, rows: objectRows(value.records) }
  }
}

export interface HubSpotCredentials { accessToken: string }

export class HubSpotClient extends BearerProvider implements CrmReader, CrmWriter {
  readonly info: ConnectorInfo
  private readonly base = 'https://api.hubapi.com'
  constructor(credentials: HubSpotCredentials, http: HttpTransport, private readonly writeOptions?: CrmWriteOptions) {
    super(credentials.accessToken, http)
    this.info = {
      id: 'hubspot', kind: 'crm',
      capabilities: [
        'read_accounts', 'read_contacts', 'read_opportunities', 'read_activities', 'read_leads', 'test_connection',
        ...(writeOptions ? ['snapshot', 'write_namespaced_fields'] as const : []),
      ],
    }
  }
  async testConnection(): Promise<ConnectionHealth> {
    const value = await requestJson<{ results?: unknown[] }>(this.http, { method: 'GET', url: `${this.base}/crm/v3/owners?limit=1`, headers: this.headers() })
    return { ok: true, provider: 'hubspot', accountRef: null, detail: `HubSpot API reachable (${value.results?.length ?? 0} owner sample)` }
  }
  pullAccounts(cursor?: string): Promise<StagedBatch> { return this.pull('account', 'companies', cursor) }
  pullContacts(cursor?: string): Promise<StagedBatch> { return this.pull('contact', 'contacts', cursor) }
  pullOpportunities(cursor?: string): Promise<StagedBatch> { return this.pull('opportunity', 'deals', cursor) }
  pullActivities(cursor?: string): Promise<StagedBatch> { return this.pull('activity', 'meetings', cursor) }
  pullLeads(cursor?: string): Promise<StagedBatch> { return this.pull('lead', '0-136', cursor) }
  async snapshot(writes: NamespacedWrite[]): Promise<string> {
    const options = this.requireWriteOptions()
    const { allowed, rejected } = partitionNamespacedWrites(writes, options.namespacePrefix)
    if (rejected.length) throw new Error(rejected[0]!.reason)
    const sourceValues = await Promise.all(allowed.map((write) => {
      const params = new URLSearchParams({ properties: Object.keys(write.fields).join(',') })
      return requestJson<unknown>(this.http, { method: 'GET', url: `${this.base}/crm/v3/objects/${hubspotObject(write.object)}/${encodeURIComponent(write.externalId)}?${params}`, headers: this.headers() })
    }))
    return options.snapshots.capture('hubspot', allowed, sourceValues)
  }
  async writeNamespaced(writes: NamespacedWrite[], snapshotRef: string): Promise<WriteReceipt> {
    const options = this.requireWriteOptions()
    if (!await options.snapshots.exists('hubspot', snapshotRef)) throw new Error('valid HubSpot snapshot is required before write')
    const { allowed, rejected } = partitionNamespacedWrites(writes, options.namespacePrefix)
    for (const write of allowed) await requestJson(this.http, {
      method: 'PATCH', url: `${this.base}/crm/v3/objects/${hubspotObject(write.object)}/${encodeURIComponent(write.externalId)}`,
      headers: this.headers(), body: JSON.stringify({ properties: write.fields }),
    })
    return { written: allowed.length, rejected, snapshotRef }
  }
  private requireWriteOptions(): CrmWriteOptions {
    if (!this.writeOptions) throw new Error('HubSpot writes require snapshot storage and a namespace prefix')
    return this.writeOptions
  }
  private async pull(object: StagedBatch['object'], objectType: string, cursor?: string): Promise<StagedBatch> {
    const params = new URLSearchParams({ limit: '100' })
    if (cursor) params.set('after', cursor)
    const value = await requestJson<{ results?: unknown[]; paging?: { next?: { after?: string } } }>(this.http, {
      method: 'GET', url: `${this.base}/crm/v3/objects/${objectType}?${params}`, headers: this.headers(),
    })
    return { connectorId: 'hubspot', object, extractedAt: now(), cursor: value.paging?.next?.after ?? null, rows: objectRows(value.results) }
  }
}

export class ClayClient implements EnrichmentProvider, ConnectionTester {
  readonly info = { id: 'clay', kind: 'enrichment' as const, capabilities: ['enrich', 'test_connection'] as const }
  constructor(
    private readonly credentials: { apiKey: string; enrichmentUrl: string; healthcheckUrl?: string },
    private readonly http: HttpTransport,
  ) {
    assertClayUrl(credentials.enrichmentUrl)
    if (credentials.healthcheckUrl) assertClayUrl(credentials.healthcheckUrl)
  }
  async testConnection(): Promise<ConnectionHealth> {
    if (!this.credentials.healthcheckUrl) {
      return { ok: true, provider: 'clay', accountRef: null, detail: 'Clay webhook configuration valid; add healthcheckUrl for live reachability' }
    }
    await requestJson(this.http, {
      method: 'GET', url: this.credentials.healthcheckUrl,
      headers: { Authorization: `Bearer ${this.credentials.apiKey}` },
    })
    return { ok: true, provider: 'clay', accountRef: null, detail: 'Clay healthcheck reachable' }
  }
  async enrich(domain: string, fields: string[]): Promise<Record<string, string | number | boolean | null>> {
    const value = await requestJson<{ data?: Record<string, string | number | boolean | null> }>(this.http, {
      method: 'POST', url: this.credentials.enrichmentUrl,
      headers: { Authorization: `Bearer ${this.credentials.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, fields }),
    })
    return value.data ?? {}
  }
}

export class SlackClient extends BearerProvider implements MessageSender {
  readonly info = { id: 'slack', kind: 'comms' as const, capabilities: ['send_message', 'test_connection'] as const }
  async testConnection(): Promise<ConnectionHealth> {
    const value = await requestJson<{ ok?: boolean; team_id?: string }>(this.http, { method: 'POST', url: 'https://slack.com/api/auth.test', headers: this.headers(), body: '{}' })
    if (!value.ok) throw new Error('Slack authentication failed')
    return { ok: true, provider: 'slack', accountRef: value.team_id ?? null, detail: 'Slack API reachable' }
  }
  async sendMessage(destination: string, text: string): Promise<MessageReceipt> {
    const value = await requestJson<{ ok?: boolean; ts?: string }>(this.http, { method: 'POST', url: 'https://slack.com/api/chat.postMessage', headers: this.headers(), body: JSON.stringify({ channel: destination, text }) })
    if (!value.ok || !value.ts) throw new Error('Slack message was not accepted')
    return { provider: 'slack', destination, externalId: value.ts }
  }
}

export class TeamsClient extends BearerProvider implements MessageSender {
  readonly info = { id: 'teams', kind: 'comms' as const, capabilities: ['send_message', 'test_connection'] as const }
  async testConnection(): Promise<ConnectionHealth> {
    const value = await requestJson<{ id?: string }>(this.http, { method: 'GET', url: 'https://graph.microsoft.com/v1.0/me', headers: this.headers() })
    return { ok: true, provider: 'teams', accountRef: value.id ?? null, detail: 'Microsoft Graph reachable' }
  }
  async sendMessage(destination: string, text: string): Promise<MessageReceipt> {
    const [teamId, channelId] = destination.split(':')
    if (!teamId || !channelId) throw new Error('Teams destination must be teamId:channelId')
    const value = await requestJson<{ id?: string }>(this.http, {
      method: 'POST', url: `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`,
      headers: this.headers(), body: JSON.stringify({ body: { content: text } }),
    })
    if (!value.id) throw new Error('Teams message was not accepted')
    return { provider: 'teams', destination, externalId: value.id }
  }
}

export class FathomClient implements TranscriptReader, ConnectionTester {
  readonly info = { id: 'fathom', kind: 'meetings' as const, capabilities: ['read_transcripts', 'test_connection'] as const }
  private readonly credentials: { apiKey?: string; accessToken?: string }
  constructor(credentials: string | { apiKey?: string; accessToken?: string }, private readonly http: HttpTransport) {
    this.credentials = typeof credentials === 'string' ? { apiKey: credentials } : credentials
  }
  private headers(): Record<string, string> {
    if (this.credentials.apiKey) return { 'X-Api-Key': this.credentials.apiKey }
    if (this.credentials.accessToken) return bearer(this.credentials.accessToken)
    throw new Error('Fathom apiKey or accessToken is required')
  }
  async testConnection(): Promise<ConnectionHealth> {
    const value = await requestJson<{ items?: unknown[] }>(this.http, { method: 'GET', url: 'https://api.fathom.ai/external/v1/meetings?limit=1', headers: this.headers() })
    return { ok: true, provider: 'fathom', accountRef: null, detail: `Fathom API reachable (${value.items?.length ?? 0} meeting sample)` }
  }
  async listTranscripts(cursor?: string): Promise<{ records: TranscriptRecord[]; cursor: string | null }> {
    const params = new URLSearchParams({ include_transcript: 'true' })
    if (cursor) params.set('cursor', cursor)
    const value = await requestJson<{ items?: unknown[]; next_cursor?: string | null }>(this.http, { method: 'GET', url: `https://api.fathom.ai/external/v1/meetings?${params}`, headers: this.headers() })
    const records = objectRows(value.items).map((item) => {
      const transcript = objectRows(item.transcript)
      const invitees = objectRows(item.calendar_invitees)
      return {
        externalId: String(item.recording_id ?? ''), title: String(item.meeting_title ?? item.title ?? 'Meeting'),
        occurredAt: String(item.created_at ?? item.scheduled_start_time ?? now()),
        transcript: transcript.map((part) => `${String((part.speaker as Record<string, unknown> | undefined)?.display_name ?? 'Speaker')}: ${String(part.text ?? '')}`).join('\n'),
        participants: invitees.map((person) => String(person.email ?? '')).filter(Boolean),
      }
    })
    return { records, cursor: value.next_cursor ?? null }
  }
}

export class SmartleadClient implements SequencerClient, ConnectionTester {
  readonly info = { id: 'smartlead', kind: 'sequencer' as const, capabilities: ['enroll_sequence', 'test_connection'] as const }
  constructor(private readonly apiKey: string, private readonly http: HttpTransport) {}
  async testConnection(): Promise<ConnectionHealth> {
    await requestJson(this.http, { method: 'GET', url: `https://server.smartlead.ai/api/v1/campaigns?api_key=${encodeURIComponent(this.apiKey)}` })
    return { ok: true, provider: 'smartlead', accountRef: null, detail: 'Smartlead API reachable' }
  }
  async enroll(campaignId: string, leads: SequenceLead[]): Promise<SequenceEnrollmentReceipt> {
    if (!campaignId.trim()) throw new Error('Smartlead campaignId is required')
    const value = await requestJson<{ added_count?: number; skipped_count?: number }>(this.http, {
      method: 'POST',
      url: `https://server.smartlead.ai/api/v1/campaigns/${encodeURIComponent(campaignId)}/leads?api_key=${encodeURIComponent(this.apiKey)}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_list: leads.map((lead) => ({ email: lead.email, first_name: lead.firstName, last_name: lead.lastName, company_name: lead.companyName, custom_fields: lead.customFields })),
        settings: { ignore_duplicate_leads_in_other_campaign: false, return_lead_ids: true },
      }),
    })
    return { provider: 'smartlead', campaignId, enrolled: value.added_count ?? 0, skipped: value.skipped_count ?? 0 }
  }
}

export class InstantlyClient extends BearerProvider implements SequencerClient {
  readonly info = { id: 'instantly', kind: 'sequencer' as const, capabilities: ['enroll_sequence', 'test_connection'] as const }
  async testConnection(): Promise<ConnectionHealth> {
    await requestJson(this.http, { method: 'GET', url: 'https://api.instantly.ai/api/v2/campaigns?limit=1', headers: this.headers() })
    return { ok: true, provider: 'instantly', accountRef: null, detail: 'Instantly API reachable' }
  }
  async enroll(campaignId: string, leads: SequenceLead[]): Promise<SequenceEnrollmentReceipt> {
    if (!campaignId.trim()) throw new Error('Instantly campaignId is required')
    const value = await requestJson<{ uploaded?: number; skipped?: number; leads?: unknown[] }>(this.http, {
      method: 'POST', url: 'https://api.instantly.ai/api/v2/leads/add',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: campaignId, leads: leads.map((lead) => ({ email: lead.email, first_name: lead.firstName, last_name: lead.lastName, company_name: lead.companyName, custom_variables: lead.customFields })) }),
    })
    return { provider: 'instantly', campaignId, enrolled: value.uploaded ?? value.leads?.length ?? leads.length, skipped: value.skipped ?? 0 }
  }
}

export class LinkedInAdsClient extends BearerProvider implements AudienceSyncClient {
  readonly info = { id: 'linkedin-ads', kind: 'ads' as const, capabilities: ['sync_audience', 'test_connection'] as const }
  constructor(accessToken: string, http: HttpTransport, private readonly version = '202606') { super(accessToken, http) }
  private linkedInHeaders(): Record<string, string> {
    return { ...this.headers(), 'Content-Type': 'application/json', 'Linkedin-Version': this.version, 'X-Restli-Protocol-Version': '2.0.0' }
  }
  async testConnection(): Promise<ConnectionHealth> {
    await requestJson(this.http, { method: 'GET', url: 'https://api.linkedin.com/rest/adAccounts?q=search&search=(status:(values:List(ACTIVE)))&pageSize=1', headers: this.linkedInHeaders() })
    return { ok: true, provider: 'linkedin-ads', accountRef: null, detail: 'LinkedIn Marketing API reachable' }
  }
  async syncEmails(audienceId: string, add: string[], remove: string[]): Promise<AudienceSyncReceipt> {
    if (!/^\d+$/.test(audienceId)) throw new Error('LinkedIn audienceId must be numeric')
    const elements = [
      ...add.map((email) => linkedInAudienceElement('ADD', email)),
      ...remove.map((email) => linkedInAudienceElement('REMOVE', email)),
    ]
    if (elements.length) await requestJson(this.http, {
      method: 'POST', url: `https://api.linkedin.com/rest/dmpSegments/${audienceId}/users`,
      headers: { ...this.linkedInHeaders(), 'X-RestLi-Method': 'BATCH_CREATE' },
      body: JSON.stringify({ elements }),
    })
    return { provider: 'linkedin-ads', audienceId, added: add.length, removed: remove.length }
  }
}

function linkedInAudienceElement(action: 'ADD' | 'REMOVE', email: string) {
  const normalized = email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new Error(`invalid audience email: ${email}`)
  return { action, userIds: [{ idType: 'SHA256_EMAIL', idValue: createHash('sha256').update(normalized).digest('hex') }] }
}

export const SUPPORTED_PROVIDERS = [
  'salesforce', 'hubspot', 'attio',
  'clay',
  'slack', 'teams', 'gmail', 'microsoft-email',
  'fathom', 'gong',
  'smartlead', 'instantly', 'outreach', 'salesloft', 'apollo', 'heyreach', 'lemlist', 'mailshake',
  'linkedin-ads',
  'snowflake', 'bigquery',
  'sixsense', 'g2', 'clearbit', 'koala', 'bombora',
  'qualified', 'linkedin-leadgen', 'typeform', 'chilipiper',
] as const

export type SupportedProvider = typeof SUPPORTED_PROVIDERS[number]

export function isSupportedProvider(value: string): value is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(value)
}

export function createProviderClient(
  provider: SupportedProvider,
  credentials: Record<string, string>,
  http: HttpTransport,
  writeOptions?: CrmWriteOptions,
): ConnectionTester {
  switch (provider) {
    case 'salesforce': return new SalesforceClient({
      accessToken: required(credentials, 'accessToken'),
      instanceUrl: required(credentials, 'instanceUrl'),
      ...(credentials.apiVersion ? { apiVersion: credentials.apiVersion } : {}),
    }, http, writeOptions)
    case 'hubspot': return new HubSpotClient({ accessToken: required(credentials, 'accessToken') }, http, writeOptions)
    case 'attio': return new AttioClient(required(credentials, 'accessToken'), http, writeOptions)
    case 'clay': return new ClayClient({
      apiKey: required(credentials, 'apiKey'), enrichmentUrl: required(credentials, 'enrichmentUrl'),
      ...(credentials.healthcheckUrl ? { healthcheckUrl: credentials.healthcheckUrl } : {}),
    }, http)
    case 'slack': return new SlackClient(required(credentials, 'accessToken'), http)
    case 'teams': return new TeamsClient(required(credentials, 'accessToken'), http)
    case 'gmail': return new GmailClient(required(credentials, 'accessToken'), http)
    case 'microsoft-email': return new MicrosoftEmailClient(required(credentials, 'accessToken'), http)
    case 'fathom': return new FathomClient(credentials.apiKey
      ? { apiKey: credentials.apiKey }
      : { accessToken: required(credentials, 'accessToken') }, http)
    case 'gong': return new GongClient({
      baseUrl: required(credentials, 'baseUrl'),
      ...(credentials.accessToken ? { accessToken: credentials.accessToken } : {}),
      ...(credentials.accessKey ? { accessKey: credentials.accessKey } : {}),
      ...(credentials.accessKeySecret ? { accessKeySecret: credentials.accessKeySecret } : {}),
      ...(credentials.lookbackDays ? { lookbackDays: credentials.lookbackDays } : {}),
    }, http)
    case 'smartlead': return new SmartleadClient(required(credentials, 'apiKey'), http)
    case 'instantly': return new InstantlyClient(required(credentials, 'apiKey'), http)
    case 'outreach': return new OutreachClient(required(credentials, 'accessToken'), required(credentials, 'mailboxId'), http)
    case 'salesloft': return new SalesloftClient(required(credentials, 'accessToken'), http)
    case 'apollo': return new ApolloClient(required(credentials, 'apiKey'), http)
    case 'heyreach':
    case 'lemlist':
    case 'mailshake': return new PartnerSequencerClient(provider, required(credentials, 'enrollmentUrl'), required(credentials, 'apiKey'), http)
    case 'linkedin-ads': return new LinkedInAdsClient(required(credentials, 'accessToken'), http, credentials.apiVersion ?? '202606')
    case 'snowflake': return new SnowflakeClient({
      accountUrl: required(credentials, 'accountUrl'), token: required(credentials, 'token'),
      ...(credentials.warehouse ? { warehouse: credentials.warehouse } : {}),
      ...(credentials.database ? { database: credentials.database } : {}),
      ...(credentials.schema ? { schema: credentials.schema } : {}),
      ...(credentials.role ? { role: credentials.role } : {}),
    }, http)
    case 'bigquery': return new BigQueryClient(required(credentials, 'projectId'), required(credentials, 'accessToken'), http, credentials.location)
    case 'sixsense':
    case 'g2':
    case 'clearbit':
    case 'koala':
    case 'bombora': return new HostedIntentClient(provider, required(credentials, 'signalsUrl'), required(credentials, 'apiKey'), http)
    case 'qualified':
    case 'linkedin-leadgen':
    case 'typeform':
    case 'chilipiper': return new HostedInboundClient(provider, required(credentials, 'leadsUrl'), required(credentials, 'accessToken'), http)
  }
}

function required(credentials: Record<string, string>, key: string): string {
  const value = credentials[key]
  if (!value) throw new Error(`${key} is required`)
  return value
}

function salesforceObject(object: NamespacedWrite['object']): string {
  return { account: 'Account', contact: 'Contact', opportunity: 'Opportunity' }[object]
}

function hubspotObject(object: NamespacedWrite['object']): string {
  return { account: 'companies', contact: 'contacts', opportunity: 'deals' }[object]
}

function assertClayUrl(value: string): void {
  const url = new URL(value)
  if (url.protocol !== 'https:' || (url.hostname !== 'clay.com' && !url.hostname.endsWith('.clay.com'))) {
    throw new Error('Clay enrichment URL must be an HTTPS endpoint on clay.com')
  }
}
