import { createProviderClient, CredentialVault, productionHttpTransport, refreshOAuthToken } from '@sartre/connectors'
import type { ConnectionTester, CrmWriteOptions, HttpTransport, SupportedProvider, ToolConnectionSummary } from '@sartre/connectors'
import { PostgresToolConnectionStore } from '@sartre/db'

export interface ResolvedToolConnection {
  connection: ToolConnectionSummary
  credentials: Record<string, string>
}

/** Tenant-scoped execution-time access to credentials; cleartext is never cached. */
export class TenantConnectionResolver {
  constructor(
    private readonly store: PostgresToolConnectionStore,
    private readonly encryptionKey?: string,
  ) {}

  list(clientId: string): Promise<ToolConnectionSummary[]> {
    return this.store.list(clientId)
  }

  async resolve(clientId: string, connectionId: string): Promise<ResolvedToolConnection> {
    const stored = await this.store.get(clientId, connectionId)
    if (!stored || stored.status !== 'active') throw new Error(`active connection ${connectionId} not found for client`)
    if (!this.encryptionKey) throw new Error('SARTRE_CREDENTIAL_ENCRYPTION_KEY is required to use connections')
    const { encryptedCredentials, ...connection } = stored
    return {
      connection,
      credentials: new CredentialVault(this.encryptionKey).open(encryptedCredentials, clientId),
    }
  }

  async resolveProvider(clientId: string, provider: string): Promise<ResolvedToolConnection> {
    const match = (await this.store.list(clientId)).find((connection) => connection.provider === provider)
    if (!match) throw new Error(`active ${provider} connection not found for client`)
    return this.resolve(clientId, match.connectionId)
  }

  /** Construct a concrete provider client from this tenant's active credentials. */
  async providerClient(
    clientId: string,
    provider: SupportedProvider,
    http: HttpTransport = productionHttpTransport(),
    writeOptions?: CrmWriteOptions,
  ): Promise<ConnectionTester> {
    const resolved = await this.resolveProvider(clientId, provider)
    let credentials = resolved.credentials
    if (provider !== 'clay' && resolved.connection.authKind === 'oauth' && credentials.refreshToken) {
      credentials = await refreshOAuthToken(provider, credentials, http)
      const stored = await this.store.get(clientId, resolved.connection.connectionId)
      if (!stored || !this.encryptionKey) throw new Error('connection disappeared during token refresh')
      const updatedAt = new Date().toISOString()
      await this.store.put({
        ...stored,
        encryptedCredentials: new CredentialVault(this.encryptionKey).seal(credentials, clientId),
        updatedAt,
      })
    }
    return createProviderClient(provider, credentials, http, writeOptions)
  }
}
