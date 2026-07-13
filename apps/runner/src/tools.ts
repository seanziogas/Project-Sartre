import type { ConnectionTester, CrmReader, CrmWriter, EnrichmentProvider, MessageSender, TranscriptReader } from '@sartre/connectors'
import { PostgresConnectorSnapshotStore } from '@sartre/db'
import type { Queryable } from '@sartre/db'
import type { TenantConnectionResolver } from './connections.js'

/** Typed construction of live clients from the current tenant's stored credentials. */
export class TenantToolClients {
  constructor(private readonly db: Queryable, private readonly connections: TenantConnectionResolver) {}

  async crm(clientId: string, provider: 'salesforce' | 'hubspot', namespacePrefix: string): Promise<CrmReader & CrmWriter & ConnectionTester> {
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

  async meetings(clientId: string): Promise<TranscriptReader & ConnectionTester> {
    return this.connections.providerClient(clientId, 'fathom') as Promise<TranscriptReader & ConnectionTester>
  }
}
