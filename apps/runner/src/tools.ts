import type {
  AudienceSyncClient,
  ConnectionTester,
  CrmReader,
  CrmWriter,
  EmailSender,
  EnrichmentProvider,
  InboundReader,
  IntentReader,
  MessageSender,
  SequencerClient,
  TranscriptReader,
  WarehouseClient,
} from '@sartre/connectors'
import { PostgresConnectorSnapshotStore } from '@sartre/db'
import type { Queryable } from '@sartre/db'
import type { TenantConnectionResolver } from './connections.js'

/** Typed construction of live clients from the current tenant's stored credentials. */
export class TenantToolClients {
  constructor(private readonly db: Queryable, private readonly connections: TenantConnectionResolver) {}

  async crm(clientId: string, provider: 'salesforce' | 'hubspot' | 'attio', namespacePrefix: string): Promise<CrmReader & CrmWriter & ConnectionTester> {
    const client = await this.connections.providerClient(clientId, provider, undefined, {
      namespacePrefix,
      snapshots: new PostgresConnectorSnapshotStore(this.db, clientId),
    })
    return client as CrmReader & CrmWriter & ConnectionTester
  }

  async enrichment(clientId: string): Promise<EnrichmentProvider & ConnectionTester> {
    return this.connections.providerClient(clientId, 'clay') as Promise<EnrichmentProvider & ConnectionTester>
  }

  async comms(clientId: string, provider: 'slack' | 'teams'): Promise<MessageSender & ConnectionTester> {
    return this.connections.providerClient(clientId, provider) as Promise<MessageSender & ConnectionTester>
  }

  async meetings(clientId: string, provider: 'fathom' | 'gong' | 'fireflies' | 'zoom' = 'fathom'): Promise<TranscriptReader & ConnectionTester> {
    return this.connections.providerClient(clientId, provider) as Promise<TranscriptReader & ConnectionTester>
  }

  async sequencer(clientId: string, provider: 'smartlead' | 'instantly' | 'outreach' | 'salesloft' | 'apollo' | 'heyreach' | 'lemlist' | 'mailshake'): Promise<SequencerClient & ConnectionTester> {
    return this.connections.providerClient(clientId, provider) as Promise<SequencerClient & ConnectionTester>
  }

  async audience(clientId: string, provider: 'linkedin-ads' | 'google-ads' | 'meta-ads' = 'linkedin-ads'): Promise<AudienceSyncClient & ConnectionTester> {
    return this.connections.providerClient(clientId, provider) as Promise<AudienceSyncClient & ConnectionTester>
  }

  async warehouse(clientId: string, provider: 'snowflake' | 'bigquery' | 'databricks' | 'redshift'): Promise<WarehouseClient & ConnectionTester> {
    return this.connections.providerClient(clientId, provider) as Promise<WarehouseClient & ConnectionTester>
  }

  async intent(clientId: string, provider: 'sixsense' | 'g2' | 'clearbit' | 'koala' | 'bombora'): Promise<IntentReader & ConnectionTester> {
    return this.connections.providerClient(clientId, provider) as Promise<IntentReader & ConnectionTester>
  }

  async inbound(clientId: string, provider: 'qualified' | 'linkedin-leadgen' | 'typeform' | 'chilipiper'): Promise<InboundReader & ConnectionTester> {
    return this.connections.providerClient(clientId, provider) as Promise<InboundReader & ConnectionTester>
  }

  async marketingAutomation(clientId: string): Promise<InboundReader & ConnectionTester> {
    return this.connections.providerClient(clientId, 'marketo') as Promise<InboundReader & ConnectionTester>
  }

  async crmReader(clientId: string, provider: 'pipedrive' | 'dynamics' | 'zoho-crm'): Promise<CrmReader & ConnectionTester> {
    return this.connections.providerClient(clientId, provider) as Promise<CrmReader & ConnectionTester>
  }

  async email(clientId: string, provider: 'gmail' | 'microsoft-email'): Promise<EmailSender & ConnectionTester> {
    return this.connections.providerClient(clientId, provider) as Promise<EmailSender & ConnectionTester>
  }
}
