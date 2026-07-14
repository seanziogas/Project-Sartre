import { createProviderClient, CredentialVault, isOAuthProvider, productionHttpTransport, refreshOAuthToken } from '@sartre/connectors'
import type { ConnectionTester, CredentialKeyConfig, CrmWriteOptions, HttpTransport, SupportedProvider, ToolConnectionSummary } from '@sartre/connectors'
import { PostgresToolConnectionStore } from '@sartre/db'

export interface ResolvedToolConnection {
  connection: ToolConnectionSummary
  credentials: Record<string, string>
}

/** Tenant-scoped execution-time access to credentials; cleartext is never cached. */
export class TenantConnectionResolver {
  constructor(
    private readonly store: PostgresToolConnectionStore,
    private readonly encryptionKeys?: CredentialKeyConfig,
  ) {}

  list(clientId: string): Promise<ToolConnectionSummary[]> {
    return this.store.list(clientId)
  }

  async resolve(clientId: string, connectionId: string): Promise<ResolvedToolConnection> {
    const stored = await this.store.get(clientId, connectionId)
    if (!stored || stored.status !== 'active') throw new Error(`active connection ${connectionId} not found for client`)
    if (!this.encryptionKeys) throw new Error('credential encryption keyring is required to use connections')
    const { encryptedCredentials, ...connection } = stored
    const vault = new CredentialVault(this.encryptionKeys)
    const credentials = vault.open(encryptedCredentials, clientId)
    if (vault.needsRotation(encryptedCredentials)) {
      await this.store.put({ ...stored, encryptedCredentials: vault.seal(credentials, clientId), updatedAt: new Date().toISOString() })
    }
    return {
      connection,
      credentials,
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
    const expiresAt = Date.parse(credentials.expiresAt ?? '')
    const shouldRefresh = !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000
    if (isOAuthProvider(provider) && resolved.connection.authKind === 'oauth' && credentials.refreshToken && shouldRefresh) {
      credentials = await refreshOAuthToken(provider, credentials, http)
      const stored = await this.store.get(clientId, resolved.connection.connectionId)
      if (!stored || !this.encryptionKeys) throw new Error('connection disappeared during token refresh')
      const updatedAt = new Date().toISOString()
      await this.store.put({
        ...stored,
        encryptedCredentials: new CredentialVault(this.encryptionKeys).seal(credentials, clientId),
        updatedAt,
      })
    }
    return createProviderClient(provider, credentials, http, writeOptions)
  }
}
